import { localDay } from '@/lib/appointment-time'

/**
 * Invoice due dates as calendar days.
 *
 * Kept apart from the issue step (lib/invoice-issue.ts) because the create
 * route needs these rules and none of the stock movement that comes with
 * issuing. "Due on receipt" means due on the day the invoice is issued, and no
 * invoice falls due before it is raised (invoice review 2.4, 6.6).
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A due date as it is stored: midday UTC on the calendar day.
 *
 * Midday rather than midnight so the day reads the same in any timezone within
 * twelve hours of UTC — the screens show it in the browser's zone, the server
 * compares it in the clinic's, and midnight UTC is the previous evening in
 * the Americas.
 */
export function dueDateOn(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`)
}

/** The calendar day `days` after `day`, both as `YYYY-MM-DD`. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * A due date from a request, as the calendar day it names in the clinic's zone.
 *
 * `YYYY-MM-DD`, what the date field sends, is that day; anything else is an
 * instant placed in the clinic's calendar. `undefined` for a blank value,
 * `null` for one that is not a date.
 */
export function dueDayFrom(value: unknown, timezone: string): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string' && DAY.test(value)) return value
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : localDay(at, timezone)
}

/** Why a due date cannot be used on an invoice issued on `issueDay`, or null. */
export function dueDateRefusal(dueDay: string, issueDay: string): string | null {
  return dueDay < issueDay
    ? `The due date (${dueDay}) is before the invoice date (${issueDay}). An invoice cannot fall due before it is issued.`
    : null
}
