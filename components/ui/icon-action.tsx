'use client'

/**
 * A label for an action drawn as an icon and nothing else.
 *
 * A pencil, a bin, an eye, three dots: every grid's actions column is a strip
 * of these, and what they do was only ever written down in `aria-label` —
 * which a screen reader announces and a person looking at the screen never
 * sees. The bin is guessable. On the recall list, `Check` (mark it done) and
 * `Clock` (defer it for a month) sit next to each other and are not.
 *
 * Wrapping rather than replacing the button: an actions cell is rarely a plain
 * button. It is a `DropdownMenuTrigger`, or a link, or a button that swaps its
 * icon for a spinner while the row is busy — all of which need to stay the
 * element they are. The wrapper adds the tooltip and leaves the control alone.
 */
import * as React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface IconTooltipProps {
  /**
   * What the control does, as the screen would say it — "Delete this
   * medication", not "Delete". Keep it the same string as the wrapped
   * control's `aria-label` so the two readings of the icon agree.
   */
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** The control to label. Exactly one element, which takes the trigger. */
  children: React.ReactElement
}

/**
 * The same delay the dashboard shell sets, repeated here on purpose.
 *
 * Radix throws — not warns, throws — when a `Tooltip` has no `TooltipProvider`
 * above it, and this component is a leaf in the actions column of twenty-odd
 * grids. Depending on an invisible ancestor means one screen rendered outside
 * the shell (a print view, a patient-portal page, a route added later) takes
 * down the whole grid rather than losing a tooltip.
 *
 * Nesting a provider inside the shell's is supported and costs a context. The
 * delay is stated so the tooltips behave the same whichever provider wins,
 * rather than dropping to Radix's own 700ms default.
 */
const TOOLTIP_DELAY_MS = 200

export function IconTooltip({ label, side = 'top', children }: IconTooltipProps) {
  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
