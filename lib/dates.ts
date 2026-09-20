/**
 * How a date is written on screen. One way, everywhere.
 *
 * There were six. `en-PK` on the appointment list, `en-GB` on the supplier
 * page, date-fns `PP` in the patient tabs and `PPP` on the patient record —
 * which is why that record said "March 14th, 1993" while the appointment
 * beside it said "20-Sept-2026" and the receipt said "20 Sept 2026". Each was
 * defensible on its own screen and the set of them was not: a clinic reading
 * three formats in one session has to stop and work out which is which, and
 * "03/04" is a different day depending on the answer.
 *
 * The chosen form spells the month. `03/04/2026` is 3 April to a Pakistani
 * clinic and 4 March to an American reader, and a dental practice keeps records
 * for decades — a date nobody can misread is worth four extra characters.
 */

/** The clinic's locale for dates. Months are spelled, so this is about order. */
const LOCALE = 'en-PK'

/**
 * A bare `YYYY-MM-DD` is a calendar day, not an instant.
 *
 * Passing one to `new Date()` reads it as UTC midnight, which renders as the
 * previous day for anyone west of Greenwich. The appointment API returns the
 * clinic's own calendar day in exactly this form.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  const calendarDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim())
  const date = calendarDay
    ? new Date(Number(calendarDay[1]), Number(calendarDay[2]) - 1, Number(calendarDay[3]))
    : new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

/** An em dash, which is what this application writes for a blank. */
export const BLANK = '—'

/** `20 Sept 2026` — the ordinary way a date appears. */
export function displayDate(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return BLANK

  return date.toLocaleDateString(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** `20 Sept 2026, 3:00 pm` — where the time of day matters. */
export function displayDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return BLANK

  return date.toLocaleString(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** `3:00 pm`. */
export function displayTime(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return BLANK

  return date.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true })
}

/**
 * `20 Sept 2026 (3 days ago)` — a date and how long ago, for the screens where
 * the gap is the point: when somebody was last seen, when a chart was taken.
 */
export function displayDateWithGap(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return BLANK

  const days = Math.round((Date.now() - date.getTime()) / 86400000)
  if (days === 0) return `${displayDate(date)} (today)`
  if (days === 1) return `${displayDate(date)} (yesterday)`
  if (days > 0) return `${displayDate(date)} (${days} days ago)`
  if (days === -1) return `${displayDate(date)} (tomorrow)`
  return `${displayDate(date)} (in ${Math.abs(days)} days)`
}

/** `2026-09-20`, for an input[type=date] or a query string. Never for display. */
export function isoDay(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''

  // Built from the local parts rather than `toISOString`, which would shift the
  // day for anyone east of Greenwich after midday.
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
