import { randomInt } from 'crypto'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { jwtVerify } from 'jose'
import { auth } from './auth'
import { prisma } from './prisma'
import { holderCan, isReadOnlyPermission, type Permission } from './rbac'
import { AUDIT_ACTIONS, recordAudit } from './audit'
import { accountStanding } from './account-standing'
import {
  checkPatientEntitlement,
  checkStaffEntitlement,
  getTenant,
  type LimitCheck,
} from './tenant'
import { UPLOADS_DISABLED_MESSAGE, uploadsEnabled } from './storage/enabled'

/**
 * Verify a mobile Bearer token (JWT signed with NEXTAUTH_SECRET via jose).
 * Returns the decoded user payload or null.
 */
async function verifyMobileToken(): Promise<any | null> {
  try {
    const headersList = await headers()
    const authHeader = headersList.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return null

    const token = authHeader.slice(7)
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!)
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      staffId: payload.staffId,
      hospitalId: payload.hospitalId,
      isHospitalAdmin: payload.isHospitalAdmin,
    }
  } catch {
    return null
  }
}

/** 401 rather than 403: the session is the problem, so signing in again fixes it. */
function staleSession() {
  return NextResponse.json(
    {
      error:
        'Your session has ended: the account or its clinic is no longer active. Please sign in again.',
      code: 'STALE_SESSION',
    },
    { status: 401 }
  )
}

/**
 * Get authenticated user's hospital context for API routes.
 * Supports both NextAuth session cookies (web) and Bearer tokens (mobile).
 */
export async function getAuthenticatedHospital() {
  // Try NextAuth session first (web)
  const session = await auth()

  // A session whose account has been deactivated or removed, or whose clinic
  // has gone, comes back from `auth()` as no session at all, and the role on it
  // is the account's role now rather than at sign-in: the token is re-read
  // against the database on every call (lib/account-standing.ts). That read
  // also covers what `clinicStillExists` used to check here, since an account
  // cannot outlive its clinic.
  if (session?.user) {
    return {
      error: null,
      user: session.user,
      hospitalId: session.user.hospitalId,
    }
  }

  // Fallback: try mobile Bearer token
  // A mobile token is checked the same way: it says who signed in, and the
  // account says what they may do now.
  const mobileUser = await verifyMobileToken()
  if (mobileUser) {
    const standing = await accountStanding(mobileUser.id, mobileUser.hospitalId)
    if (!standing) {
      return { error: staleSession(), user: null, hospitalId: null }
    }

    return {
      error: null,
      user: { ...mobileUser, ...standing },
      hospitalId: mobileUser.hospitalId,
    }
  }

  return {
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    user: null,
    hospitalId: null,
  }
}

/**
 * Check if the user has one of the required roles.
 * Returns a 403 response if not authorized.
 */
export function requireRole(userRole: string, allowedRoles: string[]) {
  if (!allowedRoles.includes(userRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

/**
 * Authenticate, then require a capability from lib/rbac.ts.
 *
 * This is the check every API route should use. Prefer it over
 * `requireAuthAndRole([...])`: a route that names a capability keeps working
 * when a role is added, whereas a hand-written role array silently excludes
 * the new role and has to be found and edited.
 *
 * Returns the same shape as `requireAuthAndRole`, so converting a route is a
 * one-line change:
 *
 *   const { error, hospitalId } = await requirePermission('clinical:write')
 *   if (error) return error
 */
export async function requirePermission(permission: Permission) {
  const { error, user, hospitalId } = await getAuthenticatedHospital()

  if (error || !user || !hospitalId) {
    return {
      error: error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
      hospitalId: null,
      session: null,
    }
  }

  if (!holderCan(user, permission)) {
    // Recorded, not just refused. The permission asked for is the useful part:
    // one receptionist opening the reports screen by accident looks nothing
    // like a series of refusals across billing and staff administration, and
    // only the log can tell those two apart afterwards.
    void recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      entityType: 'Permission',
      entityId: permission,
      newValues: { permission, role: user.role },
    })

    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      hospitalId: null,
      session: null,
    }
  }

  const blocked = await tenantWriteBlock(hospitalId, [permission])
  if (blocked) return { error: blocked, user: null, hospitalId: null, session: null }

  return { error: null, user, hospitalId, session: { user } }
}

/**
 * Whether the tenant's subscription stands in the way, as a response or null.
 *
 * Runs after the role check, not before: a receptionist who was never allowed
 * to approve a refund should be told they are not allowed, not that their
 * clinic owes us money.
 *
 * This is one indexed lookup on every write request. It is deliberately not
 * carried in the session token — a token lives eight hours, and a suspension
 * that takes eight hours to bite is not a suspension.
 */
async function tenantWriteBlock(
  hospitalId: string,
  permissions: readonly (Permission | string)[]
): Promise<NextResponse | null> {
  if (permissions.every(isReadOnlyPermission)) return null

  const tenant = await getTenant(hospitalId)
  // A missing tenant used to read as writable. It cannot be: the clinic is
  // gone, and every write would fail on a foreign key with an error nobody
  // could act on. `getAuthenticatedHospital` catches this first now; this is
  // the belt to that pair of braces.
  if (!tenant) return staleSession()
  if (tenant.writable) return null

  return NextResponse.json(
    {
      error: tenant.isActive
        ? 'This clinic’s subscription is not active. Your records are still here and can be read and exported; adding or changing them needs an active subscription.'
        : 'This clinic’s account has been suspended.',
      code: 'SUBSCRIPTION_INACTIVE',
      status: tenant.status,
    },
    { status: 402 }
  )
}

/**
 * Require *every* listed capability. For handlers that do two things at once —
 * creating an invoice from completed treatments needs both `billing:write` and
 * `clinical:read`.
 */
export async function requireAllPermissions(permissions: Permission[]) {
  const { error, user, hospitalId } = await getAuthenticatedHospital()

  if (error || !user || !hospitalId) {
    return {
      error: error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
      hospitalId: null,
      session: null,
    }
  }

  if (!permissions.every((p) => holderCan(user, p))) {
    const missing = permissions.filter((p) => !holderCan(user, p))
    void recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      entityType: 'Permission',
      entityId: missing.join(','),
      newValues: { permission: missing.join(','), role: user.role },
    })

    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      hospitalId: null,
      session: null,
    }
  }

  const blocked = await tenantWriteBlock(hospitalId, permissions)
  if (blocked) return { error: blocked, user: null, hospitalId: null, session: null }

  return { error: null, user, hospitalId, session: { user } }
}

/**
 * Combined auth check: verifies authentication and role access.
 *
 * @deprecated Prefer `requirePermission`. Naming roles at the call site is what
 * let 66 route files end up with no check at all and made adding a role a
 * 155-file audit. Kept because a handful of routes gate on identity rather
 * than capability.
 */
export async function requireAuthAndRole(allowedRoles?: string[]) {
  const { error, user, hospitalId } = await getAuthenticatedHospital()

  if (error || !user || !hospitalId) {
    return {
      error: error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
      hospitalId: null,
      session: null,
    }
  }

  if (allowedRoles) {
    const roleError = requireRole(user.role, allowedRoles)
    if (roleError) {
      return { error: roleError, user: null, hospitalId: null, session: null }
    }
  }

  return { error: null, user, hospitalId, session: { user } }
}

/**
 * Plan allowances.
 *
 * The numbers themselves are in lib/plans.ts and the per-tenant state is in
 * lib/tenant.ts; these two wrappers exist so that the twenty-odd call sites
 * that only want to know "does one more fit" did not all have to change when
 * the answer stopped being a column on the clinic's own row.
 */
export async function checkPatientLimit(hospitalId: string): Promise<LimitCheck> {
  return checkPatientEntitlement(hospitalId)
}

export async function checkStaffLimit(hospitalId: string): Promise<LimitCheck> {
  return checkStaffEntitlement(hospitalId)
}

export { getTenant } from './tenant'

/**
 * Generate a unique slug from hospital name
 */
export async function generateUniqueSlug(name: string): Promise<string> {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  let slug = baseSlug
  let counter = 1

  while (await prisma.hospital.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${counter}`
    counter++
  }

  return slug
}

/**
 * A random token for email verification, password reset or a staff invite.
 *
 * `crypto.randomInt`, not `Math.random`. These tokens are the only thing
 * standing between a link in an inbox and an account, and `Math.random` is a
 * predictable PRNG seeded from the process — observing a handful of issued
 * tokens narrows the next one to a guessable range. The previous
 * implementation used it, and the tokens it produced gated email verification
 * and invite acceptance.
 *
 * `randomInt` rather than taking bytes modulo 62: 256 does not divide by 62, so
 * the first eight letters of the alphabet would come up a little more often
 * than the rest, and "a little" compounds over every character of the token.
 */
export function generateToken(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < length; i++) {
    token += chars.charAt(randomInt(chars.length))
  }
  return token
}

/**
 * Refuse a route that writes a file when this deployment takes no uploads.
 *
 * Returns a response to send, or null to carry on. 503 rather than 404 or
 * 403: the endpoint exists and the caller is allowed to use it, the server
 * just will not do it here — which is what `Service Unavailable` means, and
 * what tells a mobile client to show the feature as off rather than broken.
 *
 * See lib/storage/enabled.ts for why a deployment would turn them off.
 */
export function requireUploads(): NextResponse | null {
  if (uploadsEnabled()) return null
  return NextResponse.json({ error: UPLOADS_DISABLED_MESSAGE }, { status: 503 })
}
