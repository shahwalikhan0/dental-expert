'use client'

/**
 * The two things every list screen in this application needs and each one had
 * built for itself: a row you can click, and a pager.
 *
 * Before this there were a dozen hand-written copies of the same pagination
 * block — "Showing 1 to 20 of 57", a Previous and a Next — which had drifted in
 * the way copies do: some were hidden unless there was more than one page, so a
 * short list gave no clue how many records it was showing; some counted from
 * zero on an empty result ("Showing 1 to 0 of 0"); most named the records
 * "results" where the screen called them patients.
 *
 * Opening a record was worse. Every grid put "View Details" inside a three-dot
 * menu, so seeing a patient took two clicks and a read of a menu — on the
 * screen a receptionist uses more than any other. The rows looked clickable,
 * because rows highlight on hover, and were not.
 *
 * Deliberately not a generic `DataTable` with column definitions. The cells
 * here are not data — they are avatars, two-line contact blocks, badges whose
 * colour means something clinical — and the tables are readable precisely
 * because each screen writes its own. These are two primitives that drop into
 * that markup rather than replacing it.
 */
import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableRow, TABLE_HEAD_CLASS } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { GLASS_FIELD } from '@/lib/surface'

/**
 * Elements that handle their own clicks and must not also open the row.
 *
 * The actions menu, an inline delete, a checkbox, a link to somewhere else: a
 * click that lands on any of them is about that control. Without this the
 * three-dot menu would open the record behind it, which is the one thing that
 * would make rows-as-links worse than the menu it replaces.
 */
const INTERACTIVE = 'a, button, input, select, textarea, [role="menuitem"], [data-no-row-click]'

export interface ClickableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Where the row goes. */
  href: string
  /** Announced to screen readers — "Open Ayesha Khan", not "Open row 4". */
  label?: string
}

/**
 * A table row that opens a record.
 *
 * A row is not a link element, so the behaviour has to be assembled: pointer
 * cursor, Enter and Space, a focus ring, and a name. `role="link"` rather than
 * `button` because that is what it does, and `tabIndex` so it can be reached
 * without a mouse — a receptionist working down a list with the keyboard should
 * not have to open a menu to get into a record.
 */
export const ClickableRow = React.forwardRef<HTMLTableRowElement, ClickableRowProps>(
  ({ href, label, className, onClick, onKeyDown, children, ...props }, ref) => {
    const router = useRouter()

    const open = () => router.push(href)

    return (
      <TableRow
        ref={ref}
        role="link"
        tabIndex={0}
        aria-label={label}
        data-href={href}
        /*
         * The focus state is in app/globals.css, keyed off `data-href`.
         *
         * It asked for `ring-2 ring-inset` here, which is a box-shadow on a
         * `<tr>` — and a row in a border-collapsed table paints no box of its
         * own, so the ring never appeared. Tabbing down a list highlighted
         * nothing. A background and a leading bar are drawn instead, both of
         * which a row does paint.
         */
        className={cn('cursor-pointer focus-visible:outline-none', className)}
        onClick={(event) => {
          onClick?.(event)
          if (event.defaultPrevented) return
          if ((event.target as HTMLElement).closest(INTERACTIVE)) return
          open()
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          // Only when the row itself has focus: Enter inside a menu or a
          // search box within the row belongs to that control.
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            open()
          }
        }}
        {...props}
      >
        {children}
      </TableRow>
    )
  }
)
ClickableRow.displayName = 'ClickableRow'

/**
 * The column a grid's row actions live in.
 *
 * Deliberately empty, and that is the whole point of it existing. Seventeen of
 * the twenty-four list screens headed this column "Actions", which is fine on
 * a desktop and wrong on a phone: below `sm` every row becomes a card and every
 * cell a labelled line, and the labels are read off the header row at runtime
 * (see components/ui/table.tsx). A heading here therefore produced a final card
 * line reading "Actions  ⋯", right-aligned as though the menu were a value
 * somebody had recorded. A column with no heading is laid out as what it is —
 * controls, on their own line at the foot of the card.
 *
 * Nothing is lost to a screen reader: the buttons inside carry their own
 * labels, which is where the name of an action belongs.
 */
export function GridActionsHead({ className }: { className?: string }) {
  return <TableHead className={cn(TABLE_HEAD_CLASS, 'w-px text-right', className)} />
}

/**
 * The cell those actions sit in.
 *
 * `row-actions` is what fades them back until the row is hovered or focused —
 * see app/globals.css. It was applied on some grids and not others, so the same
 * column of three-dot menus was quiet on one screen and a column of noise on
 * the next.
 */
export function GridActionsCell({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return <TableCell className={cn('text-right row-actions', className)}>{children}</TableCell>
}

export interface GridBodyProps {
  /** Columns in the header row. The loading and empty rows span them. */
  columns: number
  loading?: boolean
  /** Placeholder rows to draw while loading. */
  skeletonRows?: number
  /**
   * The fetch failed, which is not the same as the list being empty.
   *
   * The drug catalogue is the only screen that has ever drawn this
   * distinction, and it is right: "no medications found" under a failed
   * request tells somebody their catalogue has been wiped. It belongs here so
   * the other twenty-three can say it too.
   */
  failed?: boolean
  onRetry?: () => void
  /** True when the fetch succeeded and returned nothing. */
  empty?: boolean
  emptyIcon: LucideIcon
  emptyTitle: string
  emptyDescription: string
  /** "Add a procedure", "Clear the filters" — a link or a handler, not both. */
  emptyActionLabel?: string
  emptyActionHref?: string
  onEmptyAction?: () => void
  children?: React.ReactNode
}

/**
 * A grid's body, in all three of the states it has.
 *
 * Every list screen wrote this ternary itself, and twenty-four copies drifted
 * exactly as far as twenty-four copies do. Loading was skeleton rows on fifteen
 * screens, a centred spinner on six — which throws the header away and collapses
 * the card, so the page jumps when the data lands — and on three screens it was
 * nothing at all. Empty was a row inside the table on ten, a block outside the
 * card on eleven, and the shared `EmptyState` on three, with the icon, the
 * wording and the offer of a way out different in almost every one.
 *
 * One implementation, so a screen declares what it has rather than how to draw
 * it. The empty state is the application's own `EmptyState`, so a grid with no
 * rows now looks like every other empty thing in the product.
 *
 * `columns` has to be passed because a `colSpan` cannot be counted from here:
 * the header is a sibling, rendered by the screen.
 */
export function GridBody({
  columns,
  loading = false,
  skeletonRows = 6,
  failed = false,
  onRetry,
  empty = false,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  emptyActionHref,
  onEmptyAction,
  children,
}: GridBodyProps) {
  if (loading) {
    return (
      <TableBody>
        {Array.from({ length: skeletonRows }).map((_, row) => (
          <TableRow key={row}>
            {Array.from({ length: columns }).map((_, column) => (
              <TableCell key={column}>
                {/* Uneven on purpose, and the same unevenness every time: a
                    column of identical grey bars reads as a rendering fault
                    rather than as text that has not arrived. */}
                <Skeleton className={cn('h-4', SKELETON_WIDTHS[column % SKELETON_WIDTHS.length])} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    )
  }

  if (failed) {
    return (
      <TableBody>
        <TableRow>
          <TableCell colSpan={columns} className="p-0">
            <EmptyState
              icon={AlertCircle}
              title="This list could not be loaded"
              description="That is not the same as it being empty — nothing has been lost. Try again."
              actionLabel={onRetry ? 'Try again' : undefined}
              onAction={onRetry}
            />
          </TableCell>
        </TableRow>
      </TableBody>
    )
  }

  if (empty) {
    return (
      <TableBody>
        {/* One cell in the row, which is also how the stacked-card layout
            recognises a message rather than a record. */}
        <TableRow>
          <TableCell colSpan={columns} className="p-0">
            <EmptyState
              icon={emptyIcon}
              title={emptyTitle}
              description={emptyDescription}
              actionLabel={emptyActionLabel}
              actionHref={emptyActionHref}
              onAction={onEmptyAction}
            />
          </TableCell>
        </TableRow>
      </TableBody>
    )
  }

  return <TableBody>{children}</TableBody>
}

const SKELETON_WIDTHS = ['w-28', 'w-20', 'w-32', 'w-16', 'w-24']

export interface GridPaginationProps {
  /** One-based. */
  page: number
  pageSize: number
  /** Rows in the whole result, not on this page. */
  total: number
  onPageChange: (page: number) => void
  /** Plural noun for the records — "patients", "invoices". */
  noun?: string
  /** Offer a page-size picker. Omit to leave the size fixed. */
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  className?: string
}

export const DEFAULT_PAGE_SIZE = 20
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

/**
 * The pager, and the count that tells you what you are looking at.
 *
 * Shown whenever there is anything to show, including on a single page: "45 of
 * 45 patients" is the answer to a question people actually have, and hiding it
 * was why several of these grids gave no total at all.
 */
export function GridPagination({
  page,
  pageSize,
  total,
  onPageChange,
  noun = 'records',
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
}: GridPaginationProps) {
  if (total <= 0) return null

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  const first = (current - 1) * pageSize + 1
  const last = Math.min(current * pageSize, total)

  return (
    <div
      className={cn(
        // The same faint wash as the header rail at the other end of the
        // grid, so the rows are bounded by one material rather than by a
        // legend at the top and a bare line at the bottom.
        'flex flex-col gap-3 border-t border-border/60 bg-foreground/[0.03] px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          {/* One page of results does not need "1 to 45 of 45". */}
          {pages === 1 ? `${total} ${noun}` : `Showing ${first}–${last} of ${total} ${noun}`}
        </span>

        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only sm:not-sr-only">Rows</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className={`${GLASS_FIELD} h-8 rounded-lg px-2 text-sm`}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="text-sm whitespace-nowrap">
          Page {current} of {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pages}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export interface PagedRows<T> {
  page: number
  setPage: (page: number) => void
  pageSize: number
  setPageSize: (size: number) => void
  /** The slice to render. */
  rows: T[]
  total: number
}

/**
 * Paging for a grid whose API hands back the whole list.
 *
 * Several screens fetch everything and render everything — the waitlist, the
 * feedback list, the form templates. They work until a clinic has a year of
 * data, at which point the page renders a thousand rows and the browser
 * decides how that goes.
 *
 * The page resets when the list shrinks beneath it: filtering a hundred rows
 * down to three while sitting on page 4 otherwise shows an empty table with no
 * indication of why.
 */
export function usePagedRows<T>(all: T[], initialSize = DEFAULT_PAGE_SIZE): PagedRows<T> {
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(initialSize)

  const total = all.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pages)

  React.useEffect(() => {
    if (page > pages) setPage(pages)
  }, [page, pages])

  const rows = React.useMemo(
    () => all.slice((current - 1) * pageSize, current * pageSize),
    [all, current, pageSize]
  )

  return {
    page: current,
    setPage,
    pageSize,
    setPageSize: (size: number) => {
      setPageSize(size)
      setPage(1)
    },
    rows,
    total,
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  /** The column being sorted by, or null for the screen's natural order. */
  column: string | null
  direction: SortDirection
}

export interface SortControl extends SortState {
  /** Click a header: sorts ascending, then descending, then back to natural. */
  toggle: (column: string) => void
  /** For a query string — `undefined` when nothing is being sorted. */
  params: { sort?: string; direction?: SortDirection }
}

/**
 * Column sorting for a list screen.
 *
 * Not one header in this application was clickable before this. Order was
 * hardcoded in each API route, which is invisible with ten seeded patients and
 * the first complaint anybody makes with four thousand.
 *
 * Three states rather than two. A header that only alternates ascending and
 * descending gives no way back to the order the screen was designed around —
 * appointments by time, invoices newest first — and that order is usually the
 * one somebody wants after they have finished looking for something.
 */
export function useSort(initial: SortState = { column: null, direction: 'asc' }): SortControl {
  const [state, setState] = React.useState<SortState>(initial)

  const toggle = React.useCallback((column: string) => {
    setState((current) => {
      if (current.column !== column) return { column, direction: 'asc' }
      if (current.direction === 'asc') return { column, direction: 'desc' }
      return { column: null, direction: 'asc' }
    })
  }, [])

  return {
    ...state,
    toggle,
    params: state.column ? { sort: state.column, direction: state.direction } : {},
  }
}

export interface SortableHeaderProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** The value sent to the API, and the key `useSort` tracks. */
  column: string
  sort: SortControl
  children: React.ReactNode
}

/**
 * A column header that sorts.
 *
 * A real `<button>` inside the `<th>`, with `aria-sort` on the cell, because
 * that is the pair a screen reader announces as a sortable column. An arrow
 * shows the current direction; the header is reachable and operable from the
 * keyboard without anything extra, being a button.
 */
export const SortableHeader = React.forwardRef<HTMLTableCellElement, SortableHeaderProps>(
  ({ column, sort, children, className, ...props }, ref) => {
    const active = sort.column === column
    const ariaSort = !active ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending'

    return (
      <th ref={ref} aria-sort={ariaSort} className={cn(TABLE_HEAD_CLASS, className)} {...props}>
        <button
          type="button"
          onClick={() => sort.toggle(column)}
          /*
           * `uppercase` is repeated here on purpose. Tailwind's preflight sets
           * `text-transform: none` on every `button`, so the small capitals the
           * `<th>` asks for stop at this element — a sortable column would read
           * in sentence case beside plain columns in capitals.
           */
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md uppercase tracking-[0.08em] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            // The column the grid is ordered by, named as plainly as the arrow
            // beside it. A coloured arrow over a muted label said which way it
            // was sorted without saying which column was doing the sorting.
            active && 'text-foreground'
          )}
        >
          {children}
          {/*
            Drawn rather than typed. `▲` and `▼` are rendered by whichever font
            on the machine happens to carry them, so the arrow sat at a
            different size and baseline on every platform; and the unsorted
            state was the ascending arrow at 30% opacity, which reads as "sorted
            ascending, faintly" rather than as "sortable".
          */}
          {!active ? (
            <ChevronsUpDown aria-hidden="true" className="h-3 w-3 opacity-40" />
          ) : sort.direction === 'asc' ? (
            <ChevronUp aria-hidden="true" className="h-3 w-3 text-primary" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-3 w-3 text-primary" />
          )}
        </button>
      </th>
    )
  }
)
SortableHeader.displayName = 'SortableHeader'

/**
 * Sort rows already in memory.
 *
 * For screens whose list is not paged by the server. `value` pulls the
 * comparable out of a row, because what a column displays and what it sorts by
 * are rarely the same thing — a patient row shows a name and sorts on it, an
 * appointment row shows "9:00 AM" and sorts on an instant.
 */
export function sortRows<T>(
  rows: T[],
  sort: SortState,
  value: (row: T, column: string) => string | number | Date | null | undefined
): T[] {
  if (!sort.column) return rows
  const column = sort.column
  const factor = sort.direction === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    const left = value(a, column)
    const right = value(b, column)

    // Empties sort last whichever way the column is pointing: a blank is not a
    // small value, it is a missing one, and burying them under a descending
    // sort hides exactly the rows somebody is usually looking for.
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1

    if (typeof left === 'string' && typeof right === 'string') {
      return left.localeCompare(right, undefined, { sensitivity: 'base' }) * factor
    }
    return (Number(left) - Number(right)) * factor
  })
}
