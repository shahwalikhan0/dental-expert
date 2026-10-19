'use client'

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface FilterOption {
  value: string
  label: string
}

export interface FilterSelectProps {
  /** The filter's name, sentence case: "Status", "Category". Its aria-label. */
  label: string
  /**
   * The plural, lower case, for the first option: "statuses" gives "All
   * statuses". Required because English plurals are not `label + 's'` — the
   * "All Status" this replaces appeared on eight screens.
   */
  plural: string
  value: string
  onValueChange: (value: string) => void
  /** In display order. For a status, use `statusOptions(kind)` from lib/status. */
  options: readonly FilterOption[]
  /** The value meaning "not filtered". Default `'all'`. */
  allValue?: string
  disabled?: boolean
  id?: string
  /** Width, typically. Default `w-full sm:w-[180px]`. */
  className?: string
}

/**
 * A filter on a list screen: a Radix Select whose first option is "All …".
 *
 * The trigger shows the current value — "All statuses" or "Paid" — rather than
 * a placeholder that reads "Status" whether or not anything is chosen, and the
 * filter's name goes to the screen reader as its label. What is applied is said
 * again, removably, by `ActiveFilters` under the toolbar.
 *
 *   <FilterSelect
 *     label="Status"
 *     plural="statuses"
 *     value={list.filters.status}
 *     onValueChange={(v) => list.setFilter('status', v)}
 *     options={statusOptions('invoice')}
 *   />
 *
 * For a short, fixed list only. A register or a catalogue (patients, drugs,
 * stock, suppliers) is a picker, not a select — see docs/UX_STANDARDS.md.
 */
export function FilterSelect({
  label,
  plural,
  value,
  onValueChange,
  options,
  allValue = 'all',
  disabled,
  id,
  className,
}: FilterSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={label}
        className={cn('h-11 w-full rounded-full px-4 sm:w-[180px]', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={allValue}>All {plural}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The label for a filter's value, for `ActiveFilters`: null when not applied. */
export function filterValueLabel(
  options: readonly FilterOption[],
  value: string,
  allValue = 'all'
): string | null {
  if (value === allValue || value === '') return null
  return options.find((o) => o.value === value)?.label ?? value
}
