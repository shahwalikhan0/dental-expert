'use client'

import { useSession } from 'next-auth/react'
import { holderCan, type Permission } from '@/lib/rbac'

/**
 * Does the signed-in person hold this capability?
 *
 * For hiding what the server would refuse — a button whose request can only
 * come back 403 is a form filled in for nothing. The server stays the
 * authority; this only keeps the screen from offering what it will not do.
 *
 * `null` while the session is still loading, so a screen can wait rather than
 * flash an action on and then off, or fire a request it then has to discard.
 */
export function useCan(permission: Permission): boolean | null {
  const { data: session, status } = useSession()
  if (status === 'loading') return null
  return holderCan(
    session?.user ? { role: session.user.role, clinicalRole: session.user.clinicalRole } : null,
    permission
  )
}
