import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const TONES = {
  default: '',
  success: 'text-green-600 dark:text-green-400',
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
} as const

/**
 * One headline figure on a billing screen: total billed, collected, balance
 * due. Every billing page drew these as a Card with a CardTitle and an icon in
 * the corner, each a little different; this is one tile so the row of figures
 * at the top of each screen reads the same everywhere — a small label, the
 * number large, and a line under it saying what it counts.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  loading,
  className,
  labelClassName,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /** Under the figure: "12 invoices", "Days overdue". */
  hint?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  /** Colours the figure: collected is green, owed is red. */
  tone?: keyof typeof TONES
  /** Shows a skeleton in place of the figure while it is fetched. */
  loading?: boolean
  className?: string
  /** For a label that carries its own colour, such as an ageing bucket. */
  labelClassName?: string
}) {
  return (
    <div className={cn('rounded-2xl border bg-card p-5 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              'text-xs font-semibold uppercase tracking-wide text-muted-foreground',
              labelClassName
            )}
          >
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-28" />
          ) : (
            <p className={cn('mt-1 text-2xl font-bold tracking-tight tabular-nums', TONES[tone])}>
              {value}
            </p>
          )}
          {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>
    </div>
  )
}
