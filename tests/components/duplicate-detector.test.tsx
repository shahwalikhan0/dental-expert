import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

import { DuplicateDetector } from '@/components/patients/duplicate-detector'

/**
 * The duplicate warning on the registration form.
 *
 * It lived in tests/components/ai-components.test.tsx and mocked a response
 * shaped `{ data: { duplicates } }` — the envelope of `/api/ai/clinical`, a
 * route that does not exist in this repository. The tests passed against the
 * mock while the component 404ed against the real application, and because a
 * failed check rendered nothing, the form looked identical to one with no
 * duplicates. The last case below is the one that would have caught it.
 */

const mockFetchResponse = (data: unknown, ok = true) => {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok,
    json: async () => data,
    text: async () => JSON.stringify(data),
    status: ok ? 200 : 500,
  } as Response)
}

beforeEach(() => {
  vi.restoreAllMocks()
  global.fetch = vi.fn()
})

describe('DuplicateDetector', () => {
  it('renders nothing when no required props provided (empty firstName)', async () => {
    // fetch should not be called if firstName/lastName/phone are empty
    const { container } = render(
      <DuplicateDetector firstName="" lastName="" phone="" onSelect={vi.fn()} />
    )

    // Wait for debounce timeout (1200ms)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1400))
    })

    // No duplicates found, returns null
    expect(container.innerHTML).toBe('')
    // fetch should not have been called since firstName is empty
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('shows checking spinner while fetching', async () => {
    // Make fetch never resolve
    vi.mocked(global.fetch).mockReturnValueOnce(new Promise(() => {}))

    render(
      <DuplicateDetector firstName="John" lastName="Doe" phone="1234567890" onSelect={vi.fn()} />
    )

    // Wait for debounce to trigger
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300))
    })

    expect(screen.getByText('Checking for duplicates\u2026')).toBeInTheDocument()
  })

  it('shows duplicate warning when duplicates found', async () => {
    mockFetchResponse({
      duplicates: [
        {
          id: 'p1',
          patientId: 'PAT-001',
          name: 'John Doe',
          confidence: 0.95,
          matchFields: ['name', 'phone'],
        },
      ],
    })

    render(
      <DuplicateDetector firstName="John" lastName="Doe" phone="1234567890" onSelect={vi.fn()} />
    )

    await waitFor(
      () => {
        expect(screen.getByText(/Possible duplicate patient/)).toBeInTheDocument()
        expect(screen.getByText('John Doe')).toBeInTheDocument()
        expect(screen.getByText(/95% match/)).toBeInTheDocument()
        expect(screen.getByText(/name, phone/)).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })

  it('calls onSelect when "Use existing" button is clicked', async () => {
    mockFetchResponse({
      duplicates: [
        {
          id: 'existing-p1',
          patientId: 'PAT-001',
          name: 'John Doe',
          confidence: 0.9,
          matchFields: ['name'],
        },
      ],
    })

    const onSelect = vi.fn()

    render(
      <DuplicateDetector firstName="John" lastName="Doe" phone="1234567890" onSelect={onSelect} />
    )

    await waitFor(
      () => {
        expect(screen.getByText('Use existing')).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    await act(async () => {
      fireEvent.click(screen.getByText('Use existing'))
    })

    expect(onSelect).toHaveBeenCalledWith('existing-p1')
  })

  it('renders nothing when no duplicates are found', async () => {
    mockFetchResponse({ data: { duplicates: [] } })

    const { container } = render(
      <DuplicateDetector
        firstName="UniqueFirst"
        lastName="UniqueLast"
        phone="9999999999"
        onSelect={vi.fn()}
      />
    )

    await waitFor(
      () => {
        // After check completes, no duplicates => returns null
        expect(container.innerHTML).toBe('')
      },
      { timeout: 3000 }
    )
  })

  it('shows multiple duplicates when found', async () => {
    mockFetchResponse({
      duplicates: [
        {
          id: 'p1',
          patientId: 'PAT-001',
          name: 'John Doe',
          confidence: 0.95,
          matchFields: ['name', 'phone'],
        },
        {
          id: 'p2',
          patientId: 'PAT-002',
          name: 'Jon Doe',
          confidence: 0.7,
          matchFields: ['phone'],
        },
      ],
    })

    render(
      <DuplicateDetector firstName="John" lastName="Doe" phone="1234567890" onSelect={vi.fn()} />
    )

    await waitFor(
      () => {
        expect(screen.getByText(/Possible duplicate patients detected/)).toBeInTheDocument()
        expect(screen.getByText('John Doe')).toBeInTheDocument()
        expect(screen.getByText('Jon Doe')).toBeInTheDocument()
        const useExistingButtons = screen.getAllByText('Use existing')
        expect(useExistingButtons).toHaveLength(2)
      },
      { timeout: 3000 }
    )
  })
})

describe('DuplicateDetector — a check that did not run', () => {
  it('says so when the endpoint answers with an error, rather than showing nothing', async () => {
    mockFetchResponse({ error: 'boom' }, false)

    render(
      <DuplicateDetector firstName="John" lastName="Doe" phone="1234567890" onSelect={vi.fn()} />
    )

    await waitFor(
      () => {
        expect(screen.getByText(/duplicate check could not run/i)).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })

  it('says so when the request itself fails', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))

    render(
      <DuplicateDetector firstName="John" lastName="Doe" phone="1234567890" onSelect={vi.fn()} />
    )

    await waitFor(
      () => {
        expect(screen.getByText(/duplicate check could not run/i)).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })

  it('asks the patients endpoint, not an AI one', async () => {
    mockFetchResponse({ duplicates: [] })

    render(
      <DuplicateDetector firstName="John" lastName="Doe" phone="1234567890" onSelect={vi.fn()} />
    )

    await waitFor(
      () => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/patients/duplicates',
          expect.objectContaining({ method: 'POST' })
        )
      },
      { timeout: 3000 }
    )
  })
})
