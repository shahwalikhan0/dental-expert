import * as React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ActiveFilters, type ActiveFiltersProps } from '@/components/ui/active-filters'
import { cn } from '@/lib/utils'

export interface ListToolbarProps {
  /** The `SearchInput`. Takes the remaining width. */
  search?: React.ReactNode
  /** `FilterSelect`s, toggles — anything that narrows the list. */
  filters?: React.ReactNode
  /** The `DateRangeFilter`, last in the row. */
  date?: React.ReactNode
  /** What is applied, said as removable chips under the controls. */
  active?: ActiveFiltersProps
  className?: string
  children?: React.ReactNode
}

/**
 * The bar above every list: search, filters, dates, and what is applied.
 *
 * Sixteen lists put their controls in a Card, six in a bare row and three
 * inventory screens in a hand-styled `div` with raw inputs. This is the Card
 * version, for all of them:
 *
 *   <ListToolbar
 *     search={<SearchInput … />}
 *     filters={<FilterSelect … />}
 *     date={<DateRangeFilter … />}
 *     active={{ noun: 'invoices', filters: [...], onClearAll: list.clear }}
 *   />
 *
 * On a phone the controls stack, full width; from `md` they sit in one row with
 * the search taking what is left.
 */
export function ListToolbar({
  search,
  filters,
  date,
  active,
  className,
  children,
}: ListToolbarProps) {
  return (
    <Card className={className}>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          {search && <div className="flex min-w-[16rem] flex-1">{search}</div>}
          {(filters || date) && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {filters}
              {date}
            </div>
          )}
          {children}
        </div>
        {active && <ActiveFilters {...active} className={cn('mt-4', active.className)} />}
      </CardContent>
    </Card>
  )
}
