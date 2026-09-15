/**
 * When an appointment actually is.
 *
 * `Appointment.scheduledDate` is `@db.Date` — a day with no time — and
 * `scheduledTime` is an `HH:MM` string in the clinic's own timezone. Neither is
 * an instant on its own, and the two have to be put together against the
 * clinic's timezone before anything can be scheduled around them.
 *
 * Nothing did. The reminder cron used `scheduledDate.getTime() - one hour`,
 * which is an hour before **midnight** on the day of the appointment: a 15:00
 * appointment was reminded about at 23:00 the night before, sixteen hours early
 * and — since the send window closes at 21:00 — at an hour the clinic had said
 * not to message patients. The same cron filtered `scheduledDate >= now`, which
 * against a date-only column means every appointment later today is skipped,
 * because today's date is midnight and midnight has passed.
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

  const asIfUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second')
  )

  return Math.round((asIfUtc - at.getTime()) / 60000)
}

/**
 * The instant an appointment starts.
 *
 * Two passes: the first guesses using the offset at the naive time, the second
 * corrects it. That matters only on a daylight-saving boundary, where the
 * offset at the guess and the offset at the answer differ — the second pass is
 * cheap and removes the only case where one would be wrong.
 *
 * Returns null for an unparseable time rather than a date an hour into 1970;
 * `scheduledTime` is a free-text column and has no database constraint.
 */
export function appointmentInstant(
  scheduledDate: Date,
  scheduledTime: string,
  timezone: string
): Date | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(scheduledTime?.trim() ?? '')
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  // The date column is stored without a time, so it reads back as UTC midnight;
  // its calendar day is what is wanted, not its instant.
  const naive = Date.UTC(
    scheduledDate.getUTCFullYear(),
    scheduledDate.getUTCMonth(),
    scheduledDate.getUTCDate(),
    hours,
    minutes
  )

  const firstPass = naive - offsetMinutesIn(timezone, new Date(naive)) * 60000
  const corrected = naive - offsetMinutesIn(timezone, new Date(firstPass)) * 60000

  return new Date(corrected)
}

/**
 * The calendar day a `@db.Date` column holds, as `16-Sep-2026`.
 *
 * Formatted from the UTC parts rather than with `format()`, which reads the
 * server's local timezone: a date column comes back as UTC midnight, so on a
 * host west of Greenwich `format()` renders the day before. A reminder that
 * names the wrong day is worse than no reminder.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatCalendarDay(date: Date): string {
  // Spelled out rather than taken from `Intl`, whose `en-GB` short month for
  // September is "Sept" — four letters where every other month has three, and
  // a change to wording patients have been reading.
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${day}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`
}
