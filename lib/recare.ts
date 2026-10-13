import type { PrismaClient, Prisma, RecareStatus } from '@prisma/client'
import { z } from 'zod'
import { DEFAULT_TIMEZONE, clinicTimezone, localDay } from '@/lib/appointment-time'

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
 *
 * `satisfiedBy` is which catalogue procedures each one starts linked to — the
 * procedures whose completion moves the recall on (finding 46). It is used
 * only when a clinic is set up or a procedure is added (`defaultProcedureLinks`);
 * completing a treatment reads the stored link, which the clinic can change.
 * These are the rules the application used to apply by name at completion
 * time, and the migration that added the link wrote them down for existing
 * clinics the same way.
 */
export const DEFAULT_RECARE_TYPES = [
  {
    name: 'Scale and polish',
    intervalMonths: 6,
    description: 'Routine hygiene visit',
    isDefault: true,
    // A scaling, a polish or a cleaning, preventive or periodontal.
    satisfiedBy: {
      name: /scal(e|ing)|polish|clean|prophy|hygien/i,
      categories: ['PREVENTIVE', 'PERIODONTIC'],
    },
  },
  {
    name: 'Child check-up',
    intervalMonths: 6,
    description: 'Routine examination for a child',
    isDefault: false,
    // An examination or a check-up, not a consultation about something
    // specific.
    satisfiedBy: {
      name: /check[\s-]?up|exam/i,
      categories: ['DIAGNOSTIC', 'PREVENTIVE'],
    },
  },
  {
    name: 'Periodontal maintenance',
    intervalMonths: 3,
    description: 'For patients under periodontal care',
    isDefault: false,
    // Periodontal scaling, root planing, supportive periodontal therapy. A
    // routine scale and polish is not periodontal care and does not move it.
    satisfiedBy: {
      name: /perio|root planing|debridement/i,
      categories: ['PERIODONTIC', 'PREVENTIVE'],
    },
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
 *
 * The visit's day is the clinic's calendar day. It was read in UTC, so a
 * scaling completed at 00:20 on 14 October in Karachi — still the 13th in UTC —
 * set the recall for 13 April instead of 14 April.
 */
export function nextDueDate(
  from: Date,
  intervalMonths: number,
  timezone: string = DEFAULT_TIMEZONE
): Date {
  const [year, monthNumber, date] = localDay(from, timezone).split('-').map(Number)
  const month = monthNumber - 1

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

  const timezone = await clinicTimezone(db, hospitalId)
  await db.recare.upsert({
    where: { patientId_recareTypeId: { patientId, recareTypeId: type.id } },
    update: {},
    create: {
      hospitalId,
      patientId,
      recareTypeId: type.id,
      dueDate: nextDueDate(from, type.intervalMonths, timezone),
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
    select: {
      id: true,
      recareType: { select: { intervalMonths: true } },
      hospital: { select: { timezone: true } },
    },
  })
  if (!recare) return

  await db.recare.update({
    where: { id: recareId },
    data: {
      lastDoneAt: completedAt,
      dueDate: nextDueDate(
        completedAt,
        recare.recareType.intervalMonths,
        recare.hospital.timezone || DEFAULT_TIMEZONE
      ),
      snoozedUntil: null,
      snoozeReason: null,
    },
  })
}

export interface RecallMoved {
  id: string
  name: string
  dueDate: Date
}

/**
 * Which of a patient's recalls a completed treatment carries out: those whose
 * type the clinic has linked to the treatment's procedure (bug report 12 Oct,
 * finding 46).
 *
 * The link is stored — `RecareType.procedures`, chosen on the recall types
 * screen — and nothing else counts. It used to be guessed from the type's and
 * the procedure's names and the procedure's category, which meant a clinic
 * that called its hygiene visit something else got no automation and could not
 * see why. The guess was written into the links once, by the migration that
 * added them, so existing clinics kept what they had.
 *
 * A procedure linked to nothing moves nothing: a filling, a crown or an
 * extraction never pushes a hygiene recall six months out.
 */
export function recaresForProcedureWhere(args: {
  hospitalId: string
  patientId: string
  procedureId: string
  /** Already moved by the caller, by id. */
  except?: string[]
}): Prisma.RecareWhereInput {
  return {
    hospitalId: args.hospitalId,
    patientId: args.patientId,
    recareType: { hospitalId: args.hospitalId, procedures: { some: { id: args.procedureId } } },
    ...(args.except && args.except.length > 0 ? { id: { notIn: args.except } } : {}),
  }
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
    procedureId: string
    completedAt?: Date
    /** Already moved by the caller, by id. */
    except?: string[]
  }
): Promise<RecallMoved[]> {
  const completedAt = args.completedAt ?? new Date()
  const recares =
    (await db.recare.findMany({
      where: recaresForProcedureWhere(args),
      select: { id: true, recareType: { select: { name: true, intervalMonths: true } } },
    })) ?? []

  const timezone = recares.length > 0 ? await clinicTimezone(db, args.hospitalId) : DEFAULT_TIMEZONE
  const moved: RecallMoved[] = []
  for (const recare of recares) {
    await completeRecare(db, recare.id, completedAt)
    moved.push({
      id: recare.id,
      name: recare.recareType.name,
      dueDate: nextDueDate(completedAt, recare.recareType.intervalMonths, timezone),
    })
  }
  return moved
}

// ── Choosing the procedures ───────────────────────────────────────────────

/** How a recall type's linked procedures are read back, everywhere. */
export const RECARE_TYPE_PROCEDURES_SELECT = {
  select: { id: true, name: true, code: true, category: true, isActive: true },
  orderBy: { name: 'asc' },
} satisfies Prisma.RecareType$proceduresArgs

/**
 * `procedureIds` from a request body: a list of ids, or a 400 (the ZodError
 * becomes one through `knownErrorResponse`). Five hundred is more than any
 * catalogue has, and a bound on what one request can ask the database for.
 */
export function parseProcedureIds(value: unknown): string[] {
  return z
    .array(z.string().trim().min(1), {
      error: 'procedureIds must be a list of procedure ids',
    })
    .max(500)
    .parse(value)
}

export interface LinkableProcedure {
  id: string
  name: string
  isActive: boolean
}

export type ProcedureIdsCheck = { ok: true; ids: string[] } | { ok: false; error: string }

/**
 * Is this a procedure list a recall type may be given?
 *
 * `found` is what the database returned for the requested ids *within this
 * clinic*, so an id that is missing from it is another clinic's procedure or
 * none at all — either way not one this clinic can link. An inactive procedure
 * cannot be newly linked (it is not offered on the screen, and a recall that
 * waits on a procedure nobody can choose any more is not a recall), but one
 * that was linked before it was deactivated may stay: saving the type for
 * another reason should not fail on it.
 */
export function checkRecareProcedureIds(
  requested: readonly string[],
  found: readonly LinkableProcedure[],
  alreadyLinked: readonly string[] = []
): ProcedureIdsCheck {
  const ids = Array.from(new Set(requested.map((id) => id.trim()).filter(Boolean)))
  const byId = new Map(found.map((procedure) => [procedure.id, procedure]))

  const unknown = ids.filter((id) => !byId.has(id))
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        unknown.length === 1
          ? 'One of the chosen procedures is not in this clinic’s catalogue'
          : `${unknown.length} of the chosen procedures are not in this clinic’s catalogue`,
    }
  }

  const inactive = ids
    .map((id) => byId.get(id)!)
    .filter((procedure) => !procedure.isActive && !alreadyLinked.includes(procedure.id))
  if (inactive.length > 0) {
    const names = inactive.map((procedure) => procedure.name).join(', ')
    return {
      ok: false,
      error: `${names} ${inactive.length === 1 ? 'is' : 'are'} inactive and cannot be linked to a recall`,
    }
  }

  return { ok: true, ids }
}

// ── What a new clinic starts linked to ───────────────────────────────────

export interface DefaultLinkProcedure {
  id: string
  name: string
  category: string
  isActive: boolean
}

/**
 * Which procedures each of the clinic's *default* recall types starts linked
 * to.
 *
 * Only for setting a clinic up — the seed, signup, and a procedure being added
 * to the catalogue — never at completion time, which reads the stored link
 * and nothing else. A type is matched to its default by its exact name, so a
 * type the clinic has renamed or added itself is left for the clinic to link.
 * Whatever this proposes is visible, and changeable, on the recall types
 * screen.
 */
export function defaultProcedureLinks(
  types: readonly { id: string; name: string }[],
  procedures: readonly DefaultLinkProcedure[]
): { recareTypeId: string; procedureIds: string[] }[] {
  const links: { recareTypeId: string; procedureIds: string[] }[] = []
  for (const type of types) {
    const preset = DEFAULT_RECARE_TYPES.find(
      (candidate) => candidate.name.toLowerCase() === type.name.trim().toLowerCase()
    )
    if (!preset) continue

    const procedureIds = procedures
      .filter(
        (procedure) =>
          procedure.isActive &&
          (preset.satisfiedBy.categories as readonly string[]).includes(procedure.category) &&
          preset.satisfiedBy.name.test(procedure.name)
      )
      .map((procedure) => procedure.id)
    if (procedureIds.length > 0) links.push({ recareTypeId: type.id, procedureIds })
  }
  return links
}

/**
 * Write `defaultProcedureLinks` for a clinic. Adds links, never removes one.
 *
 * Pass `procedureIds` to consider only those procedures — a procedure just
 * added to the catalogue — so that what the clinic has unlinked from the other
 * procedures stays unlinked.
 */
export async function linkDefaultRecareProcedures(
  db: RecareClient,
  hospitalId: string,
  procedureIds?: string[]
): Promise<void> {
  const [types, procedures] = await Promise.all([
    db.recareType.findMany({ where: { hospitalId }, select: { id: true, name: true } }),
    db.procedure.findMany({
      where: { hospitalId, ...(procedureIds ? { id: { in: procedureIds } } : {}) },
      select: { id: true, name: true, category: true, isActive: true },
    }),
  ])

  for (const link of defaultProcedureLinks(types, procedures)) {
    await db.recareType.update({
      where: { id: link.recareTypeId },
      data: { procedures: { connect: link.procedureIds.map((id) => ({ id })) } },
    })
  }
}
