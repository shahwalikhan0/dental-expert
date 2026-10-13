import type { Prisma, PrismaClient } from '@prisma/client'
import { round2 } from '@/lib/till'

/**
 * The lines of an invoice as the routes accept them, and the checks that go
 * with them: what a line may say, which product it sells, and how far a
 * treatment line has been priced below the treatment.
 *
 * The create and edit routes each had their own copy of the line rules, and
 * the copies are how a rule came to be enforced on one and not the other. One
 * parser, used by both.
 */

type Db = PrismaClient | Prisma.TransactionClient

export interface InvoiceLine {
  treatmentId: string | null
  /** A product sold over the counter; stock leaves when the invoice is issued. */
  inventoryItemId: string | null
  description: string
  quantity: number
  /** Rounded to the paisa on the way in, as the column will store it. */
  unitPrice: number
  taxable: boolean
}

/**
 * The lines in a request body, or the first reason they cannot be used.
 *
 * A quantity is a whole number of at least one — the column is an integer, and
 * "1.5 crowns" is a typing slip rather than a sale. A unit price is a number of
 * zero or more; a blank one is refused rather than read as free, since a
 * cleared field turning into Rs 0 is how a charge goes missing.
 */
export function parseInvoiceLines(
  items: unknown
): { lines: InvoiceLine[]; error?: undefined } | { lines?: undefined; error: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'At least one item is required' }
  }

  const lines: InvoiceLine[] = []
  for (const [index, raw] of items.entries()) {
    const item = (raw ?? {}) as Record<string, unknown>
    const label = `Line ${index + 1}`

    const description = typeof item.description === 'string' ? item.description.trim() : ''
    if (!description) return { error: `${label} needs a description` }

    const quantity = Number(item.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: `${label}: the quantity must be a whole number of 1 or more` }
    }

    const priceRaw = item.unitPrice
    const unitPrice = Number(priceRaw)
    if (
      priceRaw === null ||
      priceRaw === undefined ||
      priceRaw === '' ||
      !Number.isFinite(unitPrice)
    ) {
      return { error: `${label} needs a unit price` }
    }
    if (unitPrice < 0) return { error: `${label}: the unit price cannot be negative` }

    const treatmentId =
      typeof item.treatmentId === 'string' && item.treatmentId ? item.treatmentId : null
    const inventoryItemId =
      typeof item.inventoryItemId === 'string' && item.inventoryItemId ? item.inventoryItemId : null
    if (treatmentId && inventoryItemId) {
      return { error: `${label} cannot be both a treatment and a product` }
    }

    lines.push({
      treatmentId,
      inventoryItemId,
      description,
      quantity,
      unitPrice: round2(unitPrice),
      taxable: item.taxable !== false,
    })
  }

  return { lines }
}

/** The treatment ids on these lines, in order. */
export function treatmentIdsOf(lines: { treatmentId?: string | null }[]): string[] {
  return lines.map((line) => line.treatmentId).filter((id): id is string => !!id)
}

/**
 * Why the products on these lines cannot be sold, or null.
 *
 * Each must be this clinic's and not deleted. Stock is not checked here: a
 * draft reserves nothing, and the count that matters is the one when the
 * invoice is issued, which is where it is checked (lib/invoice-stock.ts).
 */
export async function productLineProblem(
  db: Db,
  hospitalId: string,
  lines: { inventoryItemId?: string | null }[]
): Promise<string | null> {
  const ids = [...new Set(lines.map((l) => l.inventoryItemId).filter((id): id is string => !!id))]
  if (ids.length === 0) return null

  const found = await db.inventoryItem.findMany({
    where: { id: { in: ids }, hospitalId, deletedAt: null },
    select: { id: true },
  })
  const known = new Set((found ?? []).map((item) => item.id))
  return ids.every((id) => known.has(id))
    ? null
    : 'A product on this invoice is not in the inventory, or has been deleted'
}

export interface PriceShortfall {
  /** Σ of what the treatment lines fall short of the treatments' price. */
  total: number
  lines: { treatmentId: string; treatmentNo: string; price: number; charged: number }[]
}

/**
 * How far below the treatments' own price their lines are charged.
 *
 * Reception could bill a Rs 20,000 crown at Rs 5,000: a Rs 15,000 concession
 * that never reached discount approval and left no record that one was given
 * (invoice review 4.1). The shortfall counts towards the approval threshold
 * alongside the discount. A line is compared with the treatment's price as a
 * whole — a treatment is billed once — so a quantity above one is not read as
 * a concession.
 */
export async function treatmentPriceShortfall(
  db: Db,
  hospitalId: string,
  lines: { treatmentId?: string | null; quantity: number; unitPrice: unknown }[]
): Promise<PriceShortfall> {
  const ids = treatmentIdsOf(lines)
  if (ids.length === 0) return { total: 0, lines: [] }

  const treatments = await db.treatment.findMany({
    where: { id: { in: ids }, hospitalId },
    select: { id: true, treatmentNo: true, cost: true },
  })
  const byId = new Map((treatments ?? []).map((t) => [t.id, t]))

  const short: PriceShortfall['lines'] = []
  for (const line of lines) {
    const treatment = line.treatmentId ? byId.get(line.treatmentId) : undefined
    if (!treatment) continue
    const price = round2(Number(treatment.cost ?? 0))
    const charged = round2(Number(line.quantity) * round2(Number(line.unitPrice ?? 0)))
    if (charged < price) {
      short.push({ treatmentId: treatment.id, treatmentNo: treatment.treatmentNo, price, charged })
    }
  }

  return {
    total: round2(short.reduce((sum, l) => sum + (l.price - l.charged), 0)),
    lines: short,
  }
}

/**
 * What the patient is let off, all told: the discount plus any treatment
 * priced below its own price, and that as a share of what the bill would have
 * been. The share is what an approval was given for — Rs 2,000 off Rs 20,000
 * is not the same decision as Rs 2,000 off Rs 2,100 (invoice review 6.2).
 */
export function concessionOf(
  discountAmount: number,
  shortfall: number,
  subtotal: number
): { amount: number; percent: number } {
  const amount = round2(Number(discountAmount || 0) + Number(shortfall || 0))
  const base = Number(subtotal || 0) + Number(shortfall || 0)
  return { amount, percent: base > 0 ? (amount / base) * 100 : 0 }
}
