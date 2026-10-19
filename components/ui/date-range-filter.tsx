'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  browserToday,
  DATE_RANGE_PRESETS,
  presetOf,
  rangeOf,
  type DateRangePreset,
  type DayRange,
} from '@/lib/date-ranges'
import { displayDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

export type { DayRange }

export interface DateRangeFilterProps {
  /** `from`/`to` as `YYYY-MM-DD`; `''` for an open end. */
  value: DayRange
  /** Called once per change with both ends, so a range is one fetch, not two. */
  onChange: (range: DayRange) => void
  /**
   * What the dates are of, sentence case: "Issued", "Scheduled". The control's
   * aria-label is "<label> date range". Default "Date".
   */
  label?: string
  /**
   * The clinic's calendar day, `YYYY-MM-DD`, when the screen has it from the
   * server. Defaults to the browser's day.
   */
  today?: string
  /** Override the presets. Default `DATE_RANGE_PRESETS` (lib/date-ranges.ts). */
  presets?: DateRangePreset[]
  disabled?: boolean
  className?: string
}

/**
 * A list's date filter: a preset select — "Any date", "Today", "Last 7 days",
 * "This month"… — and "Custom range", which shows a from and a to field.
 *
 * Replaces the pairs of bare date inputs on the appointments, invoices,
 * payments, treatments and stock lists, which offered no presets and no label
 * (their placeholders do not render on a date input), and borrows the presets
 * idea from the attendance report's `RangeControls`.
 *
 *   <DateRangeFilter
 *     label="Issued"
 *     value={{ from: list.filters.from, to: list.filters.to }}
 *     onChange={(range) => list.setFilters(range)}
 *   />
 *
 * Report what is applied with `dateRangeLabel(range)` in `ActiveFilters`.
 */
export function DateRangeFilter({
  value,
  onChange,
  label = 'Date',
  today: givenToday,
  presets = DATE_RANGE_PRESETS,
  disabled,
  className,
}: DateRangeFilterProps) {
  // The browser's day is read after mount, so the server render and the first
  // client render agree (a hydration mismatch otherwise, around midnight).
  const [browserDay, setBrowserDay] = React.useState('')
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!givenToday) setBrowserDay(browserToday())
  }, [givenToday])
  const today = givenToday ?? browserDay

  const matched = today
    ? presetOf(value, today, presets)
    : value.from || value.to
      ? 'custom'
      : 'any'
  // "Custom range" chosen while the range still matches a preset (or is empty)
  // must still show the fields, so the choice is remembered here.
  const [customChosen, setCustomChosen] = React.useState(false)
  // ...until the range is cleared from elsewhere (a chip, "Clear all"), when
  // the select goes back to "Any date".
  const rangeKey = `${value.from}|${value.to}`
  const [seenKey, setSeenKey] = React.useState(rangeKey)
  if (rangeKey !== seenKey) {
    setSeenKey(rangeKey)
    if (!value.from && !value.to) setCustomChosen(false)
  }
  const selected = customChosen ? 'custom' : matched
  const fromId = React.useId()
  const toId = React.useId()

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Select
        value={selected}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === 'custom') {
            setCustomChosen(true)
            return
          }
          setCustomChosen(false)
          onChange(rangeOf(next, today, presets))
        }}
      >
        <SelectTrigger
          aria-label={`${label} date range`}
          className="h-11 w-full rounded-full px-4 sm:w-[160px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any date</SelectItem>
          {presets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value} disabled={!today}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>

      {selected === 'custom' && (
        <div className="flex items-center gap-2">
          <label htmlFor={fromId} className="sr-only">
            {label} from
          </label>
          <Input
            id={fromId}
            type="date"
            className="h-11 w-[10.5rem] rounded-full px-4"
            value={value.from}
            max={value.to || undefined}
            disabled={disabled}
            onChange={(event) => onChange({ from: event.target.value, to: value.to })}
          />
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            to
          </span>
          <label htmlFor={toId} className="sr-only">
            {label} to
          </label>
          <Input
            id={toId}
            type="date"
            className="h-11 w-[10.5rem] rounded-full px-4"
            value={value.to}
            min={value.from || undefined}
            disabled={disabled}
            onChange={(event) => onChange({ from: value.from, to: event.target.value })}
          />
        </div>
      )}
    </div>
  )
}

/**
 * The range in words, for an `ActiveFilters` chip: "Last 7 days",
 * "1 Oct 2026 – 14 Oct 2026", "From 1 Oct 2026". Null when no range is set.
 */
export function dateRangeLabel(
  range: DayRange,
  today: string = browserToday(),
  presets: DateRangePreset[] = DATE_RANGE_PRESETS
): string | null {
  if (!range.from && !range.to) return null
  const preset = presetOf(range, today, presets)
  const named = presets.find((p) => p.value === preset)
  if (named) return named.label
  if (range.from && range.to) return `${displayDate(range.from)} – ${displayDate(range.to)}`
  if (range.from) return `From ${displayDate(range.from)}`
  return `Until ${displayDate(range.to)}`
}
