import type { PrismaClient, Prisma } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * The scheduling rules the desk books under.
 *
 * Settings → Appointments wrote nine rows and exactly one of them
 * (`doubleBookingPolicy`) was read by anything. A clinic could set its slot
 * length to twenty minutes, save it, and watch the book go on offering times
 * every half hour — which is the same class of falsehood as a feature that does
 * not exist, except harder to spot, because the screen says it worked.
 *
 * Two of the nine are not here, and deliberately. `startTime` and `endTime`
 * duplicated `Hospital.workingHours`, which holds opening hours *per weekday*
 * and is what every slot query already reads. Two places to set one thing is
 * how a clinic ends up with a book that disagrees with its own front door, so
 * the flat pair was removed from the screen rather than wired into a second
 * source of truth. See the note on the clinic's week in docs/ROADMAP.md §5.
 */
export interface AppointmentSettings {
  /**
   * How often a slot is offered, in minutes.
   *
   * Not how long an appointment lasts — the desk chooses that per booking. This
   * is the granularity of the grid: at 15 the book offers 09:00, 09:15, 09:30;
   * at 30 it offers 09:00 and 09:30. It was hard-coded at 30.
   */
  slotDuration: number
  /**
   * Minutes left clear after an appointment before the next may start.
   *
   * Turning the chair round, writing the note, showing somebody out. A clinic
   * that sets ten minutes here and books back-to-back anyway runs late all day,
   * which is the complaint this setting exists to answer.
   */
  bufferTime: number
  /** The clinic's lunch break, as `HH:MM`, or null when it does not stop. */
  lunchBreakStart: string | null
  lunchBreakEnd: string | null
  /**
   * How far ahead the desk may book, in days — or null for no limit.
   *
   * The public page has had a horizon since it shipped (`booking.horizonDays`);
   * this is the same rule for staff, and it was stored and ignored.
   *
   * Null when the clinic has never set one, and that is deliberate rather than
   * a missing default. A practice that has been booking two years ahead for a
   * decade should not discover on upgrade that the software has quietly decided
   * six months is enough — and dentistry books six-month recalls, so any
   * default tight enough to be useful is tight enough to refuse ordinary work.
   * The limit applies once somebody has asked for one.
   */
  maxAdvanceBookingDays: number | null
  /** How many hours before an appointment the reminder goes out. */
  reminderHoursBefore: number
  /** FR-004: BLOCK refuses a clashing booking, WARN records it and flags it. */
  doubleBookingPolicy: 'BLOCK' | 'WARN'
}

export const DEFAULT_APPOINTMENT_SETTINGS: AppointmentSettings = {
  slotDuration: 30,
  bufferTime: 0,
  lunchBreakStart: null,
  lunchBreakEnd: null,
  maxAdvanceBookingDays: null,
  reminderHoursBefore: 24,
  doubleBookingPolicy: 'BLOCK',
}

export const APPOINTMENT_CATEGORY = 'appointments'

export const APPOINTMENT_KEYS = {
  slotDuration: 'appointments.slotDuration',
  bufferTime: 'appointments.bufferTime',
  lunchBreakStart: 'appointments.lunchBreakStart',
  lunchBreakEnd: 'appointments.lunchBreakEnd',
  maxAdvanceBookingDays: 'appointments.maxAdvanceBookingDays',
  reminderHoursBefore: 'appointments.reminderHoursBefore',
  doubleBookingPolicy: 'appointments.doubleBookingPolicy',
} as const

/**
 * A stored setting as a number, clamped.
 *
 * Values arrive JSON-encoded from the settings route and bare from anything
 * else that has ever written one, so both are accepted. Clamping rather than
 * rejecting: a nonsense slot length should give a clinic a usable book, not an
 * empty one.
 */
function asNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback
  let value: unknown = raw
  try {
    value = JSON.parse(raw)
  } catch {
    // A bare value, written by something other than the settings route.
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), min), max)
}

/** A stored setting as `HH:MM`, or null if it is not one. */
function asTime(raw: string | undefined): string | null {
  if (raw === undefined) return null
  let value: unknown = raw
  try {
    value = JSON.parse(raw)
  } catch {
    /* a bare value */
  }
  if (typeof value !== 'string') return null
  return /^\d{2}:\d{2}$/.test(value) ? value : null
}

export async function readAppointmentSettings(
  db: Db,
  hospitalId: string
): Promise<AppointmentSettings> {
  const rows = await db.setting.findMany({
    where: { hospitalId, key: { in: Object.values(APPOINTMENT_KEYS) } },
    select: { key: true, value: true },
  })

  const stored = new Map(rows.map((row) => [row.key, row.value]))

  const lunchStart = asTime(stored.get(APPOINTMENT_KEYS.lunchBreakStart))
  const lunchEnd = asTime(stored.get(APPOINTMENT_KEYS.lunchBreakEnd))

  return {
    // Fifteen minutes is the finest grid worth drawing; five would make the
    // book unreadable and is not how anybody schedules dentistry.
    slotDuration: asNumber(stored.get(APPOINTMENT_KEYS.slotDuration), 30, 5, 120),
    bufferTime: asNumber(stored.get(APPOINTMENT_KEYS.bufferTime), 0, 0, 60),
    // Half a break is not a break. Both ends, in order, or neither.
    lunchBreakStart: lunchStart && lunchEnd && lunchEnd > lunchStart ? lunchStart : null,
    lunchBreakEnd: lunchStart && lunchEnd && lunchEnd > lunchStart ? lunchEnd : null,
    maxAdvanceBookingDays:
      stored.get(APPOINTMENT_KEYS.maxAdvanceBookingDays) === undefined
        ? null
        : asNumber(stored.get(APPOINTMENT_KEYS.maxAdvanceBookingDays), 365, 1, 3650),
    reminderHoursBefore: asNumber(stored.get(APPOINTMENT_KEYS.reminderHoursBefore), 24, 1, 168),
    doubleBookingPolicy:
      stripQuotes(stored.get(APPOINTMENT_KEYS.doubleBookingPolicy)) === 'WARN' ? 'WARN' : 'BLOCK',
  }
}

function stripQuotes(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : raw
  } catch {
    return raw
  }
}
