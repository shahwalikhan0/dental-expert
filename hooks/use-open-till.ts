'use client'

import { useCallback, useEffect, useState } from 'react'

/** The open till as the cashier-sessions list returns it. */
export interface OpenTill {
  id: string
  sessionNo: string
  openingFloat: string | number
  openedAt: string
  openedBy: { id: string; name: string } | null
}

async function fetchOpenTill(): Promise<{ till: OpenTill | null; known: boolean }> {
  try {
    const res = await fetch('/api/cashier-sessions?status=OPEN&limit=1', { cache: 'no-store' })
    if (!res.ok) return { till: null, known: false }
    const body = await res.json()
    return { till: (body?.data?.[0] as OpenTill | undefined) ?? null, known: true }
  } catch {
    return { till: null, known: false }
  }
}

/**
 * Is a till open, and which?
 *
 * For the screens that take money, so they can say "open the till first"
 * before somebody fills in a payment the server will refuse (finding 38).
 *
 * `known` stays false until the answer is in, and also when the question could
 * not be asked. A screen should then let the person carry on and leave it to
 * the server, whose 409 is the authority — a failed status check must not stop
 * the desk taking money while a till is in fact open.
 */
export function useOpenTill(enabled = true) {
  const [till, setTill] = useState<OpenTill | null>(null)
  const [known, setKnown] = useState(false)

  useEffect(() => {
    if (!enabled) return
    // Asked on mount, and again whenever the caller re-enables it (each time a
    // payment dialog opens): a till may have been opened or closed at the
    // front desk since this screen loaded.
    let current = true
    fetchOpenTill().then((result) => {
      if (!current) return
      setTill(result.till)
      setKnown(result.known)
    })
    return () => {
      current = false
    }
  }, [enabled])

  /** The server said there is no till open; believe it until the next check. */
  const markNoTill = useCallback(() => {
    setTill(null)
    setKnown(true)
  }, [])

  return { till, known, noTill: known && !till, markNoTill }
}
