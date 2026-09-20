import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { nextPatientId } from '@/lib/numbering'
import { parseOptionalCNIC } from '@/lib/cnic'
import { canDecideOn, splitName } from '@/lib/visitors'
import { startDefaultRecare } from '@/lib/recare'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

/**
 * POST — this walk-in is worth keeping. Make them a patient.
 *
 * Everything the visitor already has follows them: every appointment is
 * repointed at the new patient record in the same transaction, so the visit
 * history survives the conversion rather than being a set of appointments
 * belonging to a name that no longer means anything.
 *
 * Needs `patients:write`, which is the same capability as registering anyone
 * else — because that is what this is.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('patients:write')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const visitor = await prisma.visitor.findFirst({
      where: { id, hospitalId },
      select: {
        id: true,
        name: true,
        phone: true,
        notes: true,
        convertedAt: true,
        convertedPatientId: true,
        discardedAt: true,
      },
    })

    if (!visitor) {
      return NextResponse.json({ error: 'Visitor not found' }, { status: 404 })
    }

    if (!canDecideOn(visitor)) {
      return NextResponse.json(
        {
          error: visitor.convertedAt
            ? 'This visitor has already been registered'
            : 'This visitor was discarded',
          patientId: visitor.convertedPatientId,
        },
        { status: 409 }
      )
    }

    // The desk can correct the split before committing — "Muhammad Ali Khan"
    // guesses wrong often enough that the screen offers both boxes.
    const guessed = splitName(visitor.name)
    const firstName = String(body.firstName ?? guessed.firstName).trim()
    const lastName = String(body.lastName ?? guessed.lastName).trim()
    const phone = String(body.phone ?? visitor.phone ?? '').trim()

    if (!firstName || !lastName || !phone) {
      return NextResponse.json(
        { error: 'A patient record needs a first name, a last name and a phone number' },
        { status: 400 }
      )
    }

    const cnicResult = parseOptionalCNIC(body.cnic)
    if (!cnicResult.ok) {
      return NextResponse.json({ error: cnicResult.error }, { status: 400 })
    }

    // The same two uniqueness rules the ordinary registration path enforces.
    // Converting must not be a way round them.
    const clash = await prisma.patient.findFirst({
      where: {
        hospitalId,
        OR: [{ phone }, ...(cnicResult.value ? [{ cnic: cnicResult.value }] : [])],
      },
      select: { id: true, patientId: true, firstName: true, lastName: true, phone: true },
    })

    if (clash) {
      return NextResponse.json(
        {
          error:
            clash.phone === phone
              ? `That phone number already belongs to ${clash.firstName} ${clash.lastName} (${clash.patientId})`
              : `That CNIC already belongs to ${clash.firstName} ${clash.lastName} (${clash.patientId})`,
          existingPatient: clash,
        },
        { status: 409 }
      )
    }

    const patientId = await nextPatientId(prisma, hospitalId)
    const now = new Date()

    const patient = await prisma.$transaction(async (tx) => {
      const created = await tx.patient.create({
        data: {
          hospitalId,
          patientId,
          firstName,
          lastName,
          phone,
          email: body.email ? String(body.email).trim() : null,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          gender: body.gender || null,
          cnic: cnicResult.value,
          address: body.address ? String(body.address).trim() : null,
          city: body.city ? String(body.city).trim() : null,
        },
      })

      // The visits come too. Without this the conversion would leave a patient
      // with no history beside a visitor with all of it.
      await tx.appointment.updateMany({
        where: { visitorId: visitor.id, hospitalId },
        data: { patientId: created.id, visitorId: null },
      })

      await tx.visitor.update({
        where: { id: visitor.id },
        data: {
          convertedPatientId: created.id,
          convertedAt: now,
          convertedById: user.id,
        },
      })

      await startDefaultRecare(tx, hospitalId, created.id, now)

      return created
    })

    await recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.VISITOR_CONVERTED,
      entityType: 'Visitor',
      entityId: visitor.id,
      oldValues: { name: visitor.name, phone: visitor.phone },
      newValues: { patientId: patient.id, patientNo: patient.patientId },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ success: true, patient }, { status: 201 })
  } catch (err) {
    console.error('Error converting visitor:', err)
    return NextResponse.json({ error: 'Failed to register this visitor' }, { status: 500 })
  }
}
