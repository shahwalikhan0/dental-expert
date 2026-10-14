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
import { SegmentedControl } from '@/components/ui/segmented-control'
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
  // The generic control (components/ui/segmented-control.tsx) was promoted
  // from this one; this is now that, with the dentitions and their counts.
  return (
    <SegmentedControl<Dentition>
      aria-label="Dentition"
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={className}
      options={DENTITIONS.map((option) => {
        const count = selectedCounts?.[option.value] ?? 0
        return {
          ...option,
          badge: count > 0 ? count : undefined,
          'aria-label': count > 0 ? `${option.label}, ${count} selected` : undefined,
        }
      })}
    />
  )
}
