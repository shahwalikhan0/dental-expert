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
 * The interim answer was a fade at whichever edge had more behind it and a note
 * saying to scroll. It is now a card per row below `sm`, which is what a list
 * on a phone should have been all along: the whole record visible, each value
 * against the name of its column.
 *
 * Done here, in CSS, rather than as a second markup tree per screen. The
 * alternative — a generic `DataTable` fed column definitions — is the thing
 * `components/ui/data-grid.tsx` explains at length why this application does
 * not have: these cells are avatars, two-line contact blocks and badges whose
 * colour means something clinical, and the tables are readable precisely
 * because each screen writes its own. So the markup stays one table, and the
 * labels a card needs are taken from the header row at runtime and stamped onto
 * each cell as `data-label`, which the stylesheet then draws. Twenty screens
 * become card layouts without one of them being edited.
 *
 * The horizontal scroller and its fades remain for tablet widths, where a table
 * is still the better shape.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => {
    const scroller = React.useRef<HTMLDivElement>(null)
    const table = React.useRef<HTMLTableElement | null>(null)
    const [edges, setEdges] = React.useState({ left: false, right: false })

    // The caller may want the element too, so both refs are fed.
    const setRefs = React.useCallback(
      (node: HTMLTableElement | null) => {
        table.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLTableElement | null>).current = node
      },
      [ref]
    )

    /**
     * Give every cell the name of its column.
     *
     * A stacked card has no header row above it, so each value needs to say
     * what it is. The names are already on screen — in the `<th>` elements — so
     * they are copied onto the cells as `data-label` and drawn by the
     * stylesheet, rather than asking twenty screens to repeat themselves.
     *
     * Restamped when the rows change, because a new page of results arrives as
     * new `<td>` elements that have never been labelled. React does not manage
     * these attributes and will not remove them.
     */
    React.useEffect(() => {
      const node = table.current
      if (!node) return

      const stamp = () => {
        const headers = Array.from(node.querySelectorAll('thead th')).map((th) =>
          (th.textContent ?? '').trim()
        )
        if (headers.length === 0) return

        for (const row of Array.from(node.querySelectorAll('tbody tr'))) {
          const cells = Array.from(row.children) as HTMLElement[]
          cells.forEach((cell, index) => {
            const label = headers[index]
            // A column with no heading — an actions menu, a checkbox — gets no
            // label rather than an empty one, and the stylesheet lays those out
            // differently.
            if (label) cell.setAttribute('data-label', label)
            else cell.removeAttribute('data-label')
          })
          // A row spanning the whole table is an empty state or a message, not
          // a record, and must not be drawn as a card's field list. Cleared as
          // well as set: the same `<tr>` can go from "Loading…" to a record.
          if (row.children.length === 1) {
            ;(row as HTMLElement).setAttribute('data-full-row', '')
          } else {
            ;(row as HTMLElement).removeAttribute('data-full-row')
          }
        }
      }

      stamp()

      const observer = new MutationObserver(stamp)
      observer.observe(node, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])

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
          <table
            ref={setRefs}
            className={cn('table-stacked w-full caption-bottom text-sm', className)}
            {...props}
          />
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
            <p className="hidden px-4 pt-2 text-xs text-muted-foreground sm:block md:hidden">
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
