/**
 * The row that tells you the list is filtered.
 *
 * The whole point of this component is what it does when nothing is applied —
 * it draws nothing, so that its presence is the signal. The rest is that each
 * chip clears its own filter and only its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActiveFilters } from '@/components/ui/active-filters'

const clearSearch = vi.fn()
const clearStatus = vi.fn()
const clearAll = vi.fn()

beforeEach(() => vi.clearAllMocks())

function bar(search: string | null, status: string | null) {
  return render(
    <ActiveFilters
      noun="invoices"
      onClearAll={clearAll}
      filters={[
        { label: 'Search', value: search, onClear: clearSearch },
        { label: 'Status', value: status, onClear: clearStatus },
      ]}
    />
  )
}

describe('ActiveFilters', () => {
  it('draws nothing when no filter is applied', () => {
    const { container } = bar(null, null)
    expect(container).toBeEmptyDOMElement()
  })

  it('treats an empty string as unapplied, not as a filter for ""', () => {
    const { container } = bar('', '')
    expect(container).toBeEmptyDOMElement()
  })

  it('names each applied filter and what it is set to', () => {
    bar('khan', 'Overdue')
    expect(screen.getByText('Status:')).toBeInTheDocument()
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('khan')).toBeInTheDocument()
  })

  it('counts only the filters that are applied', () => {
    bar(null, 'Overdue')
    expect(screen.getByText(/1 filter applied/)).toBeInTheDocument()

    clearAll.mockClear()
    bar('khan', 'Overdue')
    expect(screen.getByText(/2 filters applied/)).toBeInTheDocument()
  })

  it('clears one filter without touching the other', () => {
    bar('khan', 'Overdue')
    fireEvent.click(screen.getByRole('button', { name: 'Clear the Status filter' }))
    expect(clearStatus).toHaveBeenCalledTimes(1)
    expect(clearSearch).not.toHaveBeenCalled()
    expect(clearAll).not.toHaveBeenCalled()
  })

  it('offers a clear-all that leaves the individual handlers alone', () => {
    bar('khan', 'Overdue')
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }))
    expect(clearAll).toHaveBeenCalledTimes(1)
    expect(clearSearch).not.toHaveBeenCalled()
    expect(clearStatus).not.toHaveBeenCalled()
  })

  it('announces itself, because what changed is the length of a list elsewhere', () => {
    bar('khan', null)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})
