/**
 * When an appointment actually is.
 *
 * `Appointment.startsAt` is a `timestamptz` — a point in time. It did not used
 * to be: the column pair was `scheduledDate @db.Date` plus a free-text
 * `scheduledTime`, and neither half is an instant on its own. The two had to be
 * put together against the clinic's timezone before anything could be scheduled
 * around them, and nothing did.
 *
 * The reminder cron read `scheduledDate.getTime() - one hour`, which is an hour
 * before **midnight** on the day of the appointment: a 15:00 appointment was
 * reminded about at 23:00 the night before, sixteen hours early and — since the
 * send window closes at 21:00 — at an hour the clinic had said not to message
 * patients. The same cron filtered `scheduledDate >= now`, which against a
 * date-only column means every appointment later today is skipped, because
 * today's date is midnight and midnight has passed.
 *
 * A clinic still books a wall clock: "Thursday at 15:00", not an instant. So
 * the conversion still happens — once, at the edge, where the clinic's timezone
 * is known — instead of being re-derived (or forgotten) at every read.
 */

/**
 * How far ahead of UTC a timezone is at a given instant, in minutes.
 *
 * `Intl` is the only thing in the platform that knows; reading the wall clock
 * in the zone and subtracting is the standard way to get a number out of it.
 * Computed per instant rather than held as a constant, so a zone with daylight
 * saving is right on both sides of the change. Pakistan has none, but this is
 * not only ever going to run in Pakistan.
 */
export function offsetMinutesIn(timezone: string, at: Date): number {
  const parts = partsIn(timezone, at)

  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second
  )

  return Math.round((asIfUtc - at.getTime()) / 60000)
}

interface WallClockParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsIn(timezone: string, at: Date): WallClockParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at)

  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    // `en-GB` renders midnight as hour 24, not 0.
    hour: value('hour') % 24,
    minute: value('minute'),
    second: value('second'),
  }
}

/** `2026-09-16` (or a `Date` carrying that calendar day) to its three numbers. */
function calendarDay(day: Date | string): { year: number; month: number; date: number } | null {
  if (typeof day === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day.trim())
    if (!match) return null
    return { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) }
  }
  if (Number.isNaN(day.getTime())) return null
  // A `@db.Date` column and an ISO date string both read back as UTC midnight;
  // the calendar day wanted is the one in UTC, not in the server's own zone.
  return { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, date: day.getUTCDate() }
}

/**
 * The instant a wall-clock time in a given timezone refers to.
 *
 * Two passes: the first guesses using the offset at the naive time, the second
 * corrects it. That matters only on a daylight-saving boundary, where the
 * offset at the guess and the offset at the answer differ — the second pass is
 * cheap and removes the only case where one would be wrong.
 *
 * Returns null for an unparseable day or time rather than a date an hour into
 * 1970: both arrive from request bodies and CSV imports.
 */
export function instantAt(day: Date | string, time: string, timezone: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time?.trim() ?? '')
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  const parsed = calendarDay(day)
  if (!parsed) return null

  const naive = Date.UTC(parsed.year, parsed.month - 1, parsed.date, hours, minutes)

  const firstPass = naive - offsetMinutesIn(timezone, new Date(naive)) * 60000
  const corrected = naive - offsetMinutesIn(timezone, new Date(firstPass)) * 60000

  return new Date(corrected)
}

export interface WallClock {
  /** `2026-09-16` — the calendar day in the clinic's zone. */
  scheduledDate: string
  /** `15:00` — 24-hour, the clinic's zone. */
  scheduledTime: string
}

/**
 * An instant as the clinic reads it off the wall.
 *
 * This is what the API returns and what every screen shows. Rendered from the
 * clinic's timezone rather than the server's, so a host in UTC and a host in
 * Karachi agree on which day a 02:00 appointment falls.
 */
export function wallClockIn(instant: Date, timezone: string): WallClock {
  const p = partsIn(timezone, instant)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    scheduledDate: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    scheduledTime: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

/**
 * The half-open instant range covering `days` calendar days from `day`, in the
 * clinic's zone.
 *
 * Half-open because a closed range has to pick between `23:59:59` (which drops
 * an appointment at 23:59:30) and the next midnight (which picks up the next
 * day's first appointment). Shaped as a Prisma filter so call sites read as
 * `where: { startsAt: dayRangeIn(date, tz) }`.
 */
export function dayRangeIn(
  day: Date | string,
  timezone: string,
  days = 1
): { gte: Date; lt: Date } {
  const start = instantAt(day, '00:00', timezone) ?? new Date(0)
  const parsed = calendarDay(day)
  const endDay = parsed
    ? new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.date + days))
    : new Date(0)
  const end = instantAt(endDay, '00:00', timezone) ?? new Date(0)
  return { gte: start, lt: end }
}

/** The calendar day in the clinic's zone that `at` falls on, as `2026-09-16`. */
export function localDay(at: Date, timezone: string): string {
  return wallClockIn(at, timezone).scheduledDate
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * An instant as `16-Sep-2026` in the clinic's zone, for message wording.
 *
 * Spelled out rather than taken from `Intl`, whose `en-GB` short month for
 * September is "Sept" — four letters where every other month has three, and a
 * change to wording patients have been reading.
 */
export function formatCalendarDay(instant: Date, timezone: string): string {
  const p = partsIn(timezone, instant)
  return `${String(p.day).padStart(2, '0')}-${MONTHS[p.month - 1]}-${p.year}`
}

/**
 * `startsAt` plus the wall-clock pair the screens read.
 *
 * The stored column is the instant; the API keeps emitting `scheduledDate` and
 * `scheduledTime` because that is what a receptionist is looking at, and
 * deriving them here means there is exactly one place that knows how.
 */
export function withWallClock<T extends { startsAt: Date }>(
  appointment: T,
  timezone: string
): T & WallClock {
  return { ...appointment, ...wallClockIn(appointment.startsAt, timezone) }
}

/** Minutes after `startsAt` that the appointment ends. */
export function endsAt(startsAt: Date, duration: number): Date {
  return new Date(startsAt.getTime() + duration * 60000)
}

export const DEFAULT_TIMEZONE = 'Asia/Karachi'

/**
 * The clinic's timezone.
 *
 * Read per call rather than cached: a module-level cache on a multi-tenant
 * lookup is how the SMS credentials ended up shared between clinics, and this
 * is a primary-key hit against a row that is already hot.
 */
export async function clinicTimezone(
  db: { hospital: { findUnique: (args: never) => Promise<{ timezone: string } | null> } },
  hospitalId: string
): Promise<string> {
  const hospital = await db.hospital.findUnique({
    where: { id: hospitalId },
    select: { timezone: true },
  } as never)
  return hospital?.timezone || DEFAULT_TIMEZONE
}
