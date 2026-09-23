/**
 * Reading the drug catalogue's stock link.
 *
 * `Medication` and `InventoryItem` were two unconnected tables until
 * InventoryItem.medicationId joined them, so every screen that wants to say
 * "12 left" has to fold the same list of stock rows the same way. One place to
 * do it, because "low" has to mean the same thing on the catalogue, in the
 * prescription form and anywhere else it is shown.
 */

export interface MedicationStockRow {
  id: string
  name: string
  unit: string
  currentStock: number
  minimumStock: number
}

export type MedicationStockState =
  /** No inventory row points at this drug, so stock is unknown, not zero. */
  | 'unlinked'
  /** Linked and nothing left. */
  | 'out'
  /** Linked, some left, at or below the minimum somebody set. */
  | 'low'
  | 'ok'

export interface MedicationStock {
  state: MedicationStockState
  /** Units across every pack size, or null when nothing is linked. */
  total: number | null
  /** The unit, when every linked row agrees on one. Mixed packs give null. */
  unit: string | null
  /** Short sentence for a badge or a hint. */
  label: string
}

/**
 * Fold a drug's stock rows into one answer.
 *
 * "Unlinked" is deliberately not "out of stock". An unlinked drug is one
 * nobody has connected to a shelf yet, which is the state every drug is in
 * the day this feature ships; showing that as "out of stock" would put a red
 * warning on a full pharmacy and teach prescribers to ignore the warning.
 */
export function medicationStock(rows: MedicationStockRow[] | null | undefined): MedicationStock {
  if (!rows || rows.length === 0) {
    return { state: 'unlinked', total: null, unit: null, label: 'Stock not tracked' }
  }

  const total = rows.reduce((sum, row) => sum + row.currentStock, 0)

  // Only when they agree. Two pack sizes measured in "box" and "strip" have no
  // shared unit, and inventing one would misstate the quantity.
  const units = new Set(rows.map((row) => row.unit).filter(Boolean))
  const unit = units.size === 1 ? [...units][0] : null

  if (total <= 0) return { state: 'out', total: 0, unit, label: 'Out of stock' }

  // Against the sum of the minimums, so a drug stocked as two pack sizes is
  // judged by what the clinic holds altogether rather than by whichever row
  // happens to be running low on its own.
  const minimum = rows.reduce((sum, row) => sum + row.minimumStock, 0)
  const quantity = unit ? `${total} ${unit}` : `${total}`

  if (total <= minimum) return { state: 'low', total, unit, label: `Low stock — ${quantity} left` }
  return { state: 'ok', total, unit, label: `${quantity} in stock` }
}
