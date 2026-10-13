/**
 * Rules for the values an inventory item is created or edited with.
 *
 * Kept apart from the routes so the create and edit routes cannot disagree
 * about them, which is how the SKU and price rules drifted in the first place.
 */
import { PurchaseOrderStatus } from '@prisma/client'

/**
 * A SKU as the clinic stores it: trimmed and upper-cased.
 *
 * `cmp-a2` was accepted beside `CMP-A2` (bug report 12 Oct, finding 57) —
 * two records for one product, each with half the stock. One spelling on the
 * way in is what makes the unique index mean what it says; the routes also
 * compare case-insensitively, for rows saved before this.
 */
export function normaliseSku(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const sku = String(value).trim().toUpperCase()
  return sku === '' ? null : sku
}

/**
 * The first numeric field that is not a number of zero or more, as a sentence
 * a toast can show, or null.
 *
 * A purchase price of −5 and an opening stock of −10 were both accepted
 * (finding 57). Absent and null are left to the caller's defaults; only a
 * value that was sent is checked.
 */
export function negativeField(
  values: Record<string, unknown>,
  fields: { name: string; label: string; integer?: boolean }[]
): string | null {
  for (const { name, label, integer } of fields) {
    const raw = values[name]
    if (raw === undefined || raw === null || raw === '') continue
    const n = Number(raw)
    if (!Number.isFinite(n)) return `${label} must be a number`
    if (n < 0) return `${label} cannot be negative`
    if (integer && !Number.isInteger(n)) return `${label} must be a whole number`
  }
  return null
}

export const ITEM_NUMBER_FIELDS = [
  { name: 'purchasePrice', label: 'Purchase price' },
  { name: 'sellingPrice', label: 'Selling price' },
  { name: 'taxPercentage', label: 'Tax percentage' },
  { name: 'currentStock', label: 'Opening stock', integer: true },
  { name: 'minimumStock', label: 'Minimum stock', integer: true },
  { name: 'reorderLevel', label: 'Reorder level', integer: true },
  { name: 'maximumStock', label: 'Maximum stock', integer: true },
]

/**
 * Purchase orders that are still live: not yet placed, placed, or partly
 * received. An item or supplier on one of these cannot be deleted
 * (finding 44) — GIC restorative was deleted while on draft order PO20260002,
 * which was then sent to a deleted supplier for a deleted item.
 */
export const OPEN_ORDER_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.DRAFT,
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
]
