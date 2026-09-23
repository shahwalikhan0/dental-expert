/**
 * The label on an icon-only action.
 *
 * Radix renders tooltip content into a portal on hover, which jsdom will not
 * do reliably; what is worth pinning down here is the part that does not
 * depend on hovering — that the wrapper leaves the control it wraps intact,
 * including the handlers and the accessible name a row's actions depend on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'

const onClick = vi.fn()

beforeEach(() => vi.clearAllMocks())

describe('IconTooltip', () => {
  it('renders without a TooltipProvider of its own above it', () => {
    // Radix throws rather than warns when a Tooltip has no provider, so a
    // screen rendered outside the dashboard shell must still work.
    expect(() =>
      render(
        <IconTooltip label="Delete this medication">
          <Button aria-label="Delete this medication">x</Button>
        </IconTooltip>
      )
    ).not.toThrow()
  })

  it('keeps the wrapped control clickable', () => {
    render(
      <IconTooltip label="Delete this medication">
        <Button aria-label="Delete this medication" onClick={onClick}>
          x
        </Button>
      </IconTooltip>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete this medication' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('leaves the accessible name on the control, not only in the tooltip', () => {
    render(
      <IconTooltip label="Mark this recare as done">
        <Button aria-label="Mark this recare as done">x</Button>
      </IconTooltip>
    )
    expect(screen.getByRole('button', { name: 'Mark this recare as done' })).toBeInTheDocument()
  })

  it('passes a disabled control through as disabled', () => {
    render(
      <IconTooltip label="Mark this recare as done">
        <Button aria-label="Mark this recare as done" disabled onClick={onClick}>
          x
        </Button>
      </IconTooltip>
    )
    const button = screen.getByRole('button', { name: 'Mark this recare as done' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
