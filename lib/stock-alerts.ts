/**
 * Raising and clearing stock shortage alerts.
 *
 * This logic existed three times — in the stock-movement route, in the item
 * update route, and in the seed — as three hand-written copies of "find an open
 * alert of this type, and create one if there isn't". They had drifted in the
 * way copies do: only the movement route ever *cleared* an alert when stock
 * recovered. Raising an item's minimum stock and then lowering it again left a
 * LOW_STOCK alert standing over a full shelf, and the only way to make it go
 * away was to acknowledge an alert that was no longer true.
 *
 * The alert table itself stays. It is tempting to derive the whole list from
 * `currentStock <= minimumStock` and drop it — but an alert carries an
 * acknowledgement: who saw it, when, and what they wrote. That is not a
 * function of stock levels, and a clinic that has already ordered more gloves
 * needs the alert to stop shouting without the stock level having changed yet.
 */
import { StockAlertType } from '@prisma/client'
import type { Prisma, PrismaClient } from '@prisma/client'

/** Works against the client or a transaction — both are used by callers. */
type Db = PrismaClient | Prisma.TransactionClient

/** The two alerts that describe a shortage, as opposed to an expiry. */
const SHORTAGE_TYPES = [StockAlertType.OUT_OF_STOCK, StockAlertType.LOW_STOCK] as const

/**
 * Which shortage alert an item's stock level warrants, if any.
 *
 * At or below zero is out of stock; at or below the minimum is low. Note
 * `<=` on the minimum rather than `<`: an item sitting exactly on its reorder
 * threshold is the moment to reorder, not the moment before.
 */
export function shortageFor(currentStock: number, minimumStock: number): StockAlertType | null {
  if (currentStock <= 0) return StockAlertType.OUT_OF_STOCK
  if (currentStock <= minimumStock) return StockAlertType.LOW_STOCK
  return null
}

export interface StockState {
  hospitalId: string
  itemId: string
  currentStock: number
  minimumStock: number
}

/**
 * Bring an item's shortage alerts into line with its stock level.
 *
 * Raises the one alert the level warrants if it is not already open, and
 * removes any open shortage alert that no longer applies — including the case
 * where an item goes from OUT_OF_STOCK to merely LOW_STOCK, which the previous
 * code left showing both.
 *
 * Only *unacknowledged* alerts are removed. An acknowledged one is a record
 * that somebody dealt with it, and deleting that would erase the evidence
 * along with the noise.
 */
export async function reconcileStockAlerts(db: Db, state: StockState): Promise<void> {
  const warranted = shortageFor(state.currentStock, state.minimumStock)

  const stale = SHORTAGE_TYPES.filter((type) => type !== warranted)
  await db.stockAlert.deleteMany({
    where: { itemId: state.itemId, alertType: { in: [...stale] }, isAcknowledged: false },
  })

  if (!warranted) return

  const open = await db.stockAlert.findFirst({
    where: { itemId: state.itemId, alertType: warranted, isAcknowledged: false },
    select: { id: true },
  })

  if (open) return

  await db.stockAlert.create({
    data: { hospitalId: state.hospitalId, itemId: state.itemId, alertType: warranted },
  })
}
