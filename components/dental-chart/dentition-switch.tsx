'use client'

/**
 * Permanent or primary: which set of teeth a mouth is drawn as.
 *
 * Lifted out of the patient's dental chart so the tooth picker on the
 * treatment and prescription forms switches the same way, in the same place,
 * under the same words (bug report 12 Oct, finding 55). Until then the chart
 * could draw a child's 51–85 and the picker could not, so tooth 75 could be
 * charted and then not chosen for the treatment that followed.
 *
 * A radio group, keyboard and all: one tab stop, the arrow keys move between
 * the two and select as they go, the way a native radio group does. The
 * buttons alone were two tab stops announced as radios that the arrow keys did
 * not move.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import type { Dentition } from '@/lib/teeth'

export const DENTITIONS: { value: Dentition; label: string }[] = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'primary', label: 'Primary' },
]

export interface DentitionSwitchProps {
  value: Dentition
  onChange: (dentition: Dentition) => void
  /**
   * Selected teeth in each dentition. Shown as a count on the option, so a
   * tooth chosen on the other view is visibly still chosen. Omit on a screen
   * that does not select.
   */
  selectedCounts?: Partial<Record<Dentition, number>>
  disabled?: boolean
  className?: string
}

export function DentitionSwitch({
  value,
  onChange,
  selectedCounts,
  disabled,
  className,
}: DentitionSwitchProps) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = DENTITIONS.length - 1
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = index === 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return

    event.preventDefault()
    onChange(DENTITIONS[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Dentition"
      className={cn('flex w-fit gap-1 rounded-lg bg-foreground/[0.05] p-0.5', className)}
    >
      {DENTITIONS.map((option, index) => {
        const checked = value === option.value
        const count = selectedCounts?.[option.value] ?? 0
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={count > 0 ? `${option.label}, ${count} selected` : undefined}
            // Roving tab stop: only the checked option is reached by Tab.
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-60',
              checked
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
            {count > 0 && (
              <span
                aria-hidden
                className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold tabular-nums text-primary"
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
