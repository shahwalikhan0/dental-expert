import type { PrismaClient, Prisma, RecareStatus } from '@prisma/client'

/**
 * Recare — who should be in the chair, and is not booked.
 *
 * This is the mechanism a dental practice runs on, and the application did not
 * have it. What it had was appointment reminders: telling somebody about a
 * booking that already exists. Recare is the other half — finding the people
 * with no booking at all, because six months have passed since their last
 * scale and polish and nobody has rung them.
 *
 * The specification's target benefits ask to "reduce missed follow-ups".
 * Nothing in the system could find one.
 *
 * Three ideas, and no more than three:
 *
 *  - a **type** is a kind of recurring visit and how often it comes round
 *    ("scale and polish, every six months"), and it is configuration because
 *    the interval is the practice's clinical policy, not ours;
 *  - a **recare** is one patient's standing date for one type;
 *  - **completing** one moves the date on by the interval rather than deleting
 *    the row, so when somebody was last seen survives.
 */

export type DueBand = 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'SNOOZED' | 'NOT_DUE'

/** How far ahead "due soon" reaches. A month is what a recall list is worked in. */
export const DUE_SOON_DAYS = 30
/** And how far the forward look goes before it stops being actionable. */
export const UPCOMING_DAYS = 90

export interface RecareLike {
  dueDate: Date | string
  snoozedUntil?: Date | string | null
  status?: RecareStatus | string
}

/** A date at midnight, compared as a calendar day rather than an instant. */
function day(value: Date | string): number {
  const date = typeof value === 'string' ? new Date(value) : value
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** Whole days from `from` to `to`; negative when `to` has passed. */
export function daysUntil(to: Date | string, from: Date | string = new Date()): number {
  return Math.round((day(to) - day(from)) / 86400000)
}

/**
 * Which part of the list this falls in.
 *
 * A snoozed recare is its own band rather than being filtered out. "Ring me
 * after Ramadan" is a promise the clinic made, and a list that hides it until
 * the day is a list that forgets it.
 */
export function dueBand(recare: RecareLike, today: Date | string = new Date()): DueBand {
  if (recare.snoozedUntil && daysUntil(recare.snoozedUntil, today) > 0) return 'SNOOZED'

  const days = daysUntil(recare.dueDate, today)
  if (days < 0) return 'OVERDUE'
  if (days <= DUE_SOON_DAYS) return 'DUE_SOON'
  if (days <= UPCOMING_DAYS) return 'UPCOMING'
  return 'NOT_DUE'
}

export const DUE_BAND_LABELS: Record<DueBand, string> = {
  OVERDUE: 'Overdue',
  DUE_SOON: 'Due this month',
  UPCOMING: 'Next 90 days',
  SNOOZED: 'Snoozed',
  NOT_DUE: 'Not due yet',
}

/**
 * The date a recare falls due after a visit on `from`.
 *
 * Month arithmetic, not 30-day arithmetic: a six-month recare set on 31 August
 * is due in February, and a practice reading "28 February" understands it. The
 * clamp is what stops 31 August + 6 months becoming 3 March.
 */
export function nextDueDate(from: Date, intervalMonths: number): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const date = from.getUTCDate()

  const target = new Date(Date.UTC(year, month + intervalMonths, 1))
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate()

  return new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date, lastDayOfTargetMonth))
  )
}

/** The `where` for one band, for the database rather than in memory. */
export function bandFilter(band: DueBand, today: Date = new Date()): Prisma.RecareWhereInput {
  const at = (days: number) => {
    const date = new Date(day(today))
    date.setUTCDate(date.getUTCDate() + days)
    return date
  }

  const notSnoozed: Prisma.RecareWhereInput = {
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: at(0) } }],
  }

  switch (band) {
    case 'OVERDUE':
      return { AND: [notSnoozed, { dueDate: { lt: at(0) } }] }
    case 'DUE_SOON':
      return { AND: [notSnoozed, { dueDate: { gte: at(0), lte: at(DUE_SOON_DAYS) } }] }
    case 'UPCOMING':
      return {
        AND: [notSnoozed, { dueDate: { gt: at(DUE_SOON_DAYS), lte: at(UPCOMING_DAYS) } }],
      }
    case 'SNOOZED':
      return { snoozedUntil: { gt: at(0) } }
    case 'NOT_DUE':
      return { AND: [notSnoozed, { dueDate: { gt: at(UPCOMING_DAYS) } }] }
  }
}

type RecareClient = PrismaClient | Prisma.TransactionClient

/**
 * Start a patient on the clinic's default recare.
 *
 * Called when a patient is registered. Silent when the clinic has set no
 * default — a practice that does not work a recall list should not have rows
 * appearing in one, and this is not the place to argue with that.
 */
export async function startDefaultRecare(
  db: RecareClient,
  hospitalId: string,
  patientId: string,
  from: Date = new Date()
): Promise<void> {
  const type = await db.recareType.findFirst({
    where: { hospitalId, isDefault: true, isActive: true },
    select: { id: true, intervalMonths: true },
  })
  if (!type) return

  await db.recare.upsert({
    where: { patientId_recareTypeId: { patientId, recareTypeId: type.id } },
    update: {},
    create: {
      hospitalId,
      patientId,
      recareTypeId: type.id,
      dueDate: nextDueDate(from, type.intervalMonths),
    },
  })
}

/**
 * Mark a recare done and move it on.
 *
 * The new due date is measured from the visit, not from the date it was
 * previously due: somebody who comes in two months late should next be seen six
 * months from the visit, not four.
 */
export async function completeRecare(
  db: RecareClient,
  recareId: string,
  completedAt: Date = new Date()
): Promise<void> {
  const recare = await db.recare.findUnique({
    where: { id: recareId },
    select: { id: true, recareType: { select: { intervalMonths: true } } },
  })
  if (!recare) return

  await db.recare.update({
    where: { id: recareId },
    data: {
      lastDoneAt: completedAt,
      dueDate: nextDueDate(completedAt, recare.recareType.intervalMonths),
      snoozedUntil: null,
      snoozeReason: null,
    },
  })
}
