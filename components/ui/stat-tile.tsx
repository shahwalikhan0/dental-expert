import * as React from 'react'
import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const TONES = {
  default: '',
  success: 'text-green-600 dark:text-green-400',
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
} as const

/**
 * One headline figure on any screen: total billed, collected, balance due,
 * today's appointments. Every page drew these as a Card with a CardTitle and an
 * icon in the corner, each a little different; this is one tile so the row of
 * figures at the top of each screen reads the same everywhere — a small label,
 * the number large, and a line under it saying what it counts.
 *
 * Lived under components/billing while only billing used it. The dashboard's
 * figures were a fifth variation on the same shape, so it moved here.
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
  href,
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
  /**
   * Where the figure comes from, if it is made of something you can open.
   *
   * A total is a question and the answer is a list: "Outstanding Rs 412,000"
   * should reach the invoices it is the sum of. Given an href the tile becomes
   * a link, grows a chevron, and lifts under the pointer.
   */
  href?: string
}) {
  const body = (
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
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary',
            href && 'transition-colors group-hover:bg-primary group-hover:text-primary-foreground'
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
      {href && !Icon && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </div>
  )

  const shell = cn('rounded-2xl border bg-card p-5 shadow-sm', className)
  if (!href) return <div className={shell}>{body}</div>

  return (
    <Link
      href={href}
      className={cn(
        shell,
        'group block transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      {body}
    </Link>
  )
}

/**
 * A percentage against last month, as a chip rather than loose text.
 *
 * Up is green, down is red, flat is grey and wears no arrow — a "0.0%" with a
 * rising arrow beside it was the commonest misreading of the old dashboard.
 */
export function Trend({ value, since = 'vs last month' }: { value: number; since?: string }) {
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : null
  const tone =
    value > 0
      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
      : value < 0
        ? 'bg-red-500/10 text-red-700 dark:text-red-400'
        : 'bg-muted text-muted-foreground'
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
          tone
        )}
      >
        {Icon && <Icon className="h-3 w-3" />}
        {value > 0 ? '+' : ''}
        {value.toFixed(1)}%
      </span>
      <span>{since}</span>
    </span>
  )
}
