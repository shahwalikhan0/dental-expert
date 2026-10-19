import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Records linked to this one — its plan, its appointment, its invoices — as a
 * list of rows to tap through, each with an icon tile, a title and a line
 * under it, the way a settings or a trips list reads in any phone app. A row
 * is the whole link, rather than a card with a "View" button at its foot.
 */
export function LinkList({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <ul className={cn('-mx-2 space-y-1', className)}>{children}</ul>
}

export function LinkRow({
  href,
  icon: Icon,
  title,
  subtitle,
  trailing,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** On the right, before the chevron: a status badge, an amount. */
  trailing?: React.ReactNode
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-card">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          {subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
          )}
        </span>
        {trailing}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  )
}
