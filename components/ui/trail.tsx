'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  backHref,
  backLabel,
  decodeTrail,
  hrefWithTrail,
  pushHop,
  TRAIL_PARAM,
  type Hop,
} from '@/lib/trail'

/**
 * The screen's own place in the trail, and how it hands the trail on.
 *
 * `label` is what this page should be called in somebody else's breadcrumb —
 * the record's name on a detail screen, the module's name on a list. Pass null
 * while it is still loading and the page simply does not add itself; a crumb
 * reading "undefined undefined" is worse than one hop fewer.
 */
export function useTrail(label: string | null | undefined) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const incoming = React.useMemo(() => decodeTrail(searchParams.get(TRAIL_PARAM)), [searchParams])

  return React.useMemo(() => {
    // What this page looks like as somebody else's crumb: its own path and
    // query, minus the trail it arrived with — that is rebuilt from the hops
    // before it, so it is never stored twice.
    const rest = new URLSearchParams(searchParams.toString())
    rest.delete(TRAIL_PARAM)
    const query = rest.toString()
    const self = query ? `${pathname}?${query}` : pathname

    const onward = pushHop(incoming, label ? { href: self, label } : null)

    return {
      /** The hops walked to get here. */
      hops: incoming,
      /** A link out of this page that remembers the way back. */
      to: (href: string) => hrefWithTrail(href, onward),
      /** Where the back arrow points, and what it says. */
      back: (fallback: string) => backHref(incoming, fallback),
      backLabel: (fallback: string) => backLabel(incoming, fallback),
    }
  }, [incoming, label, pathname, searchParams])
}

export type Trail = ReturnType<typeof useTrail>

export interface BackLinkProps {
  /** Where to go when the reader arrived directly — a shared link, a refresh. */
  fallback: string
  /** What to call that fallback: "Appointments", "Patients". */
  fallbackLabel: string
  trail: Trail
  className?: string
}

/**
 * The back arrow.
 *
 * Every one of these used to be a hard-coded link to its own module's list, so
 * opening a patient from the appointment book and pressing back landed you in
 * the patient list — two modules from where you were, with no way to tell what
 * had happened. It now names where it is going, which is the part that makes
 * it trustworthy.
 *
 * A real link rather than `router.back()`: the reader can middle-click it, it
 * survives a reload, and it does not walk backwards into the form they just
 * submitted.
 */
export function BackLink({ fallback, fallbackLabel, trail, className }: BackLinkProps) {
  const label = trail.backLabel(fallbackLabel)

  return (
    <Link
      href={trail.back(fallback)}
      aria-label={`Back to ${label}`}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors',
        className
      )}
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="truncate max-w-[220px]">Back to {label}</span>
    </Link>
  )
}

/**
 * The trail as a list of hops, for a page that wants to render it itself.
 * The dashboard breadcrumb uses this; nothing else needs to.
 */
export function useTrailHops(): Hop[] {
  const searchParams = useSearchParams()
  return React.useMemo(() => decodeTrail(searchParams.get(TRAIL_PARAM)), [searchParams])
}
