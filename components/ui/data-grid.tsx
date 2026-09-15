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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

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
        className={cn(
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          className
        )}
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
        'flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
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
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
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
