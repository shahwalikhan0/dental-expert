'use client'

import * as React from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** What a control needs to be tied to its label, hint and error. */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
}

/**
 * The ids a field's parts share, and the props its control should carry.
 *
 *   const field = fieldIds('discount', { error, hint })
 *   <Input {...field.control} />
 *   <p id={field.errorId}>{error}</p>
 *
 * `aria-describedby` names the error when there is one, else the hint, so a
 * screen reader reads the message that applies when the control is focused.
 */
export function fieldIds(
  id: string,
  {
    error,
    hint,
    required,
  }: { error?: React.ReactNode; hint?: React.ReactNode; required?: boolean } = {}
) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = error ? errorId : hint ? hintId : undefined
  return {
    id,
    errorId,
    hintId,
    control: {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
      'aria-required': required || undefined,
    } as FieldControlProps,
  }
}

interface FormFieldProps {
  label: React.ReactNode
  /**
   * The control's id. Generated when omitted — then pass `children` as a
   * function to receive it.
   */
  htmlFor?: string
  /** Draws the `label-required` asterisk and sets `aria-required`. */
  required?: boolean
  /** Shown under the control, in the destructive colour, instead of the hint. */
  error?: React.ReactNode
  /** Shown under the control when there is no error. */
  hint?: React.ReactNode
  /**
   * The control. Either an element you wire yourself (give it `id={htmlFor}`),
   * or a function that receives `{ id, aria-describedby, aria-invalid,
   * aria-required }` to spread onto it — the way to get the error read out.
   */
  children: React.ReactNode | ((control: FieldControlProps) => React.ReactNode)
  className?: string
}

/**
 * A form field: label, required marker, control, and an inline error or hint.
 *
 *   <FormField label="Phone" required error={errors.phone} hint="Mobile, for reminders">
 *     {(control) => <PhoneInput {...control} value={phone} onChange={setPhone} />}
 *   </FormField>
 *
 * The standard for every dashboard form (docs/UX_STANDARDS.md): errors are
 * shown here, under the field, as well as in one summary toast — a toast alone
 * disappears and does not say which field.
 */
export function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  className,
}: FormFieldProps) {
  const generated = React.useId()
  const field = fieldIds(htmlFor ?? generated, { error, hint, required })

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={field.id} className={required ? 'label-required' : ''}>
        {label}
      </Label>
      {typeof children === 'function' ? children(field.control) : children}
      {error && (
        <p id={field.errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={field.hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
