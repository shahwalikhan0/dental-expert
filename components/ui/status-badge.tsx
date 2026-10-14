import { Badge } from '@/components/ui/badge'
import { statusMeaning, TONE_BADGE_VARIANT, type StatusKind } from '@/lib/status'
import { cn } from '@/lib/utils'

export interface StatusBadgeProps {
  /** Which family of statuses — "invoice", "appointment", "labOrder"… */
  kind: StatusKind
  /**
   * The stored value, as the API returns it. A boolean reads as
   * active/inactive, for the `isActive` registers. Unknown values are shown
   * humanised in the neutral tone rather than hidden.
   */
  status: string | boolean | null | undefined
  /** Override the label — e.g. "Overdue · 3 days". The tone stays the status's. */
  label?: React.ReactNode
  className?: string
}

/**
 * A status, drawn the one way: tone from what it means, label in sentence case.
 *
 *   <StatusBadge kind="invoice" status={invoice.status} />
 *
 * See lib/status.ts for the table and the reasoning. No screen should build a
 * `bg-*-100 text-*-800` badge for a status by hand again; if a status is
 * missing from the table, add it there.
 */
export function StatusBadge({ kind, status, label, className }: StatusBadgeProps) {
  const meaning = statusMeaning(kind, status)
  return (
    <Badge
      variant={TONE_BADGE_VARIANT[meaning.tone]}
      className={cn('whitespace-nowrap', className)}
    >
      {label ?? meaning.label}
    </Badge>
  )
}
