import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Facts about a record as a grid of label-over-value pairs: the way a profile
 * page anywhere lays out its details, and easier to scan than a column of
 * label-beside-value lines, because the values line up and the labels recede.
 */
export function InfoGrid({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <dl className={cn('grid gap-x-6 gap-y-5 sm:grid-cols-2', className)}>{children}</dl>
}

export function InfoItem({
  label,
  icon: Icon,
  children,
  className,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  /** Blank, null or undefined prints a muted dash rather than nothing. */
  children?: React.ReactNode
  className?: string
}) {
  const empty = children === null || children === undefined || children === ''
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </dt>
      <dd
        className={cn('mt-1 break-words text-sm', empty ? 'text-muted-foreground' : 'font-medium')}
      >
        {empty ? '—' : children}
      </dd>
    </div>
  )
}
