'use client'

/**
 * Two to five mutually exclusive choices, drawn as a pill: a view (Day / Week
 * / List), a mode (Registered / Walk-in), a dentition (Permanent / Primary).
 *
 * Promoted from the dental chart's `DentitionSwitch`, which was the one
 * version of this that worked from the keyboard. The others were rows of
 * Buttons swapping `default`/`outline` (the appointments view toggle),
 * `default`/`ghost` in a bordered box (the new-appointment patient mode) and
 * `aria-pressed` buttons (attendance) — each a separate tab stop per option,
 * none answering the arrow keys.
 *
 * A radio group: one tab stop, the arrow keys move between options and select
 * as they go, Home and End jump to the ends — the way a native radio group
 * behaves. For page sections with their own content, use `Tabs`; this is for
 * a setting that changes how one thing is shown.
 *
 *   <SegmentedControl
 *     aria-label="View"
 *     value={view}
 *     onChange={setView}
 *     options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]}
 *   />
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<V extends string> {
  value: V
  label: React.ReactNode
  /** A small count or marker after the label — "3 selected". */
  badge?: React.ReactNode
  /** The option's accessible name when the label alone is not enough. */
  'aria-label'?: string
  icon?: React.ComponentType<{ className?: string }>
  disabled?: boolean
}

export interface SegmentedControlProps<V extends string> {
  options: readonly SegmentedOption<V>[]
  value: V
  onChange: (value: V) => void
  /** Required: what is being chosen — "View", "Dentition". */
  'aria-label': string
  /** `sm` (the default) for inside a card or a toolbar; `md` for a page-level switch. */
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  size = 'sm',
  disabled,
  className,
}: SegmentedControlProps<V>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = options.map((option, i) => (option.disabled ? -1 : i)).filter((i) => i >= 0)
    const at = enabled.indexOf(index)
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = enabled[(at + 1) % enabled.length]
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = enabled[(at - 1 + enabled.length) % enabled.length]
    else if (event.key === 'Home') next = enabled[0]
    else if (event.key === 'End') next = enabled[enabled.length - 1]
    if (next === null || next === undefined) return

    event.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  // If nothing is checked (a value not among the options), the first option
  // takes the tab stop so the group can still be reached.
  const checkedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('flex w-fit gap-1 rounded-lg bg-foreground/[0.05] p-0.5', className)}
    >
      {options.map((option, index) => {
        const checked = value === option.value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option['aria-label']}
            // Roving tab stop: only the checked option is reached by Tab.
            tabIndex={index === checkedIndex ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-60',
              checked
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {option.label}
            {option.badge != null && option.badge !== false && (
              <span
                aria-hidden
                className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold tabular-nums text-primary"
              >
                {option.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
