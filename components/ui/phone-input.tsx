'use client'

import * as React from 'react'
import { Input, type InputProps } from '@/components/ui/input'
import { normalisePhone } from '@/lib/utils'

export interface PhoneInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type'> {
  value: string
  /** The text, on every keystroke; on blur, the normalised form. */
  onChange: (value: string) => void
}

/**
 * A phone number.
 *
 * `type="tel"` everywhere (it was plain text on six forms, so phones got a
 * letter keyboard), the placeholder a Pakistani mobile as people write it —
 * "0300 1234567"; "10-digit mobile number" was wrong, a PK mobile has eleven —
 * and on blur a Pakistani mobile in any shape (`+92 300…`, `0092…`, `300…`,
 * with spaces or dashes) is rewritten to the stored form `03001234567`
 * (`normalisePhone`, lib/utils.ts). Stored digits-only because the patient
 * search matches phones literally: a stored `0300 1234567` is not found by
 * somebody typing `03001234567`. Displayed back as `0300 1234567` with
 * `formatPhone`. Anything else — a landline, a foreign number — is only
 * trimmed.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, onBlur, placeholder = '0300 1234567', ...props }, ref) => (
    <Input
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => {
        const normalised = normalisePhone(value)
        if (normalised !== value) onChange(normalised)
        onBlur?.(event)
      }}
      {...props}
    />
  )
)
PhoneInput.displayName = 'PhoneInput'
