import { AlertCircle } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export interface LoadFailedProps {
  /** What could not be loaded, for the title: "this invoice", "the patient". */
  what?: string
  /** Offered as "Try again". */
  onRetry?: () => void
  /** Overrides the standard description. */
  description?: string
}

/**
 * A page or a panel whose data could not be loaded.
 *
 * The same words and look as a grid's failed state (`GridBody failed`), for
 * the detail and edit screens that handled this ad hoc — a toast and an empty
 * page, a spinner left turning, or "not found" for what was really a dropped
 * connection. Failing to load is not the same as there being nothing, and the
 * screen should say which.
 *
 *   if (failed) return <LoadFailed what="this invoice" onRetry={load} />
 *
 * For a record that genuinely does not exist (a 404), use `EmptyState` with a
 * "not found" title and a way back instead.
 */
export function LoadFailed({ what = 'this', onRetry, description }: LoadFailedProps) {
  return (
    <div role="alert">
      <EmptyState
        icon={AlertCircle}
        title={`${what.charAt(0).toUpperCase()}${what.slice(1)} could not be loaded`}
        description={
          description ??
          'That is not the same as it being empty — nothing has been lost. Try again.'
        }
        actionLabel={onRetry ? 'Try again' : undefined}
        onAction={onRetry}
      />
    </div>
  )
}
