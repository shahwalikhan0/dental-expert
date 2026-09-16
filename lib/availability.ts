/**
 * When a clinic, or one member of staff, can be booked.
 *
 * Three things used to answer this, separately and without knowing about each
 * other: `Hospital.workingHours` (the clinic's week), `StaffShift` (a dentist's
 * week) and `Holiday` (days the clinic is shut). The two tables are now one —
 * see the `Availability` model — and this module is where the slot picker asks
 * its question once instead of three times.
 *
 * A row is either weekly (`dayOfWeek`) or dated (`date`), never both, and
 * either opens the time (`isAvailable`) or closes it. That is enough to say
 * things neither old table could:
 *
 *   * a dentist's day off, which nothing recorded at all — somebody on leave
 *     went on showing free slots on the public booking page
 *   * a half-day closure, since `Holiday` had no times
 *   * a holiday that comes round every year, which `Holiday.isRecurring`
 *     claimed to offer while both slot routes matched on the exact date
 */
import type { DayHours } from '@/lib/working-hours'
import { minutesOf } from '@/lib/working-hours'

export interface AvailabilityRow {
  id: string
  staffId: string | null
  dayOfWeek: number | null
  date: Date | null
  startTime: string | null
  endTime: string | null
  isAvailable: boolean
  name: string | null
  isRecurring: boolean
}

/** 0 = Sunday, matching `Date.getUTCDay()` and the old `StaffShift.dayOfWeek`. */
export function weekdayOf(day: string): number {
  return new Date(`${day.slice(0, 10)}T00:00:00Z`).getUTCDay()
}

/** `MM-DD` — what a yearly holiday actually repeats on. */
function monthDay(day: string): string {
  return day.slice(5, 10)
}

/** The `MM-DD` of a stored date column, read in UTC so the host cannot shift it. */
function monthDayOf(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/**
 * The Prisma filter fetching everything that could bear on one day.
 *
 * Deliberately wider than the day itself: a recurring entry is stored against
 * the year it was first recorded, so it cannot be matched in SQL by equality.
 * There are a handful of these per clinic, so they come back with the query and
 * are matched here.
 */
export function relevantOn(hospitalId: string, day: string, staffId?: string) {
  return {
    hospitalId,
    AND: [
      {
        OR: [
          { dayOfWeek: weekdayOf(day) },
          { date: new Date(`${day.slice(0, 10)}T00:00:00.000Z`) },
          { isRecurring: true },
        ],
      },
      // Clinic-wide entries always apply; a staff entry only to that person.
      ...(staffId ? [{ OR: [{ staffId: null }, { staffId }] }] : []),
    ],
  }
}

/** Does this row say anything about `day`? */
export function appliesOn(row: AvailabilityRow, day: string): boolean {
  if (row.dayOfWeek !== null) return row.dayOfWeek === weekdayOf(day)
  if (!row.date) return false
  if (row.isRecurring) return monthDayOf(row.date) === monthDay(day)
  return row.date.toISOString().slice(0, 10) === day.slice(0, 10)
}

export interface ClosedDay {
  /** What to tell the caller: "Holiday: Eid al-Fitr". */
  reason: string
}

/**
 * A dated entry that closes the whole day — a clinic holiday, or a day of
 * leave for the member of staff being booked.
 *
 * A closure with times is not this: it narrows the day rather than removing it,
 * and is handled by `blockedIntervals` below.
 */
export function closureOn(rows: AvailabilityRow[], day: string): ClosedDay | null {
  const closed = rows.find(
    (row) =>
      !row.isAvailable &&
      row.date !== null &&
      row.startTime === null &&
      row.endTime === null &&
      appliesOn(row, day)
  )
  if (!closed) return null
  return { reason: closed.name ? `Holiday: ${closed.name}` : 'The clinic is closed on this day' }
}

/** The member of staff's own weekly shift on this day, if they have one. */
export function shiftOn(
  rows: AvailabilityRow[],
  day: string,
  staffId: string
): { startTime: string; endTime: string } | null {
  const shift = rows.find(
    (row) =>
      row.isAvailable &&
      row.staffId === staffId &&
      row.dayOfWeek !== null &&
      row.startTime &&
      row.endTime &&
      appliesOn(row, day)
  )
  return shift ? { startTime: shift.startTime!, endTime: shift.endTime! } : null
}

export interface Interval {
  start: string
  end: string
}

/**
 * Parts of the day that are closed but not the whole of it — a half-day, an
 * afternoon of leave, a weekly break.
 *
 * Returned in the same shape as a booked appointment so the slot generator can
 * treat "somebody is in this chair" and "the clinic is shut then" as one kind
 * of obstacle rather than two.
 */
export function blockedIntervals(rows: AvailabilityRow[], day: string): Interval[] {
  return rows
    .filter((row) => !row.isAvailable && row.startTime && row.endTime && appliesOn(row, day))
    .map((row) => ({ start: row.startTime!, end: row.endTime! }))
}

/**
 * The clinic's hours for the day, narrowed by anything that closes part of it.
 *
 * The lunch break the clinic's own hours may carry is expressed as a blocked
 * interval here, so there is one list of obstacles rather than a lunch that is
 * handled one way and a half-day closure handled another.
 */
export function obstaclesOn(hours: DayHours, rows: AvailabilityRow[], day: string): Interval[] {
  const intervals = blockedIntervals(rows, day)
  if (hours.lunch) intervals.push({ start: hours.lunch.start, end: hours.lunch.end })
  return intervals.filter((i) => minutesOf(i.end) > minutesOf(i.start))
}
