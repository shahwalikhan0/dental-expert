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

// ────────────────────────────────────────────────────────────────────────────
// Expiry (FR-016)
// ────────────────────────────────────────────────────────────────────────────

/** The two alerts about a date rather than a quantity. */
const EXPIRY_TYPES = [StockAlertType.EXPIRING_SOON, StockAlertType.EXPIRED] as const

export const EXPIRY_WARNING_DAYS_KEY = 'inventory.expiryWarningDays'
export const DEFAULT_EXPIRY_WARNING_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Which expiry alert a batch warrants, if any.
 *
 * Neither of these has ever been raised. `EXPIRING_SOON` and `EXPIRED` have
 * been in `StockAlertType` since the fork with no code that creates them, so
 * the "Expiring soon" figure on the alerts screen was structurally zero — and
 * before goods receipt existed there were no expiry dates to raise them from
 * anyway.
 *
 * A batch with nothing left in it warrants nothing. Expiry is about stock the
 * clinic still has and is about to lose, and an empty batch is neither.
 */
export function expiryFor(
  batch: { expiryDate: Date | null; remainingQty: number },
  at: Date,
  warningDays: number = DEFAULT_EXPIRY_WARNING_DAYS
): StockAlertType | null {
  if (!batch.expiryDate || batch.remainingQty <= 0) return null

  // Expired on the day, not the day after: a cartridge dated the 30th is not
  // to be used on the 30th.
  if (batch.expiryDate.getTime() <= at.getTime()) return StockAlertType.EXPIRED

  const warnFrom = at.getTime() + warningDays * MS_PER_DAY
  return batch.expiryDate.getTime() <= warnFrom ? StockAlertType.EXPIRING_SOON : null
}

export interface ExpirySweep {
  raised: number
  cleared: number
  checked: number
}

/**
 * Bring a clinic's expiry alerts into line with its batches.
 *
 * Unlike a shortage, an expiry alert becomes true because the calendar moved,
 * not because anything happened — so this is a sweep rather than something a
 * stock movement triggers. It is idempotent: running it twice raises nothing
 * the first run did not.
 *
 * **Acknowledged alerts are read but never touched.** An acknowledged alert
 * means somebody has dealt with the batch — pulled it off the shelf, or
 * ordered a replacement — and the batch is still expired the next morning, so
 * a sweep that ignored the acknowledgement would raise the same alert again
 * every day and the button would mean nothing.
 *
 * The exception is a batch that crosses from EXPIRING_SOON to EXPIRED. That is
 * a different and worse fact, and it is raised again even if the warning was
 * acknowledged.
 */
export async function reconcileExpiryAlerts(
  db: Db,
  state: { hospitalId: string; at?: Date; warningDays?: number }
): Promise<ExpirySweep> {
  const at = state.at ?? new Date()
  const warningDays = state.warningDays ?? DEFAULT_EXPIRY_WARNING_DAYS

  const batches = await db.inventoryBatch.findMany({
    where: { hospitalId: state.hospitalId, expiryDate: { not: null }, item: { deletedAt: null } },
    select: { id: true, itemId: true, expiryDate: true, remainingQty: true },
  })

  // Acknowledged ones included, so the sweep can see what has been dealt with.
  const existing = await db.stockAlert.findMany({
    where: { hospitalId: state.hospitalId, alertType: { in: [...EXPIRY_TYPES] } },
    select: { id: true, batchId: true, alertType: true, isAcknowledged: true },
  })

  const byBatch = new Map<string, typeof existing>()
  for (const alert of existing) {
    if (!alert.batchId) continue
    const list = byBatch.get(alert.batchId)
    if (list) list.push(alert)
    else byBatch.set(alert.batchId, [alert])
  }

  const stale: string[] = []
  let raised = 0

  for (const batch of batches) {
    const warranted = expiryFor(batch, at, warningDays)
    const alerts = byBatch.get(batch.id) ?? []
    byBatch.delete(batch.id)

    // Anything saying something other than the current truth is noise — but
    // only if nobody has acknowledged it.
    for (const alert of alerts) {
      if (alert.alertType !== warranted && !alert.isAcknowledged) stale.push(alert.id)
    }

    if (!warranted) continue

    // Already said, acknowledged or not. Saying it again daily is how an
    // acknowledgement stops meaning anything.
    if (alerts.some((a) => a.alertType === warranted)) continue

    await db.stockAlert.create({
      data: {
        hospitalId: state.hospitalId,
        itemId: batch.itemId,
        batchId: batch.id,
        alertType: warranted,
      },
    })
    raised++
  }

  // Alerts whose batch has gone, and legacy ones raised against no batch at
  // all. Acknowledged ones stay: they are a record of what somebody did.
  for (const orphans of byBatch.values()) {
    for (const alert of orphans) if (!alert.isAcknowledged) stale.push(alert.id)
  }
  for (const legacy of existing) {
    if (!legacy.batchId && !legacy.isAcknowledged) stale.push(legacy.id)
  }

  if (stale.length > 0) {
    await db.stockAlert.deleteMany({ where: { id: { in: stale } } })
  }

  return { raised, cleared: stale.length, checked: batches.length }
}

/** The clinic's warning window, in days. */
export async function expiryWarningDays(db: Db, hospitalId: string): Promise<number> {
  const setting = await db.setting.findUnique({
    where: { hospitalId_key: { hospitalId, key: EXPIRY_WARNING_DAYS_KEY } },
    select: { value: true },
  })

  const parsed = Number(setting?.value)
  // A blank or malformed setting falls back to the default rather than to
  // zero, which would silence every warning until the day of expiry.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXPIRY_WARNING_DAYS
}
