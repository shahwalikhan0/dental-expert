'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Fetching one of the portal's read endpoints.
 *
 * Every page here does the same three things, so they are done once: load,
 * distinguish "nothing yet" from "could not load", and send somebody back to
 * the sign-in page when their session has run out rather than showing an empty
 * record — which is the wrong answer to "where are my treatments?" and an
 * alarming one.
 */
export function usePortalData<T>(path: string): {
  data: T | null
  loading: boolean
  failed: boolean
  reload: () => void
} {
  const router = useRouter()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let current = true

    fetch(path)
      .then(async (res) => {
        // Four hours is the session, and somebody reading their record will
        // outlast it. The gate on the server has already refused; this is the
        // browser catching up rather than rendering a blank page.
        if (res.status === 401) {
          router.push('/portal/login')
          return null
        }
        const result = await res.json()
        if (!res.ok || !result.success) throw new Error(result.error || 'Failed')
        return result.data as T
      })
      .then((value) => {
        if (!current || value === null) return
        setData(value)
      })
      .catch(() => {
        if (current) setFailed(true)
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => {
      current = false
    }
  }, [path, nonce, router])

  /**
   * Put the hook back into its loading state and fetch again.
   *
   * The two `setState` calls are here rather than at the top of the effect on
   * purpose: an effect that sets state as its first act causes a second render
   * before it has done anything, and eslint is right to say so. Everything that
   * needs resetting is reset by whoever asks for the reload, and the initial
   * state already says "loading". This assumes `path` is constant for the life
   * of the component, which it is — one endpoint per page.
   */
  const reload = useCallback(() => {
    setLoading(true)
    setFailed(false)
    setNonce((n) => n + 1)
  }, [])

  return { data, loading, failed, reload }
}

/**
 * What the page shows while it is loading, and when it could not load.
 *
 * "Could not load" is kept distinct from "you have none", because showing an
 * empty state for a failed request tells a patient their clinic has no record
 * of treating them.
 */
export function PortalState({
  loading,
  failed,
  reload,
}: {
  loading: boolean
  failed: boolean
  reload: () => void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-12 text-center">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        <div>
          <p className="font-medium">This could not be loaded</p>
          <p className="text-sm text-muted-foreground">
            Something went wrong at the clinic&rsquo;s end, not yours.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    )
  }

  return null
}

/** Nothing to show, and that is the honest answer rather than a failure. */
export function PortalEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}
