'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

/**
 * What a clinic sees when a screen throws.
 *
 * There was no error boundary anywhere in this application, so any render error
 * — a field the API stopped sending, a null nobody expected — surfaced as
 * Next.js's own crash page: a stack trace in development, and in production a
 * bare "Application error: a client-side exception has occurred". Neither tells
 * a receptionist anything, and neither offers a way back.
 *
 * Deliberately says what to do rather than what went wrong. The digest is shown
 * because it is the one thing that makes a support call actionable — it is the
 * same identifier the server log carries — but the message is not, because a
 * stack trace on a clinic's screen tells them nothing and tells anybody looking
 * over their shoulder rather more than it should.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Until there is error monitoring (ROADMAP §3), the server log is where
    // this goes, and somebody has to go and read it.
    console.error('Unhandled error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
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
