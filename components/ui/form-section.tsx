import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * One part of a long form — personal details, contact, emergency contact — as
 * a card with its name and a line about it on the left and the fields on the
 * right, the way modern settings and checkout forms read: the eye runs down
 * the headings to find a part, then across to its fields. On a phone the
 * heading sits above the fields.
 *
 *   <FormSection title="Contact" description="How the clinic reaches them">
 *     <div className="grid gap-4 sm:grid-cols-2">…fields…</div>
 *   </FormSection>
 */
export function FormSection({
  title,
  description,
  children,
  className,
  aside,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Under the description: a hint, a link, a toggle for the whole section. */
  aside?: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'grid gap-6 rounded-2xl border border-border bg-card p-6 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:gap-10',
        className
      )}
    >
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {aside && <div className="mt-3">{aside}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/**
 * Cancel and Save, pinned to the bottom of the screen while a form scrolls,
 * so the button is always in reach rather than at the end of a long page.
 * Bleeds to the edges of the page padding (`-mx-4 md:-mx-6`, matching the
 * shell's `p-4 md:p-6`) and sits on a blurred bar.
 */
export function FormActions({
  children,
  className,
  hint,
}: {
  children: React.ReactNode
  className?: string
  /** On the left: "All changes are saved when you press Save", an error count. */
  hint?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:-mx-6 md:px-6',
        className
      )}
    >
      {hint && <div className="mr-auto text-sm text-muted-foreground">{hint}</div>}
      {children}
    </div>
  )
}
