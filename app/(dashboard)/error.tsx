'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

/**
 * The same as the root boundary, but inside the dashboard shell.
 *
 * Scoped here as well as at the root so that a screen that throws does not take
 * the sidebar with it: the rest of the clinic keeps working, and the person can
 * move on to another module rather than being dropped onto a bare page.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled error:', error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">This screen could not be loaded</h1>
      <p className="max-w-md text-muted-foreground">
        Nothing you had entered has been sent. Try again — if it keeps happening, the reference
        below will let us find it in the log.
      </p>

      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}

      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
