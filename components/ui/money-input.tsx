'use client'

import * as React from 'react'
import { Input, type InputProps } from '@/components/ui/input'
import { isInvalidMoney, parseMoney, tidyMoney } from '@/lib/money-input'
import { cn } from '@/lib/utils'

export { parseMoney, isInvalidMoney }

export interface MoneyInputProps extends Omit<
  InputProps,
  'value' | 'onChange' | 'type' | 'inputMode'
> {
  /** The text in the field. Keep it as text in form state, not as a number. */
  value: string
  /**
   * Every change, with the text and what it parses to — `null` for a blank or
   * anything that is not an amount, never a silent 0.
   */
  onChange: (raw: string, amount: number | null) => void
  /** The currency prefix drawn in the field. Default "Rs". */
  prefix?: string
}

/**
 * An amount of money: "Rs" in the field, a decimal keypad on a phone, never
 * negative, at most two decimal places.
 *
 * A text input with `inputMode="decimal"`, not `type="number"`: a number input
 * changes its value when the mouse wheel passes over it, rejects "1,500"
 * silently (its value becomes `''`), and reads `1e3` as a thousand.
 * `parseMoney` (lib/money-input.ts) is the one reading of what was typed; an
 * entry it cannot read is flagged with `aria-invalid` at once, and the form
 * treats `amount === null` as missing rather than as zero. On blur, grouping
 * commas and a typed "Rs" are tidied away.
 *
 *   <MoneyInput
 *     id="discount"
 *     value={discount}
 *     onChange={(raw) => setDiscount(raw)}
 *     aria-label="Discount amount"
 *   />
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    { value, onChange, prefix = 'Rs', className, onBlur, 'aria-invalid': ariaInvalid, ...props },
    ref
  ) => {
    const invalid = isInvalidMoney(value)
    return (
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
        >
          {prefix}
        </span>
        <Input
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value, parseMoney(event.target.value))}
          onBlur={(event) => {
            const tidied = tidyMoney(value)
            if (tidied !== value) onChange(tidied, parseMoney(tidied))
            onBlur?.(event)
          }}
          className={cn('pl-10 text-right tabular-nums', className)}
          {...props}
          aria-invalid={ariaInvalid ?? (invalid || undefined)}
        />
      </div>
    )
  }
)
MoneyInput.displayName = 'MoneyInput'
