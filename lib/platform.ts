/**
 * Administration *of the platform*, as opposed to administration of a clinic.
 *
 * Someone has to be able to see every tenant, move one onto a different plan,
 * suspend one that will not pay and un-suspend it when they do. None of that is
 * a clinic-side capability: an ADMIN at one clinic must never be able to touch
 * another clinic, no matter how senior they are inside their own.
 *
 * So platform access is not a Role and not a Permission. It is a flag on a user
 * (`User.isPlatformAdmin`), checked here, and checked **against the database on
 * every request** rather than trusted from the session token. The token lives
 * eight hours; if platform access is taken away from someone, waiting up to
 * eight hours for that to take effect is not an acceptable answer for the one
 * privilege that crosses every tenant boundary in the system.
 */
import { NextResponse } from 'next/server'
import { auth } from './auth'
import { prisma } from './prisma'

export interface PlatformActor {
  id: string
  email: string
  name: string
  /** The clinic the actor's own account belongs to — for the audit trail. */
  hospitalId: string
}

export type PlatformGate =
  { error: NextResponse; actor: null } | { error: null; actor: PlatformActor }

export async function requirePlatformAdmin(): Promise<PlatformGate> {
  const session = await auth()

  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), actor: null }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      hospitalId: true,
      isActive: true,
      isPlatformAdmin: true,
    },
  })

  if (!user?.isActive || !user.isPlatformAdmin) {
    // 404 rather than 403. Telling an ordinary clinic user that a platform
    // console exists behind this URL invites them to go looking for a way in;
    // there is nothing here for them, so say nothing is here.
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }), actor: null }
  }

  return {
    error: null,
    actor: { id: user.id, email: user.email, name: user.name, hospitalId: user.hospitalId },
  }
}

/** Audit actions for things done to a tenant from the platform side. */
export const PLATFORM_AUDIT_ACTIONS = {
  TENANT_PLAN_CHANGED: 'platform.tenant.plan_changed',
  TENANT_STATUS_CHANGED: 'platform.tenant.status_changed',
  TENANT_SUSPENDED: 'platform.tenant.suspended',
  TENANT_REINSTATED: 'platform.tenant.reinstated',
  TENANT_LIMITS_OVERRIDDEN: 'platform.tenant.limits_overridden',
} as const
