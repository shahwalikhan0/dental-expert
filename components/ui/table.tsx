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
        {/* The fade is a mask on the content, not a veil over it — see
            `.grid-scroller` in app/globals.css for why a card-coloured
            gradient stopped being the right answer. */}
        <div
          ref={scroller}
          data-fade-start={edges.left ? '' : undefined}
          data-fade-end={edges.right ? '' : undefined}
          className="grid-scroller w-full overflow-auto"
        >
          <table
            ref={setRefs}
            className={cn('table-stacked w-full caption-bottom text-sm', className)}
            {...props}
          />
        </div>

        {edges.right && (
          <p className="hidden px-4 pt-2 text-xs text-muted-foreground sm:block md:hidden">
            Scroll sideways for the rest of each row.
          </p>
        )}
      </div>
    )
  }
)
Table.displayName = 'Table'

/**
 * The column names, as one string.
 *
 * Exported because `SortableHeader` in `data-grid.tsx` renders a `<th>` of its
 * own and had drifted: a sortable column was `h-12 font-medium` in sentence
 * case beside plain columns that were small capitals, so a grid with one
 * sortable column showed two kinds of header in the same row.
 *
 * Small capitals and a lighter tone: the names are a legend, not content, and
 * the eye should fall on the first row rather than on the header above it. The
 * stacked cards on a phone take their labels from `th.textContent`, which is
 * the unstyled text, so they keep ordinary sentence case.
 */
export const TABLE_HEAD_CLASS =
  'h-10 px-4 text-left align-middle text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      // A rail rather than small text floating above the first row. The same
      // faint wash as the footer below, so a grid is bounded top and bottom by
      // the same material instead of by a line at one end and nothing at the
      // other.
      'bg-foreground/[0.03] [&_tr]:border-b [&_tr]:border-border/60 [&_tr]:hover:bg-transparent',
      className
    )}
    {...props}
  />
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
    className={cn(
      'border-t border-border/60 bg-foreground/[0.03] font-medium [&>tr]:last:border-b-0',
      className
    )}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        /*
         * A lighter rule between rows and a fainter wash on hover. A grid is
         * read down a column, and a full-strength line under every row turns
         * twenty records into twenty boxes — the eye stops at each one instead
         * of running down the list.
         */
        'border-b border-border/40 transition-colors hover:bg-foreground/[0.04] data-[state=selected]:bg-primary/10',
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
    className={cn(TABLE_HEAD_CLASS, '[&:has([role=checkbox])]:pr-0', className)}
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
    className={cn('px-4 py-3.5 align-middle [&:has([role=checkbox])]:pr-0', className)}
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
