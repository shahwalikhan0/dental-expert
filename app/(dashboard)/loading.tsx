import { Skeleton } from '@/components/ui/skeleton'

/**
 * What fills a dashboard screen while it is being fetched.
 *
 * Without this, navigating to a slow screen left the previous one on display
 * with nothing to say it had been left — on a clinic's connection that reads as
 * a click that did not register, and the receptionist clicks again.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}
