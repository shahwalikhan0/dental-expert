'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A table, and a sign that it scrolls.
 *
 * Every list in this application is a table in a horizontal scroller. On a
 * phone that means the visible third is the patient's name and the other
 * two-thirds — the dentist, the time, the status, the actions menu — are off
 * the right-hand edge with nothing on screen to suggest they exist. The row
 * simply looked like it ended.
 *
 * A fade at whichever edge has more behind it, and a note under the table the
 * first time it overflows. Cheap, and it fixes every list at once; the fuller
 * answer is a card layout per screen, which is a decision about each screen
 * rather than about tables.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => {
    const scroller = React.useRef<HTMLDivElement>(null)
    const [edges, setEdges] = React.useState({ left: false, right: false })

    React.useEffect(() => {
      const element = scroller.current
      if (!element) return

      const measure = () => {
        const overflowing = element.scrollWidth - element.clientWidth
        setEdges({
          left: element.scrollLeft > 1,
          // A pixel of slack: sub-pixel widths round in ways that would
          // otherwise leave the fade showing on a table that fits.
          right: overflowing > 1 && element.scrollLeft < overflowing - 1,
        })
      }

      // Measured from the browser rather than from React: the width depends on
      // the content, the font and the window, none of which this component
      // knows about.
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      element.addEventListener('scroll', measure, { passive: true })

      return () => {
        observer.disconnect()
        element.removeEventListener('scroll', measure)
      }
    }, [])

    return (
      <div className="relative w-full">
        <div ref={scroller} className="w-full overflow-auto">
          <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
        </div>

        {/* Pointer-events-none: the fade is a hint, not a control, and must not
            swallow a tap meant for the row beneath it. */}
        {edges.left && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent"
          />
        )}
        {edges.right && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
            />
            <p className="px-4 pt-2 text-xs text-muted-foreground sm:hidden">
              Scroll sideways for the rest of each row.
            </p>
          </>
        )}
      </div>
    )
  }
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
))
TableBody.displayName = 'TableBody'

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  )
)
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
))
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('p-4 align-middle [&:has([role=checkbox])]:pr-0', className)}
    {...props}
  />
))
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
))
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
