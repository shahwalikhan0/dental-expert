import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { jwtVerify } from 'jose'
import { auth } from './auth'
import { prisma } from './prisma'
import { holderCan, type Permission } from './rbac'

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

/**
 * Get authenticated user's hospital context for API routes.
 * Supports both NextAuth session cookies (web) and Bearer tokens (mobile).
 */
export async function getAuthenticatedHospital() {
  // Try NextAuth session first (web)
  const session = await auth()

  if (session?.user) {
    return {
      error: null,
      user: session.user,
      hospitalId: session.user.hospitalId,
    }
  }

  // Fallback: try mobile Bearer token
  const mobileUser = await verifyMobileToken()
  if (mobileUser) {
    return {
      error: null,
      user: mobileUser,
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
    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      hospitalId: null,
      session: null,
    }
  }

  return { error: null, user, hospitalId, session: { user } }
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
    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      hospitalId: null,
      session: null,
    }
  }

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
 * Plan limits configuration
 */
export const PLAN_LIMITS = {
  FREE: {
    patientLimit: 100,
    staffLimit: 3,
    storageLimitMb: 500,
  },
  PROFESSIONAL: {
    patientLimit: -1, // Unlimited
    staffLimit: -1,
    storageLimitMb: -1,
  },
  ENTERPRISE: {
    patientLimit: -1,
    staffLimit: -1,
    storageLimitMb: -1,
  },
  SELF_HOSTED: {
    patientLimit: -1,
    staffLimit: -1,
    storageLimitMb: -1,
  },
}

/**
 * Get hospital with plan limits
 */
export async function getHospitalWithLimits(hospitalId: string) {
  return prisma.hospital.findUnique({
    where: { id: hospitalId },
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      patientLimit: true,
      staffLimit: true,
      storageLimitMb: true,
      isActive: true,
      onboardingCompleted: true,
    },
  })
}

/**
 * Check if hospital has reached patient limit
 */
export async function checkPatientLimit(
  hospitalId: string
): Promise<{ allowed: boolean; current: number; max: number }> {
  const hospital = await getHospitalWithLimits(hospitalId)

  if (!hospital) {
    return { allowed: false, current: 0, max: 0 }
  }

  // -1 means unlimited
  if (hospital.patientLimit === -1) {
    return { allowed: true, current: 0, max: -1 }
  }

  const currentPatients = await prisma.patient.count({
    where: { hospitalId },
  })

  return {
    allowed: currentPatients < hospital.patientLimit,
    current: currentPatients,
    max: hospital.patientLimit,
  }
}

/**
 * Check if hospital has reached staff limit
 */
export async function checkStaffLimit(
  hospitalId: string
): Promise<{ allowed: boolean; current: number; max: number }> {
  const hospital = await getHospitalWithLimits(hospitalId)

  if (!hospital) {
    return { allowed: false, current: 0, max: 0 }
  }

  // -1 means unlimited
  if (hospital.staffLimit === -1) {
    return { allowed: true, current: 0, max: -1 }
  }

  const currentStaff = await prisma.user.count({
    where: { hospitalId, isActive: true },
  })

  return {
    allowed: currentStaff < hospital.staffLimit,
    current: currentStaff,
    max: hospital.staffLimit,
  }
}

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
 * Generate a random token for email verification or password reset
 */
export function generateToken(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}
