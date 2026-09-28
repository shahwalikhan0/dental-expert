import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { familyOf, guarantorRefusal } from '@/lib/family'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit'

/** GET /api/patients/[id]/family — everyone on this patient's account. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('patients:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const family = await familyOf(hospitalId, id)
  if (!family) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  return NextResponse.json(family)
}

/**
 * PUT /api/patients/[id]/family — set or clear who settles this patient's bills.
 *
 * `{ guarantorId: "…" }` to point the account at somebody, `{ guarantorId:
 * null }` to make the patient responsible for themselves again.
 *
 * Separate from the patient's own PUT deliberately. Changing who pays for a
 * patient is a billing act with a consequence on somebody else's statement,
 * and it should not be possible to do it by accident while correcting a
 * telephone number.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('patients:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const body = await request.json()
    const guarantorId: string | null =
      typeof body?.guarantorId === 'string' && body.guarantorId.trim()
        ? body.guarantorId.trim()
        : null

    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
      select: { id: true, guarantorId: true, firstName: true, lastName: true },
    })
    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

    if (guarantorId) {
      const refusal = await guarantorRefusal(hospitalId, id, guarantorId)
      if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })
    }

    await prisma.patient.update({ where: { id }, data: { guarantorId } })

    // A patient's bills moving to somebody else's account changes who is
    // chased for money. That belongs in the audit log.
    void recordAudit({
      hospitalId,
      userId: user?.id,
      action: AUDIT_ACTIONS.GUARANTOR_CHANGED,
      entityType: 'Patient',
      entityId: id,
      oldValues: { guarantorId: patient.guarantorId },
      newValues: { guarantorId },
    })

    const family = await familyOf(hospitalId, id)
    return NextResponse.json(family)
  } catch (cause) {
    console.error('Error setting guarantor:', cause)
    return NextResponse.json({ error: 'Failed to update the account' }, { status: 500 })
  }
}
