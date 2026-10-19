import { cn } from '@/lib/utils'

/**
 * A ranked list with the bar behind the label.
 *
 * Three screens had hand-rolled versions of this — gender distribution,
 * acquisition sources, payment methods — each with its own markup, its own bar
 * height and its own colours (one of them `bg-blue-600` and `bg-pink-600`,
 * hardcoded, which neither theme asked for).
 *
 * The bar sits *behind* the row rather than beside it, so the label and the
 * figure are always legible and the width is free to be the full card. That is
 * also what makes it work at phone width, where a fixed `w-32` track is most of
 * the screen.
 *
 * This is the right form for a share-of-total breakdown and it is a better one
 * than a pie: the rows are already sorted, the labels are horizontal, and
 * comparing two lengths is something people can do.
 */
export interface BarListRow {
  /** Stable across filters — the colour must not follow the rank. */
  key: string
  label: string
  value: number
  /** Shown on the right. The formatted value, usually. */
  display: string
  /** Under the value, smaller. A percentage, typically. */
  detail?: string
  href?: string
}

export function BarList({
  rows,
  className,
  emptyMessage = 'Nothing to show yet',
}: {
  rows: BarListRow[]
  className?: string
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  }

  // Scaled against the largest row, not against the total: the question a
  // ranked list answers is "how does this compare with the biggest", and
  // scaling to the total leaves every bar a stub whenever there are many rows.
  const max = Math.max(...rows.map((row) => row.value), 1)

  return (
    <ol className={cn('space-y-1', className)}>
      {rows.map((row) => (
        <li key={row.key} className="relative flex items-center gap-3 rounded-md px-2 py-1.5">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-md bg-primary/10"
            style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
          />
          <span className="relative min-w-0 flex-1 truncate text-sm font-medium">{row.label}</span>
          <span className="relative text-right text-sm font-semibold tabular-nums">
            {row.display}
            {row.detail && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">{row.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
