import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { LabOrderStatus, QualityCheckStatus } from '@prisma/client'
import { AUDIT_ACTIONS } from '@/lib/audit'

// Only orders that have not been sent anywhere yet may be removed.
const DELETABLE_STATUSES: LabOrderStatus[] = [LabOrderStatus.CREATED, LabOrderStatus.CANCELLED]

// GET - Fetch single lab order by ID
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('lab:read')

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

    const { labVendor, patient, ...rest } = order

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
  } catch (error: any) {
    console.error('Error fetching lab order:', error)
    return NextResponse.json(
      { error: 'Failed to fetch lab order', details: error.message },
      { status: 500 }
    )
  }
}

// PUT - Update lab order
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.labOrder.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: { id: true, status: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Lab order not found' }, { status: 404 })
    }

    const currentStatus = existing.status

    const {
      patientId,
      labVendorId,
      workType,
      description,
      toothNumbers,
      shadeGuide,
      orderDate,
      expectedDate,
      sentDate,
      receivedDate,
      deliveredDate,
      estimatedCost,
      actualCost,
      status,
      qualityCheck,
      qualityNotes,
      priority,
      notes,
      specialInstructions,
    } = body

    if (!patientId || !labVendorId || !workType || !orderDate || estimatedCost == null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.labOrder.update({
        where: { id },
        data: {
          patient: { connect: { id: patientId } },
          labVendor: { connect: { id: labVendorId } },
          workType,
          description: description || null,
          toothNumbers: toothNumbers || null,
          shadeGuide: shadeGuide || null,
          orderDate: new Date(orderDate),
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          sentDate: sentDate ? new Date(sentDate) : null,
          receivedDate: receivedDate ? new Date(receivedDate) : null,
          deliveredDate: deliveredDate ? new Date(deliveredDate) : null,
          estimatedCost,
          actualCost: actualCost ?? null,
          ...(status ? { status } : {}),
          qualityCheck: qualityCheck || QualityCheckStatus.PENDING,
          qualityNotes: qualityNotes || null,
          ...(priority ? { priority } : {}),
          notes: notes || null,
          specialInstructions: specialInstructions || null,
        },
      })

      if (status && status !== currentStatus) {
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
  } catch (error: any) {
    console.error('Error updating lab order:', error)
    return NextResponse.json(
      { error: 'Failed to update lab order', details: error.message },
      { status: 500 }
    )
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
  } catch (error: any) {
    console.error('Error deleting lab order:', error)
    return NextResponse.json(
      { error: 'Failed to delete lab order', details: error.message },
      { status: 500 }
    )
  }
}
