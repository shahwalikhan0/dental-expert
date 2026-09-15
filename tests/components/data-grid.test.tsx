/**
 * The two primitives every list screen uses.
 *
 * `ClickableRow` is the one with a trap in it: rows carry an actions menu, and
 * a row that swallows the menu's click would be worse than the menu it
 * replaces. Most of these tests are about clicks that must *not* open the row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Table, TableBody, TableCell } from '@/components/ui/table'
import { ClickableRow, GridPagination, usePagedRows } from '@/components/ui/data-grid'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

beforeEach(() => vi.clearAllMocks())

function row(children: React.ReactNode) {
  return render(
    <Table>
      <TableBody>
        <ClickableRow href="/patients/p1" label="Open Ayesha Khan">
          <TableCell>Ayesha Khan</TableCell>
          <TableCell>{children}</TableCell>
        </ClickableRow>
      </TableBody>
    </Table>
  )
}

describe('ClickableRow', () => {
  it('opens the record when the row is clicked', () => {
    row(null)

    fireEvent.click(screen.getByText('Ayesha Khan'))

    expect(push).toHaveBeenCalledWith('/patients/p1')
  })

  it('opens on Enter and on Space', () => {
    row(null)
    const target = screen.getByRole('link')

    fireEvent.keyDown(target, { key: 'Enter' })
    fireEvent.keyDown(target, { key: ' ' })

    expect(push).toHaveBeenCalledTimes(2)
  })

  it('ignores other keys', () => {
    row(null)

    fireEvent.keyDown(screen.getByRole('link'), { key: 'a' })

    expect(push).not.toHaveBeenCalled()
  })

  it('is reachable and named without a mouse', () => {
    row(null)
    const target = screen.getByRole('link', { name: 'Open Ayesha Khan' })

    expect(target).toHaveAttribute('tabIndex', '0')
  })

  it('leaves a click on the actions menu alone', () => {
    // The whole reason the row cannot simply be an onClick.
    row(<button type="button">Actions</button>)

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))

    expect(push).not.toHaveBeenCalled()
  })

  it('leaves a click on a link inside the row alone', () => {
    row(<a href="/elsewhere">Invoice</a>)

    fireEvent.click(screen.getByRole('link', { name: 'Invoice' }))

    expect(push).not.toHaveBeenCalled()
  })

  it('leaves a click on a control nested inside a wrapper alone', () => {
    // Real rows wrap the trigger in a div or two.
    row(
      <div>
        <span>
          <button type="button">Delete</button>
        </span>
      </div>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(push).not.toHaveBeenCalled()
  })

  it('leaves anything marked as its own concern alone', () => {
    row(<span data-no-row-click>Stock 12</span>)

    fireEvent.click(screen.getByText('Stock 12'))

    expect(push).not.toHaveBeenCalled()
  })

  it('does not open on Enter pressed inside a control in the row', () => {
    row(<input aria-label="Quantity" />)

    fireEvent.keyDown(screen.getByLabelText('Quantity'), { key: 'Enter' })

    expect(push).not.toHaveBeenCalled()
  })
})

describe('GridPagination', () => {
  const pager = (props: Partial<React.ComponentProps<typeof GridPagination>> = {}) =>
    render(
      <GridPagination
        page={1}
        pageSize={20}
        total={57}
        onPageChange={vi.fn()}
        noun="patients"
        {...props}
      />
    )

  it('says what is on screen and what there is', () => {
    pager()

    expect(screen.getByText('Showing 1–20 of 57 patients')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('still gives the total on a single page', () => {
    // Several of the grids hid the pager below one page, so a short list gave
    // no clue how many records it was showing.
    pager({ total: 7 })

    expect(screen.getByText('7 patients')).toBeInTheDocument()
  })

  it('names the records the way the screen does', () => {
    pager({ total: 3, noun: 'invoices' })

    expect(screen.getByText('3 invoices')).toBeInTheDocument()
  })

  it('shows nothing at all when there is nothing', () => {
    const { container } = pager({ total: 0 })

    expect(container).toBeEmptyDOMElement()
  })

  it('counts the last page correctly', () => {
    pager({ page: 3 })

    expect(screen.getByText('Showing 41–57 of 57 patients')).toBeInTheDocument()
  })

  it('cannot go back from the first page or on from the last', () => {
    pager({ page: 1, total: 10, pageSize: 10 })

    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('moves a page at a time', () => {
    const onPageChange = vi.fn()
    pager({ page: 2, onPageChange })

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /previous/i }))

    expect(onPageChange).toHaveBeenNthCalledWith(1, 3)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1)
  })

  it('offers a page size only when the screen can act on one', () => {
    pager()
    expect(screen.queryByLabelText('Rows per page')).not.toBeInTheDocument()

    pager({ onPageSizeChange: vi.fn() })
    expect(screen.getByLabelText('Rows per page')).toBeInTheDocument()
  })

  it('survives a page beyond the end', () => {
    // A filter can shrink the result under a page the user is already on.
    pager({ page: 99 })

    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  })
})

describe('usePagedRows', () => {
  const ROWS = Array.from({ length: 25 }, (_, i) => `row-${i + 1}`)

  function Harness({ rows = ROWS }: { rows?: string[] }) {
    const paged = usePagedRows(rows, 10)
    return (
      <div>
        <ul>
          {paged.rows.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <span data-testid="page">{paged.page}</span>
        <span data-testid="total">{paged.total}</span>
        <button onClick={() => paged.setPage(paged.page + 1)}>next</button>
        <button onClick={() => paged.setPageSize(25)}>bigger</button>
      </div>
    )
  }

  it('slices the list to a page', () => {
    render(<Harness />)

    expect(screen.getByText('row-1')).toBeInTheDocument()
    expect(screen.getByText('row-10')).toBeInTheDocument()
    expect(screen.queryByText('row-11')).not.toBeInTheDocument()
    expect(screen.getByTestId('total')).toHaveTextContent('25')
  })

  it('moves on', () => {
    render(<Harness />)

    fireEvent.click(screen.getByText('next'))

    expect(screen.getByText('row-11')).toBeInTheDocument()
    expect(screen.queryByText('row-10')).not.toBeInTheDocument()
  })

  it('does not strand the reader past the end of a filtered list', () => {
    const { rerender } = render(<Harness />)
    fireEvent.click(screen.getByText('next'))
    fireEvent.click(screen.getByText('next'))
    expect(screen.getByTestId('page')).toHaveTextContent('3')

    rerender(<Harness rows={ROWS.slice(0, 4)} />)

    expect(screen.getByTestId('page')).toHaveTextContent('1')
    expect(screen.getByText('row-1')).toBeInTheDocument()
  })

  it('goes back to the first page when the size changes', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('next'))

    fireEvent.click(screen.getByText('bigger'))

    expect(screen.getByTestId('page')).toHaveTextContent('1')
    expect(screen.getByText('row-25')).toBeInTheDocument()
  })
})
