import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FileQuestion } from 'lucide-react'

/**
 * A page, patient or invoice that is not there.
 *
 * There was no `not-found.tsx` anywhere, so a mistyped URL or a stale
 * bookmark — a patient ID from a record that has since been merged or removed —
 * produced Next.js's default 404, which carries no way back into the
 * application and does not look like part of it.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <FileQuestion className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">There is nothing here</h1>
      <p className="max-w-md text-muted-foreground">
        That page does not exist, or the record it pointed at has been removed. If you followed a
        link from somewhere in the clinic, the record may have been merged into another.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/patients">Find a patient</Link>
        </Button>
      </div>
    </div>
  )
}
