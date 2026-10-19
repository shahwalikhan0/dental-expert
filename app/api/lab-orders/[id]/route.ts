import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import {
  canMoveStatus,
  checkLabOrderValues,
  milestoneUpdate,
  nextStatuses,
  isLabOrderEditable,
  normaliseWorkType,
  statusLabel,
} from '@/lib/lab-orders'
import { resolveTreatmentLink } from '@/lib/lab-order-links'
import { prisma } from '@/lib/prisma'
import { LabOrderPriority, LabOrderStatus, Prisma, QualityCheckStatus } from '@prisma/client'
import { AUDIT_ACTIONS } from '@/lib/audit'
import { requireFeature } from '@/lib/plan-gate'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { holderCan } from '@/lib/rbac'
import { liveInvoiceFor } from '@/lib/treatment-billing'

// Only orders that have not been sent anywhere yet may be removed.
const DELETABLE_STATUSES: LabOrderStatus[] = [LabOrderStatus.CREATED, LabOrderStatus.CANCELLED]

// GET - Fetch single lab order by ID
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('lab:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const order = await prisma.labOrder.findFirst({
      where: { id, hospitalId, deletedAt: null },
      include: {
        labVendor: {
          select: {
            name: true,
            phone: true,
            email: true,
            address: true,
            avgTurnaround: true,
            rating: true,
          },
        },
        patient: {
          select: {
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        // The treatment the work is for (finding 60), so the case can say
        // which preparation the crown fits.
        treatment: {
          select: {
            id: true,
            treatmentNo: true,
            toothNumbers: true,
            status: true,
            createdAt: true,
            procedure: { select: { name: true } },
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Lab order not found' }, { status: 404 })
    }

    const createdByUser = order.createdBy
      ? await prisma.user.findUnique({
          where: { id: order.createdBy },
          select: { name: true },
        })
      : null

    /**
     * The status trail comes from the audit log now.
     *
     * `LabOrderHistory` recorded who changed a lab order's status and when —
     * which is what `AuditLog` is for, and was the only thing it recorded. Two
     * places to look for "who changed this" is one too many, and only one of
     * them was ever shown on the audit screen.
     */
    const history = await prisma.auditLog.findMany({
      where: { hospitalId, entityType: 'LabOrder', entityId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } },
    })

    /**
     * Whether the treatment this work is for has been billed (review 4.4).
     *
     * A lab case carries no charge of its own: the patient pays for the crown
     * through the treatment's price. So "was the lab work billed?" is "is its
     * treatment on an invoice that still stands?", and this answers it on the
     * case. Only for those who may read billing — a lab technician holds
     * `lab:read` and no billing access. Left out (undefined) for them; null
     * means "not billed".
     */
    const treatmentInvoice =
      order.treatment && holderCan(user, 'billing:read')
        ? await liveInvoiceFor(prisma, order.treatment.id)
        : undefined

    const { labVendor, patient, treatment, ...rest } = order

    return NextResponse.json({
      success: true,
      data: {
        ...rest,
        vendorName: labVendor.name,
        vendorPhone: labVendor.phone,
        vendorEmail: labVendor.email,
        vendorAddress: labVendor.address,
        avgTurnaroundDays: labVendor.avgTurnaround,
        vendorRating: labVendor.rating,
        patientCode: patient.patientId,
        firstName: patient.firstName,
        lastName: patient.lastName,
        patientName: `${patient.firstName} ${patient.lastName}`,
        patientPhone: patient.phone,
        patientEmail: patient.email,
        treatment: treatment
          ? {
              id: treatment.id,
              treatmentNo: treatment.treatmentNo,
              procedureName: treatment.procedure?.name ?? null,
              toothNumbers: treatment.toothNumbers,
              status: treatment.status,
              createdAt: treatment.createdAt,
              invoice: treatmentInvoice,
            }
          : null,
        createdByName: createdByUser?.name ?? null,
        history: history.map((entry) => {
          const values = entry.newValues ? JSON.parse(entry.newValues) : {}
          const previous = entry.oldValues ? JSON.parse(entry.oldValues) : {}
          return {
            id: entry.id,
            createdAt: entry.createdAt,
            statusFrom: previous.status ?? null,
            statusTo: values.status ?? null,
            notes: values.notes ?? null,
            changedByName: entry.user?.name ?? null,
          }
        }),
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching lab order:', error)
    return NextResponse.json({ error: 'Failed to fetch lab order' }, { status: 500 })
  }
}

// PUT - Update lab order
//
// The patient is fixed: a case belongs to the mouth it was taken from (see the
// edit page). The milestone dates are not taken from the body either — they
// are stamped by status moves, and accepting them here is how a case could say
// it was delivered while it had not been sent. A status sent here goes through
// the same rules as the status route (finding 45).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gated = await requireFeature(hospitalId, 'labModule')
  if (gated) return gated

  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.labOrder.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: {
        id: true,
        status: true,
        patientId: true,
        labVendorId: true,
        sentDate: true,
        receivedDate: true,
        deliveredDate: true,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Lab order not found' }, { status: 404 })
    }

    const currentStatus = existing.status

    if (!isLabOrderEditable(currentStatus)) {
      return NextResponse.json(
        { error: 'This case was cancelled. A cancelled case cannot be changed.' },
        { status: 409 }
      )
    }

    const {
      labVendorId,
      workType,
      description,
      toothNumbers,
      shadeGuide,
      orderDate,
      expectedDate,
      estimatedCost,
      actualCost,
      qualityCheck,
      qualityNotes,
      priority,
      notes,
      specialInstructions,
      treatmentId,
    } = body

    if (!labVendorId || !workType || !orderDate || estimatedCost == null) {
      return NextResponse.json(
        { error: 'Missing required fields: labVendorId, workType, orderDate, estimatedCost' },
        { status: 400 }
      )
    }

    // See the same normalisation in the create route: the column is an enum.
    const normalisedWorkType = normaliseWorkType(workType)
    if (!normalisedWorkType) {
      return NextResponse.json({ error: `"${workType}" is not a work type` }, { status: 400 })
    }

    // Due before ordered, or a negative cost (finding 59).
    const invalid = checkLabOrderValues({ orderDate, expectedDate, estimatedCost, actualCost })
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    if (priority && !isEnumMember(LabOrderPriority, priority)) {
      return enumRefusal('priority', priority, LabOrderPriority)
    }
    if (qualityCheck && !isEnumMember(QualityCheckStatus, qualityCheck)) {
      return enumRefusal('qualityCheck', qualityCheck, QualityCheckStatus)
    }

    let status: LabOrderStatus | null = null
    if (body.status) {
      const upper = typeof body.status === 'string' ? body.status.toUpperCase() : body.status
      if (!isEnumMember(LabOrderStatus, upper)) {
        return enumRefusal('status', body.status, LabOrderStatus)
      }
      status = upper
    }

    const statusChanges = status !== null && status !== currentStatus
    if (statusChanges && !canMoveStatus(currentStatus, status!)) {
      const allowed = nextStatuses(currentStatus).map((s) => statusLabel(s).toLowerCase())
      return NextResponse.json(
        {
          error:
            allowed.length > 0
              ? `A case that is ${statusLabel(currentStatus).toLowerCase()} cannot move to ${statusLabel(status!).toLowerCase()}. It can go to: ${allowed.join(', ')}.`
              : `A case that is ${statusLabel(currentStatus).toLowerCase()} cannot change status.`,
        },
        { status: 400 }
      )
    }

    // A laboratory, in this clinic — a supplier's id is not a laboratory.
    if (labVendorId !== existing.labVendorId) {
      const vendor = await prisma.vendor.findFirst({
        where: { id: labVendorId, hospitalId, kind: 'LAB', deletedAt: null },
        select: { id: true },
      })
      if (!vendor) {
        return NextResponse.json({ error: 'Lab vendor not found' }, { status: 404 })
      }
    }

    // The treatment the work is for (finding 60): this patient's, this clinic's.
    const treatment = await resolveTreatmentLink(prisma, {
      hospitalId,
      patientId: existing.patientId,
      treatmentId,
    })
    if (!treatment.ok) {
      return NextResponse.json({ error: treatment.error }, { status: treatment.status })
    }

    const data: Prisma.LabOrderUncheckedUpdateInput = {
      labVendorId,
      workType: normalisedWorkType,
      description: description || null,
      toothNumbers: toothNumbers || null,
      shadeGuide: shadeGuide || null,
      orderDate: new Date(orderDate),
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      estimatedCost: Number(estimatedCost),
      actualCost: actualCost == null || actualCost === '' ? null : Number(actualCost),
      // Left alone when not sent. Defaulting a missing value to PENDING reset
      // a passed quality check every time somebody corrected the shade.
      ...(qualityCheck ? { qualityCheck } : {}),
      ...(qualityNotes !== undefined ? { qualityNotes: qualityNotes || null } : {}),
      ...(priority ? { priority } : {}),
      notes: notes || null,
      specialInstructions: specialInstructions || null,
      ...(treatment.treatmentId !== undefined ? { treatmentId: treatment.treatmentId } : {}),
      ...(statusChanges
        ? { status: status!, ...milestoneUpdate(existing, currentStatus, status!) }
        : {}),
    }

    await prisma.$transaction(async (tx) => {
      await tx.labOrder.update({ where: { id }, data })

      if (statusChanges) {
        await tx.auditLog.create({
          data: {
            hospitalId,
            userId: session?.user?.id ?? null,
            action: AUDIT_ACTIONS.LAB_ORDER_STATUS_CHANGED,
            entityType: 'LabOrder',
            entityId: id,
            oldValues: JSON.stringify({ status: currentStatus }),
            newValues: JSON.stringify({
              status,
              notes: `Status changed from ${currentStatus} to ${status}`,
            }),
          },
        })
      }
    })

    return NextResponse.json({ success: true, message: 'Lab order updated successfully' })
  } catch (error) {
    // A malformed value is the sender's mistake and gets a 400 that says so
    // (finding 25), never the raw message.
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating lab order:', error)
    return NextResponse.json({ error: 'Failed to update lab order' }, { status: 500 })
  }
}

// DELETE - Soft delete lab order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gated = await requireFeature(hospitalId, 'labModule')
  if (gated) return gated

  try {
    const { id } = await params

    const existing = await prisma.labOrder.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: { id: true, status: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Lab order not found' }, { status: 404 })
    }

    if (!DELETABLE_STATUSES.includes(existing.status)) {
      return NextResponse.json(
        { error: 'Cannot delete lab order that is in progress. Please cancel it first.' },
        { status: 400 }
      )
    }

    await prisma.labOrder.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true, message: 'Lab order deleted successfully' })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting lab order:', error)
    return NextResponse.json({ error: 'Failed to delete lab order' }, { status: 500 })
  }
}
