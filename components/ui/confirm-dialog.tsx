'use client'

import * as React from 'react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'

/**
 * Asking before anything destructive or irreversible.
 *
 * The wording standard (docs/UX_STANDARDS.md):
 *
 *   - the title is a sentence-case question naming the record —
 *     "Cancel appointment APT-0012?", not "Cancel Appointment";
 *   - the description says what happens and what is kept;
 *   - the confirm label repeats the verb — "Cancel appointment", never "OK" or
 *     "Confirm", so the button can be read on its own;
 *   - the cancel label is "Keep it" style only when "Cancel" would be
 *     ambiguous (cancelling a cancellation); otherwise "Cancel".
 *
 * `tone: 'destructive'` (the default) draws the confirm button in the
 * destructive token; `'default'` for an irreversible step that destroys
 * nothing, such as issuing an invoice.
 */

export type ConfirmTone = 'destructive' | 'default'

/** Ask for a reason in the dialog itself, for actions the record must explain. */
export interface ConfirmReasonOptions {
  /** The field's label: "Why is this appointment being cancelled?" */
  label: string
  /** Confirm stays disabled until a reason is given. Default true. */
  required?: boolean
  /** Characters needed (after trimming) before confirming. Default 3 when required. */
  minLength?: number
  placeholder?: string
}

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  /** @deprecated Use `tone`. */
  variant?: ConfirmTone
  /** Show a reason textarea. `onConfirm` receives what was typed. */
  reason?: ConfirmReasonOptions
  onConfirm: (reason: string) => void | Promise<void>
  loading?: boolean
}

/** The characters a reason needs before Confirm is enabled. */
export function reasonMinimum(reason: ConfirmReasonOptions | undefined): number {
  if (!reason) return 0
  const required = reason.required ?? true
  return reason.minLength ?? (required ? 3 : 0)
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone,
  variant,
  reason,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [text, setText] = useState('')
  const reasonId = React.useId()
  const resolvedTone = tone ?? variant ?? 'destructive'

  // A fresh, empty reason each time it opens. Reset while rendering rather
  // than in an effect, so the first frame of a reopened dialog is already
  // empty instead of showing the last reason for a moment.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setText('')
  }

  const minimum = reasonMinimum(reason)
  const reasonShort = Boolean(reason) && text.trim().length < minimum

  const handleConfirm = async () => {
    setIsLoading(true)
    try {
      await onConfirm(text.trim())
    } finally {
      setIsLoading(false)
      onOpenChange(false)
    }
  }

  const busy = loading || isLoading

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {reason && (
          <div className="space-y-2">
            <Label
              htmlFor={reasonId}
              className={(reason.required ?? true) ? 'label-required' : undefined}
            >
              {reason.label}
            </Label>
            <Textarea
              id={reasonId}
              rows={3}
              value={text}
              placeholder={reason.placeholder}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
              aria-describedby={minimum > 0 ? `${reasonId}-hint` : undefined}
            />
            {minimum > 0 && (
              <p id={`${reasonId}-hint`} className="text-xs text-muted-foreground">
                At least {minimum} characters.
              </p>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleConfirm()
            }}
            disabled={busy || reasonShort}
            className={
              resolvedTone === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : ''
            }
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export interface ConfirmOptions {
  /** A sentence-case question naming the record: "Delete template “Post-extraction”?" */
  title: string
  /** What happens, and what is kept. */
  description: React.ReactNode
  /** Repeats the verb: "Delete template". Default "Confirm". */
  confirmLabel?: string
  cancelLabel?: string
  /** Default 'destructive'. */
  tone?: ConfirmTone
  /** @deprecated Use `tone`. */
  variant?: ConfirmTone
}

export interface ConfirmWithReasonOptions extends ConfirmOptions {
  reason: ConfirmReasonOptions
}

export interface ConfirmResult {
  confirmed: boolean
  /** Trimmed. Empty when cancelled. */
  reason: string
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  reason?: ConfirmReasonOptions
  resolve: ((value: ConfirmResult) => void) | null
}

/**
 * A promise-based confirm, for event handlers.
 *
 *   const { confirm, ConfirmDialogComponent } = useConfirmDialog()
 *
 *   // yes/no — resolves to a boolean, as it always has
 *   if (!(await confirm({ title: 'Delete template “X”?', description: '…',
 *     confirmLabel: 'Delete template' }))) return
 *
 *   // with a reason — resolves to { confirmed, reason }
 *   const { confirmed, reason } = await confirm({
 *     title: 'Cancel appointment APT-0012?',
 *     description: 'The slot is freed and the patient is not charged.',
 *     confirmLabel: 'Cancel appointment',
 *     cancelLabel: 'Keep appointment',
 *     reason: { label: 'Why is it being cancelled?', minLength: 3 },
 *   })
 *
 * Render `{ConfirmDialogComponent}` once anywhere in the component.
 */
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: '',
    description: '',
    resolve: null,
  })

  function confirm(opts: ConfirmWithReasonOptions): Promise<ConfirmResult>
  function confirm(opts: ConfirmOptions): Promise<boolean>
  function confirm(
    opts: ConfirmOptions | ConfirmWithReasonOptions
  ): Promise<boolean | ConfirmResult> {
    const withReason = 'reason' in opts && Boolean(opts.reason)
    return new Promise((resolve) => {
      setState({
        ...opts,
        open: true,
        resolve: (result) => resolve(withReason ? result : result.confirmed),
      })
    })
  }

  const ConfirmDialogComponent = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open && state.resolve) {
          state.resolve({ confirmed: false, reason: '' })
        }
        setState((prev) => ({ ...prev, open, resolve: null }))
      }}
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel || 'Confirm'}
      cancelLabel={state.cancelLabel || 'Cancel'}
      tone={state.tone ?? state.variant ?? 'destructive'}
      reason={state.reason}
      onConfirm={(reason) => {
        state.resolve?.({ confirmed: true, reason })
        setState((prev) => ({ ...prev, open: false, resolve: null }))
      }}
    />
  )

  return { confirm, ConfirmDialogComponent }
}
