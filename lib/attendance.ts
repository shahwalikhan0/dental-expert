/**
 * The attendance register's vocabulary, and the calendar arithmetic it runs on.
 *
 * Nothing here touches the database, on purpose: the register screen is a
 * client component and imports these labels and day helpers directly. The
 * queries live in `lib/attendance-records.ts`, which opens a Prisma client and
 * must never be imported from the browser.
 *
 * Every day is a `YYYY-MM-DD` string on the clinic's own calendar. Not a
 * `Date`: a `Date` is an instant, and the host's timezone decides which day an
 * instant falls on. A register built from instants would put a Karachi
 * clinic's Monday on a server's Sunday.
 */

import { MONTHS_SHORT } from './dates'

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE'] as const
export type AttendanceMark = (typeof ATTENDANCE_STATUSES)[number]

export function isAttendanceMark(value: unknown): value is AttendanceMark {
  return typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value)
}

/** The letter in the register, which is what a manager reads down a column. */
export const STATUS_CODE: Record<AttendanceMark, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  LATE: 'L',
}

export const STATUS_LABEL: Record<AttendanceMark, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
}

/** Tailwind classes for a mark, light and dark. */
export const STATUS_TONE: Record<AttendanceMark, string> = {
  PRESENT: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  ABSENT: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  LATE: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
}

/**
 * What a cell in the register is.
 *
 *  - `MARKED` — somebody saved this day. The only state that is a record.
 *  - `DEFAULT` — a past or current working day nobody has saved yet. Shown as
 *    Present (or Absent, when leave was booked in the staff calendar) because
 *    that is what the manager would otherwise have to click, but counted as
 *    unmarked until it is saved.
 *  - `OFF` — the clinic was closed for a holiday. There is no weekly day off.
 *  - `FUTURE` — has not happened. Nobody can be marked present tomorrow.
 *  - `NOT_JOINED` — before this person started.
 */
export type CellState = 'MARKED' | 'DEFAULT' | 'OFF' | 'FUTURE' | 'NOT_JOINED'

export interface RegisterCell {
  date: string
  state: CellState
  /** What the cell shows: the saved mark, or the default for an unsaved day. */
  status: AttendanceMark | null
  /** Why the cell is what it is — "Holiday: Eid al-Fitr", "Leave: Annual leave". */
  reason?: string
  note?: string | null
}

export function isEditable(cell: Pick<RegisterCell, 'state'>): boolean {
  return cell.state === 'MARKED' || cell.state === 'DEFAULT' || cell.state === 'OFF'
}

/** At least fifty people to a page — a register is worked down, not paged through. */
export const REGISTER_PAGE_SIZES = [50, 100, 200]
export const DEFAULT_REGISTER_PAGE_SIZE = 50

/** A year and a day, so "1 January to 1 January" is a range and not a refusal. */
export const MAX_RANGE_DAYS = 367

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day as `YYYY-MM-DD` — rejects `2026-02-30`, which `Date` rolls over. */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function utc(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

export function addDays(day: string, count: number): string {
  const date = utc(day)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export function dayDiff(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86400000)
}

/** 0 = Sunday, the convention `Availability.dayOfWeek` uses. */
export function weekdayIndex(day: string): number {
  return utc(day).getUTCDay()
}

/**
 * The Monday on or before `day`.
 *
 * Monday, because that is where a working week starts in Pakistan and in ISO
 * 8601 alike — and a register that opened on Sunday would lead with the one day
 * most clinics are shut.
 */
export function weekStartOf(day: string): string {
  const offset = (weekdayIndex(day) + 6) % 7
  return addDays(day, -offset)
}

/** `count` consecutive days starting at `start`. */
export function daysFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(start, index))
}

/** Every day from `from` to `to` inclusive, or none if they are the wrong way round. */
export function daysBetween(from: string, to: string): string[] {
  const span = dayDiff(from, to)
  return span < 0 ? [] : daysFrom(from, span + 1)
}

/** The first day of the month `day` falls in. */
export function monthStartOf(day: string): string {
  return `${day.slice(0, 7)}-01`
}

/** The last day of the month `day` falls in. */
export function monthEndOf(day: string): string {
  const [year, month] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekdayShort(day: string): string {
  return WEEKDAYS_SHORT[weekdayIndex(day)]
}

export function weekdayLong(day: string): string {
  return WEEKDAYS_LONG[weekdayIndex(day)]
}

/** `28 Sept` — a column heading. Month names are `displayDate`'s. */
export function dayMonth(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`
}

/** `28 Sept 2026`. */
export function fullDay(day: string): string {
  return `${dayMonth(day)} ${day.slice(0, 4)}`
}

/**
 * `22 – 28 Sept 2026`, or across a month boundary `29 Sept – 5 Oct 2026`.
 *
 * Spelled out once here because every screen of the module heads itself with
 * a range, and three slightly different spellings of the same week is how a
 * manager ends up unsure whether two screens are showing the same one.
 */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return fullDay(from)
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7)
  if (sameMonth) return `${Number(from.slice(8, 10))} – ${fullDay(to)}`
  if (sameYear) return `${dayMonth(from)} – ${fullDay(to)}`
  return `${fullDay(from)} – ${fullDay(to)}`
}

/**
 * How many lates make an absence.
 *
 * The clinic's rule: every second late arrival in a period is counted as a
 * day absent. Applied to the whole range being looked at — a month's report
 * counts the month's lates, a year's counts the year's — with any odd late
 * left over carried by nobody.
 */
export const LATES_PER_ABSENCE = 2

/** The absences a number of lates amounts to: two lates, one absence; three, still one. */
export function absencesFromLates(late: number): number {
  return Math.floor(late / LATES_PER_ABSENCE)
}

/** Totals over a range, per person. */
export interface AttendanceSummary {
  present: number
  absent: number
  /** In, but not on time. */
  late: number
  /** Absences charged for lateness — see `LATES_PER_ABSENCE`. */
  lateAbsences: number
  /** Days marked absent plus the absences charged for lateness. */
  totalAbsent: number
  /** Closed days nobody was marked in on. */
  off: number
  /** Working days, up to today, that nobody has saved. */
  unmarked: number
  /**
   * Days counted as attended ÷ days marked, as a whole percentage — or null
   * when nothing was marked, which is not the same as 0%.
   *
   * A late day is attended, except that every `LATES_PER_ABSENCE` of them
   * converts one into an absence. Four lates in a month of twenty days is
   * therefore eighteen attended, not twenty.
   */
  rate: number | null
}

export function emptySummary(): AttendanceSummary {
  return {
    present: 0,
    absent: 0,
    late: 0,
    lateAbsences: 0,
    totalAbsent: 0,
    off: 0,
    unmarked: 0,
    rate: null,
  }
}

/** Fold a person's cells into their totals. Future and pre-joining days count for nothing. */
export function summarise(cells: RegisterCell[]): AttendanceSummary {
  const totals = emptySummary()
  for (const cell of cells) {
    if (cell.state === 'OFF') totals.off += 1
    else if (cell.state === 'DEFAULT') totals.unmarked += 1
    else if (cell.state === 'MARKED' && cell.status === 'PRESENT') totals.present += 1
    else if (cell.state === 'MARKED' && cell.status === 'ABSENT') totals.absent += 1
    else if (cell.state === 'MARKED' && cell.status === 'LATE') totals.late += 1
  }
  totals.lateAbsences = absencesFromLates(totals.late)
  totals.totalAbsent = totals.absent + totals.lateAbsences
  const marked = totals.present + totals.late + totals.absent
  const attended = marked - totals.totalAbsent
  totals.rate = marked > 0 ? Math.round((attended / marked) * 100) : null
  return totals
}

/** What the register prints in a cell that holds no mark. */
export function blankCode(state: CellState): string {
  if (state === 'OFF') return 'Off'
  if (state === 'NOT_JOINED') return '—'
  return ''
}

/**
 * A requested range, checked: both ends real days, the right way round, and no
 * longer than `MAX_RANGE_DAYS`. A missing start falls back to the start of the
 * month or of the week so far, and a missing end to today.
 */
export function parseRange(
  from: string | null,
  to: string | null,
  today: string,
  fallback: 'month' | 'week' = 'month'
): { from: string; to: string } | { error: string } {
  const start = from || (fallback === 'week' ? weekStartOf(today) : monthStartOf(today))
  const end = to || today
  if (!isDay(start) || !isDay(end)) return { error: 'Dates must be written as YYYY-MM-DD' }
  if (end < start) return { error: 'The range ends before it starts' }
  if (dayDiff(start, end) + 1 > MAX_RANGE_DAYS) {
    return { error: 'A report can cover a year at most — choose a shorter range' }
  }
  return { from: start, to: end }
}
