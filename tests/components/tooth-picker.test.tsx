// @ts-nocheck
/**
 * The tooth picker's default.
 *
 * The rule under test is narrow on purpose: the picker takes the chart's
 * answer only when the chart has exactly one, never over a selection the form
 * already carries, and never twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('lucide-react', async (importOriginal) => {
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `lucide-${name}` })
    )
  const actual = (await importOriginal()) as any
  return new Proxy(actual, { get: (_: any, p: string) => actual[p] || icon(p) })
})

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: () => null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

import { ToothPicker } from '@/components/dental-chart/tooth-picker'

/** A chart response holding one active finding per listed tooth. */
function chartOf(findings: Record<number, string>) {
  const chartData: Record<number, unknown[]> = {}
  for (const [tooth, condition] of Object.entries(findings)) {
    chartData[Number(tooth)] = [{ condition, severity: 'MILD', notes: null }]
  }
  return { ok: true, json: async () => ({ chartData }) }
}

/** Renders the picker as a form would: selection held above it. */
function Harness({ initial = [], ...props }: any) {
  const [teeth, setTeeth] = React.useState<number[]>(initial)
  return (
    <>
      <span data-testid="selection">{teeth.join(',')}</span>
      <ToothPicker patientId="p1" selected={teeth} onChange={setTeeth} {...props} />
    </>
  )
}

const selection = () => screen.getByTestId('selection').textContent

describe('ToothPicker default selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('takes the single tooth with a finding', async () => {
    vi.mocked(global.fetch).mockResolvedValue(chartOf({ 16: 'CARIES' }) as Response)
    render(<Harness defaultToFindings />)
    await waitFor(() => expect(selection()).toBe('16'))
  })

  it('leaves the field empty when the chart names more than one', async () => {
    // Eight standing findings are not eight teeth being prescribed for.
    vi.mocked(global.fetch).mockResolvedValue(
      chartOf({ 16: 'CARIES', 26: 'CARIES', 36: 'FRACTURED' }) as Response
    )
    render(<Harness defaultToFindings />)
    await waitFor(() => expect(screen.getByText(/Select the 3 teeth/)).toBeInTheDocument())
    expect(selection()).toBe('')
  })

  it('ignores findings that are not something wrong now', async () => {
    // A filling placed two years ago is history, not a reason to prescribe.
    vi.mocked(global.fetch).mockResolvedValue(chartOf({ 16: 'FILLED' }) as Response)
    render(<Harness defaultToFindings />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(selection()).toBe('')
  })

  it('never overrides a selection the form already carries', async () => {
    // Prescribing from a treatment: the treatment's teeth win.
    vi.mocked(global.fetch).mockResolvedValue(chartOf({ 16: 'CARIES' }) as Response)
    render(<Harness defaultToFindings initial={[47]} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(selection()).toBe('47')
  })

  it('does not fill the field back in after it is cleared', async () => {
    vi.mocked(global.fetch).mockResolvedValue(chartOf({ 16: 'CARIES' }) as Response)
    render(<Harness defaultToFindings />)
    await waitFor(() => expect(selection()).toBe('16'))

    fireEvent.click(screen.getByRole('button', { name: /Remove tooth 16/ }))
    expect(selection()).toBe('')

    // A re-render must not re-apply it; the dentist meant to clear it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(selection()).toBe('')
  })

  it('does nothing without the prop', async () => {
    vi.mocked(global.fetch).mockResolvedValue(chartOf({ 16: 'CARIES' }) as Response)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText(/Select the 1 tooth/)).toBeInTheDocument())
    expect(selection()).toBe('')
  })
})

describe('ToothPicker findings shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('is not offered once pressing it would change nothing', async () => {
    vi.mocked(global.fetch).mockResolvedValue(chartOf({ 16: 'CARIES', 26: 'CARIES' }) as Response)
    render(<Harness defaultToFindings />)

    const shortcut = await screen.findByText(/Select the 2 teeth/)
    fireEvent.click(shortcut)

    await waitFor(() => expect(selection()).toBe('16,26'))
    expect(screen.queryByText(/Select the 2 teeth/)).not.toBeInTheDocument()
  })
})
