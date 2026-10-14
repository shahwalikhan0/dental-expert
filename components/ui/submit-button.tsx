'use client'

import * as React from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'

export interface SubmitButtonProps extends ButtonProps {
  /** A request is out: spinner, `busyLabel`, disabled. */
  busy?: boolean
  /**
   * What is happening, as a verb-ing phrase ending in "…": "Saving…",
   * "Creating invoice…". Default "Saving…".
   */
  busyLabel?: string
  /** Drawn before the label when not busy — `Save`, `Send`. */
  icon?: LucideIcon
}

/**
 * The button that sends a form, busy the one way.
 *
 * Six busy styles had grown up: a label swap with a spinner, a spinner with
 * the label unchanged, a label swap with no spinner, a spinner prepended, a
 * ternary of three labels, and a raw blue button. Now: the spinner replaces the
 * icon, the label says what is happening ("Saving…"), and the button is
 * disabled so a second click cannot send it twice.
 *
 *   <SubmitButton busy={saving} busyLabel="Creating invoice…" icon={Save}>
 *     Create invoice
 *   </SubmitButton>
 *
 * `type="submit"` by default; pass `type="button"` with an `onClick` where the
 * page submits by hand.
 */
export const SubmitButton = React.forwardRef<HTMLButtonElement, SubmitButtonProps>(
  (
    {
      busy = false,
      busyLabel = 'Saving…',
      icon: Icon,
      disabled,
      type = 'submit',
      children,
      ...props
    },
    ref
  ) => (
    <Button
      ref={ref}
      type={type}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        <>
          {Icon && <Icon className="mr-2 h-4 w-4" aria-hidden="true" />}
          {children}
        </>
      )}
    </Button>
  )
)
SubmitButton.displayName = 'SubmitButton'
