/**
 * The date-range presets every list filter offers, as calendar days.
 *
 * Five lists filtered by date with two bare date inputs, the reports used a
 * preset select, and attendance had its own preset buttons — three ways to ask
 * "last month". `DateRangeFilter` (components/ui/date-range-filter.tsx) is the
 * one control, and this is its arithmetic, kept pure so it can be tested and
 * so a screen can compute the same range for a link.
 *
 * Every value is `YYYY-MM-DD` on the clinic's calendar. `today` is passed in —
 * the clinic's day from the server where a screen has it, otherwise the
 * browser's — because which day "today" is depends on a timezone this module
 * cannot see. Weeks start on Monday, as the attendance register's do.
 */
import { addDays, monthEndOf, monthStartOf, weekStartOf } from '@/lib/attendance'

export interface DayRange {
  /** First day, inclusive. `''` for open-ended. */
  from: string
  /** Last day, inclusive. `''` for open-ended. */
  to: string
}

export interface DateRangePreset {
  value: string
  label: string
  range: (today: string) => DayRange
}

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  { value: 'today', label: 'Today', range: (today) => ({ from: today, to: today }) },
  {
    value: 'yesterday',
    label: 'Yesterday',
    range: (today) => {
      const day = addDays(today, -1)
      return { from: day, to: day }
    },
  },
  {
    value: 'last_7_days',
    label: 'Last 7 days',
    range: (today) => ({ from: addDays(today, -6), to: today }),
  },
  {
    value: 'this_week',
    label: 'This week',
    range: (today) => ({ from: weekStartOf(today), to: today }),
  },
  {
    value: 'last_30_days',
    label: 'Last 30 days',
    range: (today) => ({ from: addDays(today, -29), to: today }),
  },
  {
    value: 'this_month',
    label: 'This month',
    range: (today) => ({ from: monthStartOf(today), to: today }),
  },
  {
    value: 'last_month',
    label: 'Last month',
    range: (today) => {
      const end = addDays(monthStartOf(today), -1)
      return { from: monthStartOf(end), to: monthEndOf(end) }
    },
  },
  {
    value: 'this_year',
    label: 'This year',
    range: (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: today }),
  },
]

/** The preset a range is, `'any'` when it is empty, `'custom'` otherwise. */
export function presetOf(range: DayRange, today: string, presets = DATE_RANGE_PRESETS): string {
  if (!range.from && !range.to) return 'any'
  const match = presets.find((preset) => {
    const candidate = preset.range(today)
    return candidate.from === range.from && candidate.to === range.to
  })
  return match?.value ?? 'custom'
}

/** The range a preset covers, or an empty range for `'any'` / an unknown value. */
export function rangeOf(preset: string, today: string, presets = DATE_RANGE_PRESETS): DayRange {
  return presets.find((p) => p.value === preset)?.range(today) ?? { from: '', to: '' }
}

/** Today in the browser, `YYYY-MM-DD`. Prefer the clinic's day when the server sent one. */
export function browserToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
