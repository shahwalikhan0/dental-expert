/**
 * POST /api/portal/auth/password — the patient chooses their own password.
 *
 * The one write in the whole portal, and it has to exist. The desk issues a
 * temporary password and has therefore seen it; if the patient could not
 * replace it, the clinic would hold a working credential to every patient's
 * record indefinitely, which is not a portal, it is a shared account.
 *
 * The same 8-to-32-character rule applies as everywhere else
 * (lib/password-policy.ts).
 */
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { validatePassword } from '@/lib/password-policy'
import { requirePortalPatient } from '@/lib/portal/auth'
import { hashPortalPassword } from '@/lib/portal/accounts'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
})

export async function POST(request: Request) {
  const { error, caller } = await requirePortalPatient()
  if (error) return error

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please fill in both passwords.' }, { status: 400 })
  }

  const { currentPassword, newPassword } = parsed.data

  const account = await prisma.patientPortalAccount.findUnique({
    where: { id: caller.session.accountId },
    select: { passwordHash: true },
  })
  if (!account) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })

  if (!(await bcrypt.compare(currentPassword, account.passwordHash))) {
    return NextResponse.json({ error: 'That is not your current password.' }, { status: 400 })
  }

  const refusal = validatePassword(newPassword)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

  await prisma.patientPortalAccount.update({
    where: { id: caller.session.accountId },
    data: {
      passwordHash: await hashPortalPassword(newPassword),
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: null,
    },
  })

  void recordAudit({
    hospitalId: caller.patient.hospitalId,
    action: AUDIT_ACTIONS.PORTAL_PASSWORD_CHANGED,
    entityType: 'Patient',
    entityId: caller.patient.id,
    ...requestContext(request.headers),
  })

  return NextResponse.json({ success: true })
}
