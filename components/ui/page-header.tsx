import * as React from 'react'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  /** The screen's name, or the record's: "Invoices", "INV-202610-0003". */
  title: React.ReactNode
  /** One line under the title, muted. */
  description?: React.ReactNode
  /**
   * The way back, above the title. Always a `BackLink` from
   * components/ui/trail.tsx, so it names where it goes and remembers where
   * the reader came from:
   *
   *   back={<BackLink trail={trail} fallback="/billing/invoices" fallbackLabel="Invoices" />}
   */
  back?: React.ReactNode
  /**
   * The screen's actions, right-aligned on a desktop and under the title on a
   * phone. The primary one is "New <noun>" with a `Plus` icon, sentence case.
   */
  actions?: React.ReactNode
  /** Badges or a status beside the title. */
  badges?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

/**
 * The top of every screen: way back, title, description, actions.
 *
 * Headers had been written per screen — back links in four styles (a trail-
 * aware `BackLink`, an icon-only arrow with a hard-coded href, a grey text
 * button, an arrow text link), subtitles in two, actions labelled "New X",
 * "Add X" and "+ New Order". This is one layout using the existing
 * `page-title` class, so the title is the same size on every screen.
 *
 *   <PageHeader
 *     title="Invoices"
 *     description="Patient invoices and what is owed on them."
 *     actions={<Button asChild><Link href="/billing/invoices/new"><Plus …/>New invoice</Link></Button>}
 *   />
 */
export function PageHeader({
  title,
  description,
  back,
  actions,
  badges,
  className,
  children,
}: PageHeaderProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {/* On a desktop the breadcrumb above every page already says where this
          was opened from and links back to it; the back link repeated it one
          line lower. On a phone it stays, as the bigger thing to tap. */}
      {back && <div className="md:hidden">{back}</div>}
      {/*
          The title keeps a column of its own: `min-w-0` alone let it shrink to
          nothing against a row of actions, so the dashboard's four buttons
          crushed "Dashboard" to "Dashboar" and stacked its one-line
          description into a five-line sliver. With a basis to hold and
          wrapping allowed, a set of actions too wide for the line drops to the
          next one instead, still right-aligned.
      */}
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div className="min-w-0 md:flex-1 md:basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title">{title}</h1>
            {badges}
          </div>
          {description && <p className="mt-1 text-muted-foreground">{description}</p>}
          {children}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 md:ml-auto">{actions}</div>
        )}
      </div>
    </div>
  )
}
