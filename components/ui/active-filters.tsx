'use client'

/**
 * What the list is currently hiding.
 *
 * Every grid in this application filters, and none of them said so. The
 * controls are a row of selects that read "Status" and "Category" whether or
 * not they are set to anything, and on a screen somebody came back to — or a
 * link a colleague sent them — a filter left on looks exactly like a short
 * result. "We only have four overdue invoices" is the kind of wrong conclusion
 * that is never traced back to a select box two rows above the table.
 *
 * So the applied filters get said out loud, under the controls: one chip per
 * filter with the value it is set to, each one removable on its own, and a
 * clear-all beside them. The row is absent when nothing is applied, which is
 * what makes its presence mean something.
 */
import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ActiveFilter {
  /** The control's own name, as the screen labels it — "Status", "Category". */
  label: string
  /**
   * What it is set to, in the words the screen uses. `null` or an empty string
   * means this filter is not applied and the chip is not drawn, so a caller can
   * list every filter it has and let this decide which ones count.
   */
  value?: string | null
  /** Put this one control back to its default. */
  onClear: () => void
}

export interface ActiveFiltersProps {
  filters: ActiveFilter[]
  /** Reset every control at once. */
  onClearAll: () => void
  /** Plural noun for the records, for the screen-reader summary. */
  noun?: string
  className?: string
}

export function ActiveFilters({
  filters,
  onClearAll,
  noun = 'records',
  className,
}: ActiveFiltersProps) {
  const applied = filters.filter((f) => f.value != null && f.value !== '')
  if (applied.length === 0) return null

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 text-sm', className)}
      // Announced when a filter goes on or comes off, because the thing that
      // changed is the length of a list somewhere else on the screen.
      role="status"
      aria-live="polite"
    >
      <span className="text-muted-foreground">
        {applied.length === 1 ? '1 filter applied' : `${applied.length} filters applied`}
        <span className="sr-only"> to these {noun}</span>:
      </span>

      {applied.map((filter) => (
        <span
          key={filter.label}
          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-foreground"
        >
          <span className="text-muted-foreground">{filter.label}:</span>
          {filter.value}
          <button
            type="button"
            onClick={filter.onClear}
            aria-label={`Clear the ${filter.label} filter`}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <X className="mr-1 h-3.5 w-3.5" />
        Clear all
      </Button>
    </div>
  )
}
