/**
 * When the clinic is open, on a given day.
 *
 * `Hospital.workingHours` is a JSON string holding one entry per weekday:
 *
 *     {"monday":{"open":"09:00","close":"20:00"}, …, "sunday":{"open":null,"close":null}}
 *
 * That is the shape the settings screen writes, the shape onboarding writes,
 * and the shape the seed writes. It was not the shape anything read. Both slot
 * routes did `JSON.parse(hospital.workingHours)` into a variable they had
 * typed `{ start, end, lunchStart, lunchEnd }` — a shape nothing has ever
 * stored — and then called `.split(':')` on `workingHours.start`, which is
 * `undefined`. The parse succeeded, so the defaults behind it never applied and
 * the route threw.
 *
 * The effect was that the time-slot picker returned 500 for every clinic that
 * had ever saved its hours: the appointment booking screen's slot list and the
 * public booking page both. Only a clinic that had never touched the setting —
 * where the column is still NULL — got as far as generating slots.
 */

export interface DayHours {
  /** `HH:MM`, the clinic's own wall clock. */
  open: string
  close: string
  /** A midday break, if the clinic has recorded one. */
  lunch?: { start: string; end: string }
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

/**
 * What a clinic with nothing configured is treated as.
 *
 * Kept as it was, lunch break included, so the one case that did work — a
 * clinic whose `workingHours` is still NULL — behaves exactly as before.
 */
export const DEFAULT_DAY_HOURS: DayHours = {
  open: '09:00',
  close: '21:00',
  lunch: { start: '13:00', end: '14:00' },
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function time(value: unknown): string | null {
  return typeof value === 'string' && TIME.test(value.trim()) ? value.trim() : null
}

/**
 * The clinic's hours on one calendar day, or null if it is closed that day.
 *
 * `day` is `YYYY-MM-DD` on the clinic's own calendar — the weekday is taken
 * from it directly rather than from a `Date` the host would read in its own
 * timezone.
 *
 * A stored day with no open or close time means closed, which is how the
 * settings screen records Sunday. Malformed times are treated as absent rather
 * than trusted into `parseInt`: this column is free text.
 */
export function hoursOn(raw: string | null | undefined, day: string): DayHours | null {
  if (!raw) return DEFAULT_DAY_HOURS

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_DAY_HOURS
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_DAY_HOURS

  // An object naming none of the seven days is not a schedule — an older
  // `{ start, end }` shape, say — and is treated as no configuration rather
  // than as a clinic that is shut every day of the week.
  if (!WEEKDAYS.some((d) => d in parsed)) return DEFAULT_DAY_HOURS

  const weekday = WEEKDAYS[new Date(`${day.slice(0, 10)}T00:00:00Z`).getUTCDay()]
  const stored = parsed[weekday] as Record<string, unknown> | undefined
  if (!stored || typeof stored !== 'object') return null

  const open = time(stored.open)
  const close = time(stored.close)
  if (!open || !close || close <= open) return null

  const lunch = stored.lunch as Record<string, unknown> | undefined
  const lunchStart = lunch ? time(lunch.start) : null
  const lunchEnd = lunch ? time(lunch.end) : null

  return {
    open,
    close,
    ...(lunchStart && lunchEnd && lunchEnd > lunchStart
      ? { lunch: { start: lunchStart, end: lunchEnd } }
      : {}),
  }
}

/** `HH:MM` to minutes since midnight. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** Minutes since midnight back to `HH:MM`. */
export function timeOf(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** How far apart the offered slots are. */
export const SLOT_STEP_MINUTES = 30

export interface BookedSlot {
  /** `HH:MM` on the clinic's wall clock. */
  start: string
  duration: number
}

export interface SlotQuery {
  hours: DayHours
  /** A doctor's own shift, which narrows the clinic's hours when set. */
  shift?: { startTime?: string | null; endTime?: string | null } | null
  /** How long the appointment being booked will run. */
  duration: number
  booked: BookedSlot[]
  /**
   * Stretches of the day the clinic is shut — a lunch break, a half-day, an
   * afternoon of somebody's leave. See lib/availability.ts: the caller works
   * these out, so a booked appointment and a closure are one kind of obstacle
   * here rather than two.
   */
  blocked?: { start: string; end: string }[]
  /** The calendar day being asked about, `YYYY-MM-DD` in the clinic's zone. */
  day: string
  /** Now, on the clinic's wall clock, so a slot already gone is not offered. */
  now: { day: string; time: string }
  /**
   * How often to offer a slot, in minutes.
   *
   * The granularity of the grid, not the length of an appointment. Was the
   * hard-coded `SLOT_STEP_MINUTES` below, which is why Settings → Appointments
   * could set a slot length and change nothing.
   */
  step?: number
  /**
   * Minutes to leave clear after an appointment before the next may start.
   *
   * Applied to what is already booked rather than to the slot being offered, so
   * it pads the gap after somebody else's appointment without shortening the
   * day at its end.
   */
  buffer?: number
}

/**
 * Every slot in the day, each marked free or not.
 *
 * Both slot routes had their own copy of this loop, character for character
 * apart from variable names, and each had to be fixed twice.
 */
export function availableSlots(query: SlotQuery): { time: string; available: boolean }[] {
  const { hours, shift, duration, booked, day, now } = query

  // Clamped rather than trusted: a step of zero would not terminate, and a
  // negative buffer would let appointments overlap.
  const step = Math.max(5, Math.round(query.step ?? SLOT_STEP_MINUTES))
  const buffer = Math.max(0, Math.round(query.buffer ?? 0))

  const open = minutesOf(time(shift?.startTime) ?? hours.open)
  const close = minutesOf(time(shift?.endTime) ?? hours.close)
  const blocked = (query.blocked ?? []).map((b) => ({
    start: minutesOf(b.start),
    end: minutesOf(b.end),
  }))

  const isToday = now.day === day
  const nowMinutes = minutesOf(now.time)

  const slots: { time: string; available: boolean }[] = []

  for (let start = open; start + duration <= close; start += step) {
    const end = start + duration

    const shut = blocked.some((b) => start < b.end && b.start < end)
    const taken = booked.some((b) => {
      const bStart = minutesOf(b.start)
      // The buffer extends the appointment already in the book, which is what
      // reserves the gap after it for turning the chair round.
      return start < bStart + b.duration + buffer && bStart < end
    })
    const past = isToday && start <= nowMinutes

    slots.push({ time: timeOf(start), available: !shut && !taken && !past })
  }

  return slots
}
