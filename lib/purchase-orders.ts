/**
 * Purchase orders and goods receipt (spec §5.7, FR-016, FR-017).
 *
 * `PurchaseOrder`, `PurchaseOrderItem`, `InventoryBatch` and `SupplierItem`
 * have been in the schema since the fork with nothing writing to any of them.
 * That single gap took three requirements with it: there was no purchase and
 * receipt (§5.7); no batch or supplier to trace a stock movement back to
 * (FR-017); and — because an expiry date arrives with a delivery — nothing to
 * raise a near-expiry alert about (FR-016). The supplier detail page has been
 * rendering "total orders" and "pending business" as permanent zeroes.
 *
 * The arithmetic and the state rules live here rather than in the route,
 * because receipt is the part that has to be right: it moves stock, and a
 * wrong quantity is discovered weeks later at a stock take.
 */
import { PurchaseOrderStatus, VendorStatus } from '@prisma/client'
import type { Prisma, PrismaClient } from '@prisma/client'
import { nextInSeries, trailingNumber } from '@/lib/numbering'

/** Works against the client or a transaction — both are used by callers. */
type Db = PrismaClient | Prisma.TransactionClient

// ────────────────────────────────────────────────────────────────────────────
// Money
// ────────────────────────────────────────────────────────────────────────────

export interface OrderLineInput {
  quantity: number
  unitPrice: number
  /** The item's own rate, where the clinic records one. Absent means untaxed. */
  taxPercentage?: number | null
}

export interface OrderTotals {
  lines: { amount: number }[]
  subtotal: number
  taxAmount: number
  totalAmount: number
}

/** Two decimal places, the way the Decimal(10,2) columns will store it. */
function money(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * What an order comes to.
 *
 * Tax is per line, from the item's own `taxPercentage`, rather than one rate on
 * the order: a delivery mixes zero-rated gloves with taxable equipment, and
 * applying a single rate to the subtotal would quietly get both wrong. Lines
 * are rounded before they are summed, so the total matches what a reader gets
 * by adding up the printed line amounts.
 */
export function orderTotals(lines: OrderLineInput[]): OrderTotals {
  const priced = lines.map((line) => {
    const amount = money(line.quantity * line.unitPrice)
    return { amount, tax: money((amount * (line.taxPercentage ?? 0)) / 100) }
  })

  const subtotal = money(priced.reduce((sum, l) => sum + l.amount, 0))
  const taxAmount = money(priced.reduce((sum, l) => sum + l.tax, 0))

  return {
    lines: priced.map(({ amount }) => ({ amount })),
    subtotal,
    taxAmount,
    totalAmount: money(subtotal + taxAmount),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

/**
 * Orders that have not been placed with the supplier yet, and so can still be
 * edited freely.
 */
export function isEditable(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.DRAFT
}

/**
 * Orders against which goods can be booked in.
 *
 * A DRAFT deliberately cannot receive. Receiving against an order nobody has
 * placed means the stock arrived from somewhere else, and that is a stock
 * adjustment with its own reason, not a delivery against this order.
 */
export function canReceive(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.ORDERED || status === PurchaseOrderStatus.PARTIALLY_RECEIVED
}

/**
 * Where an order stands once its lines have been updated.
 *
 * Everything in full is RECEIVED; anything at all is PARTIALLY_RECEIVED. An
 * order where nothing has arrived stays where it was, which is how a receipt of
 * zero on every line leaves the order untouched rather than "partially"
 * received.
 */
export function receiptStatusFor(
  lines: { quantity: number; receivedQty: number }[],
  current: PurchaseOrderStatus
): PurchaseOrderStatus {
  if (lines.length > 0 && lines.every((l) => l.receivedQty >= l.quantity)) {
    return PurchaseOrderStatus.RECEIVED
  }
  if (lines.some((l) => l.receivedQty > 0)) return PurchaseOrderStatus.PARTIALLY_RECEIVED
  return current
}

// ────────────────────────────────────────────────────────────────────────────
// Receipt
// ────────────────────────────────────────────────────────────────────────────

export interface ReceiptLine {
  /** The `PurchaseOrderItem` being received against. */
  lineId: string
  quantity: number
  batchNumber?: string | null
  expiryDate?: string | null
  manufacturingDate?: string | null
}

/** What the order says about a line, and what the item says about tracking. */
export interface OrderedLine {
  id: string
  itemId: string
  itemName: string
  quantity: number
  receivedQty: number
  batchTracking: boolean
  expiryTracking: boolean
}

export type ReceiptCheck = { ok: true } | { ok: false; error: string }

/**
 * Whether a receipt can be booked in, checked against the order before
 * anything is written.
 *
 * Over-receipt is refused rather than absorbed. It keeps `receivedQty` no
 * greater than `quantity`, which is what makes "outstanding" mean anything on
 * the order screen and on the supplier's pending-business figure. A delivery
 * that genuinely exceeds the order is a real thing, and the answer is to amend
 * the order — the error says so, rather than leaving the reader to guess.
 *
 * Batch and expiry are required only where the item asks for them. Both flags
 * are opt-in per item and default to false; an item with `expiryTracking` on is
 * an item whose expiry somebody decided to track, and letting a delivery of it
 * in without a date is how FR-016 ends up with nothing to alert about.
 */
export function checkReceipt(
  ordered: OrderedLine[],
  receipts: ReceiptLine[],
  at: Date = new Date()
): ReceiptCheck {
  if (receipts.length === 0) return { ok: false, error: 'Nothing to receive' }

  const byId = new Map(ordered.map((line) => [line.id, line]))
  const seen = new Set<string>()

  for (const receipt of receipts) {
    const line = byId.get(receipt.lineId)
    if (!line) return { ok: false, error: 'This receipt names a line that is not on the order' }

    if (seen.has(receipt.lineId)) {
      return { ok: false, error: `${line.itemName} appears twice in the same receipt` }
    }
    seen.add(receipt.lineId)

    if (!Number.isInteger(receipt.quantity) || receipt.quantity <= 0) {
      return { ok: false, error: `Received quantity for ${line.itemName} must be a whole number` }
    }

    const outstanding = line.quantity - line.receivedQty
    if (receipt.quantity > outstanding) {
      return {
        ok: false,
        error:
          `${line.itemName}: ${receipt.quantity} received but only ${outstanding} outstanding. ` +
          `Amend the order quantity if the supplier sent more than was ordered.`,
      }
    }

    const batchNumber = receipt.batchNumber?.trim()

    if (line.batchTracking && !batchNumber) {
      return { ok: false, error: `${line.itemName} is batch-tracked and needs a batch number` }
    }

    if (line.expiryTracking && !receipt.expiryDate) {
      return { ok: false, error: `${line.itemName} is expiry-tracked and needs an expiry date` }
    }

    // An expiry date is recorded against a batch, so it needs one to live on.
    if (receipt.expiryDate && !batchNumber) {
      return { ok: false, error: `${line.itemName} has an expiry date but no batch number` }
    }

    if (receipt.expiryDate) {
      const expiry = new Date(receipt.expiryDate)
      if (Number.isNaN(expiry.getTime())) {
        return { ok: false, error: `${line.itemName}: the expiry date is not a date` }
      }
      // Stock that is already out of date is not a delivery, it is waste —
      // fifty lignocaine cartridges dated January 2025 went on the shelf with
      // no warning (bug report 12 Oct, finding 43). Same rule as expiryFor in
      // lib/stock-alerts.ts: the day itself counts as expired.
      if (isExpired(expiry, at)) {
        return {
          ok: false,
          error: `${line.itemName}: batch ${batchNumber} expired on ${expiry.toISOString().slice(0, 10)} and cannot be received`,
        }
      }
    }
  }

  return { ok: true }
}

/**
 * Whether an expiry date has been reached at `at`.
 *
 * Also used by the receipt route for a batch that already exists: a second
 * delivery into batch LIG-OLD, which expired in January 2025, was added to it
 * because the stored date was never looked at.
 */
export function isExpired(expiryDate: Date | null | undefined, at: Date = new Date()): boolean {
  return !!expiryDate && expiryDate.getTime() <= at.getTime()
}

// ────────────────────────────────────────────────────────────────────────────
// Who and what an order can name
// ────────────────────────────────────────────────────────────────────────────

export type PartiesCheck = { ok: true } | { ok: false; status: 400 | 404; error: string }

/**
 * Whether an order can be raised, edited or placed with this supplier for
 * these items.
 *
 * Draft order PO20260002 was sent (status ORDERED, 200) after its supplier and
 * one of its items had both been deleted (bug report 12 Oct, finding 44). A
 * deleted supplier or item is not found; an inactive or blocked supplier and
 * an inactive item are refused by name, so the person knows which one to
 * change. Scoped to the clinic, and to suppliers rather than laboratories.
 */
export async function checkOrderParties(
  db: Db,
  input: { hospitalId: string; supplierId: string; itemIds: string[] }
): Promise<PartiesCheck> {
  const supplier = await db.vendor.findFirst({
    where: {
      id: input.supplierId,
      hospitalId: input.hospitalId,
      kind: 'SUPPLIER',
      deletedAt: null,
    },
    select: { id: true, name: true, status: true },
  })

  if (!supplier) return { ok: false, status: 404, error: 'Supplier not found' }

  if (supplier.status !== VendorStatus.ACTIVE) {
    return {
      ok: false,
      status: 400,
      error: `${supplier.name} is ${supplier.status.toLowerCase()}. Reactivate the supplier or order from another.`,
    }
  }

  const ids = [...new Set(input.itemIds)]
  if (ids.length === 0) return { ok: true }

  const items = await db.inventoryItem.findMany({
    where: { id: { in: ids }, hospitalId: input.hospitalId, deletedAt: null },
    select: { id: true, name: true, isActive: true },
  })

  if (items.length !== ids.length) {
    return { ok: false, status: 404, error: 'An item on this order was not found' }
  }

  const inactive = items.find((item) => !item.isActive)
  if (inactive) {
    return {
      ok: false,
      status: 400,
      error: `${inactive.name} is inactive. Reactivate it or take it off the order.`,
    }
  }

  return { ok: true }
}

// ────────────────────────────────────────────────────────────────────────────
// Numbering
// ────────────────────────────────────────────────────────────────────────────

export const ORDER_NUMBER_PREFIX = 'PO'

/**
 * The next order number for this clinic, as `PO20260001`.
 *
 * Allocated from a counter row rather than read-then-write, so two orders
 * raised in the same second get two numbers. The caller's retry loop around
 * `P2002` is now a belt to the counter's braces.
 */
export async function nextOrderNumber(db: Db, hospitalId: string): Promise<string> {
  const prefix = `${ORDER_NUMBER_PREFIX}${new Date().getFullYear()}`

  return nextInSeries(db, {
    hospitalId,
    prefix,
    width: 4,
    currentMax: async () => {
      const last = await db.purchaseOrder.findFirst({
        where: { hospitalId, orderNumber: { startsWith: prefix } },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      })
      return trailingNumber(last?.orderNumber, 4)
    },
  })
}
