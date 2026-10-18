'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useToast } from '@/hooks/use-toast'
import { roleLabel } from '@/lib/rbac'
import { SESSION_ENDED_PATH } from '@/lib/session-ended'

/**
 * Keeps an open screen in step with the account behind it.
 *
 * The session is re-read from the database on the server (lib/account-standing
 * .ts), and the browser asks for it every minute and whenever the tab regains
 * focus (components/providers.tsx). When the answer changes, this acts on it:
 *
 * - **A different role.** The page is refreshed, so the menu, the colour and
 *   the buttons are the new role's, and the person is told why the screen
 *   changed.
 * - **No session.** The account was deactivated, or its clinic suspended. The
 *   person is signed out and told so, rather than left on a screen whose every
 *   request now fails.
 *
 * Renders nothing.
 */
export function SessionWatch({
  role,
  clinicalRole,
}: {
  role: string
  clinicalRole?: string | null
}) {
  const { data, status } = useSession()
  const router = useRouter()
  const { toast } = useToast()
  const ending = useRef(false)

  useEffect(() => {
    if (status !== 'unauthenticated' || ending.current) return
    // `useSession` reports a failed request as signed out too. Ask once more,
    // so a dropped connection does not throw away the page somebody is on.
    let current = true
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((session) => {
        if (!current || session === undefined || session?.user) return
        ending.current = true
        window.location.assign(SESSION_ENDED_PATH)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [status])

  const liveRole = data?.user?.role
  const liveClinicalRole = data?.user?.clinicalRole ?? null

  useEffect(() => {
    if (!liveRole) return
    if (liveRole === role && liveClinicalRole === (clinicalRole ?? null)) return
    toast({
      title: 'Your access has changed',
      description: `An administrator changed your role. You are now signed in as ${roleLabel(liveRole)}.`,
    })
    router.refresh()
  }, [liveRole, liveClinicalRole, role, clinicalRole, router, toast])

  return null
}
