import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma, TreatmentStatus } from '@prisma/client'
import { requirePermission } from '@/lib/api-helpers'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { readTeeth } from '@/lib/teeth'
import { releasePlanItemFor } from '@/lib/treatment-plan-status'
import { BILLED_ON_LIVE_INVOICE } from '@/lib/invoice-settlement'
import { afterTreatmentCompleted } from '@/lib/treatment-completion'
import { clinicTimezone, withWallClock } from '@/lib/appointment-time'
import { can, holderCan } from '@/lib/rbac'
import {
  MIN_REASON_LENGTH,
  diffClinicalFields,
  isSigned,
  isUsableReason,
} from '@/lib/clinical-notes'

// GET - Get single treatment with all details
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const treatment = await prisma.treatment.findUnique({
      where: { id, hospitalId },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            dateOfBirth: true,
            gender: true,
            bloodGroup: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
            phone: true,
          },
        },
        procedure: {
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            description: true,
            defaultDuration: true,
            basePrice: true,
            preInstructions: true,
            postInstructions: true,
          },
        },
        appointment: {
          select: {
            id: true,
            appointmentNo: true,
            startsAt: true,
            status: true,
          },
        },
        invoiceItems: {
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNo: true,
                status: true,
                totalAmount: true,
              },
            },
          },
        },
        // The plan step this treatment carries out, when it was started from
        // one — so the page can link back to the plan.
        planItem: {
          select: {
            id: true,
            status: true,
            treatmentPlan: { select: { id: true, planNumber: true, title: true } },
          },
        },
        // FR-007: the note is not complete without who signed it and what has
        // been said or corrected since.
        signedBy: { select: { id: true, name: true } },
        amendments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true } } },
        },
      },
    })

    if (!treatment) {
      return NextResponse.json({ error: 'Treatment not found' }, { status: 404 })
    }

    const timezone = await clinicTimezone(prisma, hospitalId)

    return NextResponse.json({
      ...treatment,
      appointment: treatment.appointment
        ? withWallClock(treatment.appointment, timezone)
        : treatment.appointment,
    })
  } catch (error) {
    console.error('Error fetching treatment:', error)
    return NextResponse.json({ error: 'Failed to fetch treatment' }, { status: 500 })
  }
}

// PUT - Update treatment
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user, session } = await requirePermission('clinical:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    // Check if treatment exists
    const existingTreatment = await prisma.treatment.findUnique({
      where: { id, hospitalId },
    })

    if (!existingTreatment) {
      return NextResponse.json({ error: 'Treatment not found' }, { status: 404 })
    }

    // FR-007. A signed note is locked: what happens next depends on whether
    // this request would change the clinical record or only the billing and
    // workflow fields around it.
    //
    // Note the override here is `clinical:sign`, not `clinical:delete` as it
    // used to be. ADMIN holds `clinical:delete` and deliberately cannot sign a
    // note, so the old rule let the one role that may not author clinical
    // content rewrite signed content — with nothing recording the change. That
    // is exactly the silent overwrite spec §10 forbids.
    const signed = isSigned(existingTreatment)
    const clinicalChanges = signed ? diffClinicalFields(existingTreatment, body) : {}
    const amendsClinicalContent = Object.keys(clinicalChanges).length > 0

    if (signed && amendsClinicalContent) {
      if (!holderCan(user, 'clinical:sign')) {
        return NextResponse.json(
          {
            error: `${existingTreatment.treatmentNo} is signed. Only a clinician can amend it, and the change will be recorded.`,
            signedAt: existingTreatment.signedAt,
            fields: Object.keys(clinicalChanges),
          },
          { status: 409 }
        )
      }

      if (!isUsableReason(body.amendmentReason)) {
        return NextResponse.json(
          {
            error: `Amending a signed note needs a reason of at least ${MIN_REASON_LENGTH} characters saying what was wrong`,
            fields: Object.keys(clinicalChanges),
          },
          { status: 400 }
        )
      }
    }

    // Pre-signature, the old workflow rule still applies: a completed or
    // cancelled treatment is not casually editable.
    if (
      !signed &&
      (existingTreatment.status === 'COMPLETED' || existingTreatment.status === 'CANCELLED') &&
      !can(session.user.role, 'clinical:delete')
    ) {
      return NextResponse.json(
        { error: 'Cannot modify completed or cancelled treatments' },
        { status: 400 }
      )
    }

    const updateData: any = {}

    // Only update fields that are provided
    if (body.toothNumbers !== undefined) {
      // Checked the same way as on create (bug report 12 Oct, finding 54).
      const teeth = readTeeth(body.toothNumbers)
      if (!teeth.ok) return NextResponse.json({ error: teeth.error }, { status: 400 })
      updateData.toothNumbers = teeth.column
    }
    if (body.chiefComplaint !== undefined) updateData.chiefComplaint = body.chiefComplaint
    if (body.diagnosis !== undefined) updateData.diagnosis = body.diagnosis
    if (body.findings !== undefined) updateData.findings = body.findings
    if (body.procedureNotes !== undefined) updateData.procedureNotes = body.procedureNotes
    if (body.materialsUsed !== undefined) updateData.materialsUsed = body.materialsUsed
    if (body.complications !== undefined) updateData.complications = body.complications
    if (body.followUpRequired !== undefined) updateData.followUpRequired = body.followUpRequired
    if (body.followUpDate !== undefined)
      updateData.followUpDate = body.followUpDate ? new Date(body.followUpDate) : null
    if (body.cost !== undefined) {
      // Zero is a price; a negative one is not (finding 33).
      const cost = Number(body.cost)
      if (body.cost === null || body.cost === '' || !Number.isFinite(cost) || cost < 0) {
        return NextResponse.json(
          { error: 'The cost must be a number of zero or more' },
          { status: 400 }
        )
      }
      updateData.cost = cost
    }

    // Handle status changes
    if (body.status !== undefined) {
      if (!isEnumMember(TreatmentStatus, body.status)) {
        return enumRefusal('Status', body.status, TreatmentStatus)
      }
      updateData.status = body.status

      // Set start time when treatment begins
      if (body.status === 'IN_PROGRESS' && !existingTreatment.startTime) {
        updateData.startTime = new Date()
      }

      // Set end time when treatment completes
      if (body.status === 'COMPLETED' && !existingTreatment.endTime) {
        updateData.endTime = new Date()
      }
    }

    if (amendsClinicalContent) {
      updateData.amendedAt = new Date()
    }

    const include = {
      patient: {
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
        },
      },
      doctor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      procedure: {
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
        },
      },
      signedBy: { select: { id: true, name: true } },
    }

    // A status change moves the plan step this treatment carries out, if it
    // has one: completed completes it, cancelled hands it back to be started
    // again (bug report 12 Oct, finding 11). Only on an actual change, so a
    // save that resends the current status does nothing to the plan.
    const statusChanged = body.status !== undefined && body.status !== existingTreatment.status

    // The correction and the update go together: a note changed without the
    // record of what it used to say is the failure this whole requirement is
    // about, so neither lands without the other. The plan step goes with them.
    const treatment = await prisma.$transaction(async (tx) => {
      const updated = await tx.treatment.update({
        where: { id, hospitalId },
        data: updateData,
        include,
      })

      if (amendsClinicalContent) {
        await tx.treatmentAmendment.create({
          data: {
            hospitalId,
            treatmentId: id,
            kind: 'CORRECTION',
            body: String(body.amendmentReason).trim(),
            // Prisma's Json input type does not accept a plain index
            // signature; the shape is `{ field: { from, to } }`.
            changes: clinicalChanges as unknown as Prisma.InputJsonValue,
            authorId: user!.id,
          },
        })
      }

      if (statusChanged && body.status === 'COMPLETED') {
        // The plan step, and the recalls whose type is linked to this procedure —
        // the same as the Complete button's own route.
        await afterTreatmentCompleted(
          tx,
          { id, hospitalId, patientId: existingTreatment.patientId, procedure: updated.procedure },
          updateData.endTime ?? existingTreatment.endTime ?? new Date()
        )
      } else if (statusChanged && body.status === 'CANCELLED') {
        await releasePlanItemFor(tx, id)
      }

      return updated
    })

    return NextResponse.json(treatment)
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating treatment:', error)
    return NextResponse.json({ error: 'Failed to update treatment' }, { status: 500 })
  }
}

// DELETE - Delete treatment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, session } = await requirePermission('clinical:delete')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Check if treatment exists
    const treatment = await prisma.treatment.findUnique({
      where: { id, hospitalId },
      include: {
        // Only lines on an invoice that still stands. A cancelled invoice has
        // given its treatments back, so it does not hold this one in place.
        invoiceItems: { where: BILLED_ON_LIVE_INVOICE, select: { id: true } },
      },
    })

    if (!treatment) {
      return NextResponse.json({ error: 'Treatment not found' }, { status: 404 })
    }

    // FR-007. A signed note cannot be deleted by anyone, including the roles
    // that hold `clinical:delete` — otherwise the lock is decorative, since
    // deleting and re-entering achieves the silent overwrite by another route.
    // Spec §10 wants staff deactivated "without deleting historical records";
    // the same reasoning applies to the records themselves.
    if (treatment.signedAt) {
      return NextResponse.json(
        {
          error: `${treatment.treatmentNo} is a signed clinical record and cannot be deleted. Amend it or add an addendum instead.`,
          signedAt: treatment.signedAt,
        },
        { status: 409 }
      )
    }

    // Check if treatment has invoices
    if ((treatment.invoiceItems ?? []).length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete treatment with linked invoices' },
        { status: 400 }
      )
    }

    // The plan step it was carrying out goes back to pending: the work it
    // recorded no longer stands. The schema would clear the link on its own,
    // but would leave the step saying it was in progress.
    await prisma.$transaction(async (tx) => {
      await releasePlanItemFor(tx, id)
      await tx.treatment.delete({
        where: { id, hospitalId },
      })
    })

    // A clinical record removed is recorded with what it was (finding 24).
    void recordAudit({
      hospitalId,
      userId: session?.user?.id ?? null,
      action: AUDIT_ACTIONS.TREATMENT_DELETED,
      entityType: 'Treatment',
      entityId: id,
      oldValues: {
        treatmentNo: treatment.treatmentNo,
        patientId: treatment.patientId,
        procedureId: treatment.procedureId,
        doctorId: treatment.doctorId,
        status: treatment.status,
        cost: Number(treatment.cost),
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({
      message: 'Treatment deleted successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting treatment:', error)
    return NextResponse.json({ error: 'Failed to delete treatment' }, { status: 500 })
  }
}
