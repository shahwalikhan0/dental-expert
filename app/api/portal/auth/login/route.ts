/**
 * POST /api/portal/auth/login — a patient signing in to read their own record.
 *
 * Three fields: the clinic's slug, the clinic's own patient number, and the
 * password the desk issued. Not NextAuth: see the note at the top of
 * lib/portal/session.ts for why the two sessions are kept entirely apart.
 *
 * Every refusal is the same sentence. "No such patient number", "no portal
 * account", "access withdrawn" and "wrong password" are four different facts
 * about a person, and an endpoint anybody can reach should not be a way to
 * learn any of them.
 */
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { issuePortalSession } from '@/lib/portal/session'
import { clearPortalFailures, portalLockout, recordPortalFailure } from '@/lib/portal/accounts'
import { minutesRemaining } from '@/lib/lockout'

const schema = z.object({
  clinic: z.string().min(1),
  patientId: z.string().min(1),
  password: z.string().min(1),
})

/**
 * A hash to compare against when there is no account.
 *
 * Without it, a request naming a patient number that has no portal account
 * returns before bcrypt runs and a request naming one that does returns after
 * — a difference of ~100ms, which is a reliable way to enumerate which of a
 * clinic's patients have portal access. This is the bcrypt of a string nobody
 * holds.
 */
const DUMMY_HASH = '$2b$12$bwhckmrJeG2X13M5T2r.9ecLVhOHcHyXl/rKlo04Cfpz89biuc88a'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)

  const refuse = () =>
    NextResponse.json({ error: 'That patient number and password do not match.' }, { status: 401 })

  if (!parsed.success) return refuse()

  const { clinic, patientId, password } = parsed.data
  const context = requestContext(request.headers)

  const hospital = await prisma.hospital.findUnique({
    where: { slug: clinic },
    select: { id: true, isActive: true },
  })
  if (!hospital || !hospital.isActive) return refuse()

  const account = await prisma.patientPortalAccount.findFirst({
    where: {
      hospitalId: hospital.id,
      isActive: true,
      patient: {
        patientId: patientId.trim(),
        hospitalId: hospital.id,
        isActive: true,
        mergedIntoId: null,
      },
    },
    select: {
      id: true,
      passwordHash: true,
      mustChangePassword: true,
      failedAttempts: true,
      lockedUntil: true,
      patient: { select: { id: true } },
    },
  })

  if (!account) {
    // Spend the same time as a real check. See DUMMY_HASH.
    await bcrypt.compare(password, DUMMY_HASH)
    void recordAudit({
      hospitalId: hospital.id,
      action: AUDIT_ACTIONS.PORTAL_LOGIN_FAILED,
      entityType: 'PatientPortalAccount',
      entityId: patientId.trim(),
      ...context,
    })
    return refuse()
  }

  const lockout = portalLockout(account)
  if (lockout.locked) {
    void recordAudit({
      hospitalId: hospital.id,
      action: AUDIT_ACTIONS.PORTAL_LOGIN_FAILED,
      entityType: 'PatientPortalAccount',
      entityId: account.id,
      ...context,
    })
    // The one thing worth saying plainly: somebody locked out needs to know to
    // wait rather than keep trying, and it tells an attacker only that they
    // have been stopped.
    return NextResponse.json(
      {
        error: `Too many attempts. Please try again in ${minutesRemaining(lockout.until!)} minutes, or telephone the clinic.`,
      },
      { status: 429 }
    )
  }

  const correct = await bcrypt.compare(password, account.passwordHash)

  if (!correct) {
    await recordPortalFailure(prisma, { accountId: account.id, hospitalId: hospital.id })
    void recordAudit({
      hospitalId: hospital.id,
      action: AUDIT_ACTIONS.PORTAL_LOGIN_FAILED,
      entityType: 'PatientPortalAccount',
      entityId: account.id,
      ...context,
    })
    return refuse()
  }

  await clearPortalFailures(prisma, account.id)
  await prisma.patientPortalAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() },
  })

  await issuePortalSession({
    accountId: account.id,
    patientId: account.patient.id,
    hospitalId: hospital.id,
  })

  // No `userId`: nobody at the clinic did this. Same reasoning as the public
  // booking route.
  void recordAudit({
    hospitalId: hospital.id,
    action: AUDIT_ACTIONS.PORTAL_LOGIN_SUCCESS,
    entityType: 'Patient',
    entityId: account.patient.id,
    ...context,
  })

  return NextResponse.json({
    success: true,
    mustChangePassword: account.mustChangePassword,
  })
}
