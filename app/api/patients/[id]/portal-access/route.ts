/**
 * The desk giving, withdrawing or reissuing a patient's portal sign-in.
 *
 * Credentials are issued by the clinic and never self-registered, which is what
 * makes the portal's identity question answerable at all: a person at the desk
 * decides which record this account opens. See the note on the
 * `PatientPortalAccount` model.
 *
 * The password is generated on the server, returned exactly once in the
 * response to whoever pressed the button, and never stored in the clear. It is
 * not written to the audit log either — the trail records that access was given
 * and by whom, which is the part somebody may have to answer for.
 */
import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { generateTemporaryPassword, hashPortalPassword } from '@/lib/portal/accounts'

/**
 * `patients:write`, the same capability that registers the patient and edits
 * their contact details. Handing over a credential is front-desk work, and a
 * clinic where only an administrator can do it is a clinic where it does not
 * happen.
 */
const PERMISSION = 'patients:write' as const

async function loadPatient(id: string, hospitalId: string) {
  return prisma.patient.findFirst({
    where: { id, hospitalId },
    select: { id: true, patientId: true, isActive: true, mergedIntoId: true },
  })
}

/** GET — does this patient have portal access, and what state is it in? */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission(PERMISSION)
  if (error || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const patient = await loadPatient(id, hospitalId)
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const [account, hospital] = await Promise.all([
    prisma.patientPortalAccount.findUnique({
      where: { patientId: id },
      select: {
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        lockedUntil: true,
        createdAt: true,
      },
    }),
    // The sign-in address is `/portal/login?clinic=<slug>`, so the desk needs
    // the slug to read it out along with the password.
    prisma.hospital.findUnique({ where: { id: hospitalId }, select: { slug: true } }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      patientNumber: patient.patientId,
      clinicSlug: hospital?.slug ?? null,
      eligible: patient.isActive && !patient.mergedIntoId,
      account: account
        ? {
            isActive: account.isActive,
            mustChangePassword: account.mustChangePassword,
            lastLoginAt: account.lastLoginAt,
            locked: account.lockedUntil !== null && account.lockedUntil > new Date(),
            createdAt: account.createdAt,
          }
        : null,
    },
  })
}

/**
 * POST — issue access, or reissue the password for access that already exists.
 *
 * One verb for both because they are one action at the desk: "give them a
 * password". Reissuing also clears any lockout, which is the other half of the
 * same conversation — somebody who has locked themselves out is telephoning to
 * ask for exactly this.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission(PERMISSION)
  if (error || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const patient = await loadPatient(id, hospitalId)
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  if (!patient.isActive || patient.mergedIntoId) {
    return NextResponse.json(
      { error: 'This record is not active, so it cannot be given portal access.' },
      { status: 400 }
    )
  }

  const password = generateTemporaryPassword()
  const passwordHash = await hashPortalPassword(password)

  const existing = await prisma.patientPortalAccount.findUnique({
    where: { patientId: id },
    select: { id: true },
  })

  await prisma.patientPortalAccount.upsert({
    where: { patientId: id },
    create: { hospitalId, patientId: id, passwordHash },
    update: {
      passwordHash,
      // Reissuing restores access as well as resetting the password. A desk
      // that has decided to hand over a new password has decided the patient
      // should be able to sign in.
      isActive: true,
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
    },
  })

  void recordAudit({
    hospitalId,
    userId: user?.id,
    action: existing ? AUDIT_ACTIONS.PORTAL_PASSWORD_REISSUED : AUDIT_ACTIONS.PORTAL_ACCESS_GRANTED,
    entityType: 'Patient',
    entityId: id,
    ...requestContext(req.headers),
  })

  return NextResponse.json({
    success: true,
    data: {
      patientNumber: patient.patientId,
      // Shown once, to the person who pressed the button. There is no way to
      // read it back, deliberately — a password a clinic can look up later is
      // one every member of staff can look up later.
      password,
    },
  })
}

/** PATCH — withdraw access, or restore it without changing the password. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission(PERMISSION)
  if (error || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const isActive = body?.isActive

  if (typeof isActive !== 'boolean') {
    return NextResponse.json({ error: 'Say whether access is on or off.' }, { status: 400 })
  }

  const patient = await loadPatient(id, hospitalId)
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const account = await prisma.patientPortalAccount.findUnique({
    where: { patientId: id },
    select: { id: true },
  })
  if (!account)
    return NextResponse.json({ error: 'This patient has no portal access.' }, { status: 404 })

  await prisma.patientPortalAccount.update({
    where: { patientId: id },
    data: { isActive },
  })

  void recordAudit({
    hospitalId,
    userId: user?.id,
    action: isActive ? AUDIT_ACTIONS.PORTAL_ACCESS_GRANTED : AUDIT_ACTIONS.PORTAL_ACCESS_REVOKED,
    entityType: 'Patient',
    entityId: id,
    ...requestContext(req.headers),
  })

  return NextResponse.json({ success: true })
}
