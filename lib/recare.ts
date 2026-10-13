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

/**
 * How long before the same patient may be chased about the same recare again.
 *
 * A fortnight. Short enough that a second attempt is still part of the same
 * campaign; long enough that working the list twice in a week cannot send two
 * messages. The desk can still override it — see `force` — because sometimes
 * you know the first one did not arrive.
 */
export const RECALL_COOLDOWN_DAYS = 14

/**
 * What a clinic starts with.
 *
 * The migration that added recare inserted these for every clinic that already
 * existed. A clinic created *afterwards* — by signup, or by a fresh database —
 * would have had none, and a recall module with no types is inert: every
 * patient registers, nobody is ever put on a list, and nothing says why. So the
 * list lives here and every path that creates a clinic uses it.
 *
 * The intervals are a starting point, not a clinical instruction. They are
 * configuration precisely so the practice can set its own.
 */
export const DEFAULT_RECARE_TYPES = [
  {
    name: 'Scale and polish',
    intervalMonths: 6,
    description: 'Routine hygiene visit',
    isDefault: true,
  },
  {
    name: 'Child check-up',
    intervalMonths: 6,
    description: 'Routine examination for a child',
    isDefault: false,
  },
  {
    name: 'Periodontal maintenance',
    intervalMonths: 3,
    description: 'For patients under periodontal care',
    isDefault: false,
  },
] as const

export function defaultRecareTypesFor(hospitalId: string) {
  return DEFAULT_RECARE_TYPES.map((type, index) => ({
    hospitalId,
    name: type.name,
    intervalMonths: type.intervalMonths,
    description: type.description,
    isDefault: type.isDefault,
    sortOrder: index,
  }))
}

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

/**
 * Which recalls a completed treatment carries out.
 *
 * There is no column linking a recare type to a procedure: a type is a name
 * and an interval the clinic sets, and a procedure is a catalogue entry it
 * names itself. So completing a scale and polish left the patient's "Scale and
 * polish" recall due on the old date, with no last-done date, until somebody
 * remembered to press Mark as done as well (bug report 12 Oct, finding 46).
 *
 * The link is made here from the two things both sides do carry — what they
 * are called, and the procedure's category — and it is deliberately narrow.
 * Each family needs the recare type's name *and* the procedure's name to say
 * the same kind of visit, and the procedure to be in a category that kind of
 * visit belongs to. A filling, a crown or an extraction matches nothing, so the
 * worry the complete route used to give for not guessing — a hygiene recall
 * pushed six months out because a filling was done — cannot happen. A clinic
 * that names its types or procedures in some other way loses only the
 * automation, and Mark as done is still there.
 *
 * A schema link (a procedure list on the recare type) would be better and
 * would replace this; it needs a migration, which this change does not make.
 */
export const RECARE_PROCEDURE_FAMILIES = [
  {
    // "Scale and polish", "Hygiene visit" — done by a scaling, a polish or a
    // cleaning, preventive or periodontal.
    family: 'hygiene',
    type: /scal(e|ing)|polish|hygien|clean|prophy/i,
    procedure: /scal(e|ing)|polish|clean|prophy|hygien/i,
    categories: ['PREVENTIVE', 'PERIODONTIC'],
  },
  {
    // "Periodontal maintenance" — done by periodontal scaling, root planing or
    // supportive periodontal therapy. A routine scale and polish is not
    // periodontal care and does not move it.
    family: 'periodontal',
    type: /perio/i,
    procedure: /perio|root planing|debridement/i,
    categories: ['PERIODONTIC', 'PREVENTIVE'],
  },
  {
    // "Child check-up", "Recall examination" — done by an examination or a
    // check-up, not by a consultation about something specific.
    family: 'examination',
    type: /check[\s-]?up|exam/i,
    procedure: /check[\s-]?up|exam/i,
    categories: ['DIAGNOSTIC', 'PREVENTIVE'],
  },
] as const

export interface RecareProcedureLike {
  name: string
  category: string
}

/** Does completing this procedure count as a visit of this recare type? */
export function recareTypeMatchesProcedure(
  type: { name: string },
  procedure: RecareProcedureLike
): boolean {
  return RECARE_PROCEDURE_FAMILIES.some(
    (family) =>
      family.type.test(type.name) &&
      family.procedure.test(procedure.name) &&
      (family.categories as readonly string[]).includes(procedure.category)
  )
}

export interface RecallMoved {
  id: string
  name: string
  dueDate: Date
}

/**
 * Move on every recall of this patient's that the procedure carries out, the
 * same way Mark as done does — `completeRecare`, measured from the visit.
 *
 * Only the patient's own recalls are touched; a type they are not on is not
 * started here. Returns what moved, so the screen can say so.
 */
export async function completeRecaresForProcedure(
  db: RecareClient,
  args: {
    hospitalId: string
    patientId: string
    procedure: RecareProcedureLike
    completedAt?: Date
    /** Already moved by the caller, by id. */
    except?: string[]
  }
): Promise<RecallMoved[]> {
  const completedAt = args.completedAt ?? new Date()
  const recares =
    (await db.recare.findMany({
      where: { hospitalId: args.hospitalId, patientId: args.patientId },
      select: { id: true, recareType: { select: { name: true, intervalMonths: true } } },
    })) ?? []

  const moved: RecallMoved[] = []
  for (const recare of recares) {
    if (args.except?.includes(recare.id)) continue
    if (!recareTypeMatchesProcedure(recare.recareType, args.procedure)) continue
    await completeRecare(db, recare.id, completedAt)
    moved.push({
      id: recare.id,
      name: recare.recareType.name,
      dueDate: nextDueDate(completedAt, recare.recareType.intervalMonths),
    })
  }
  return moved
}
