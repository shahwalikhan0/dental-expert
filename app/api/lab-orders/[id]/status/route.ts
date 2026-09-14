import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit'
import { LabOrderStatus, Prisma } from '@prisma/client'

const LAB_ORDER_STATUSES = Object.values(LabOrderStatus) as string[]

/** Accepts the legacy lowercase statuses as well as the enum casing. */
function parseStatus(value: unknown): LabOrderStatus | null {
  if (typeof value !== 'string') return null
  const upper = value.toUpperCase()
  return LAB_ORDER_STATUSES.includes(upper) ? (upper as LabOrderStatus) : null
}

// PATCH - Update lab order status
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { notes } = body

    if (!body.status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 })
    }

    const status = parseStatus(body.status)

    if (!status) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const order = await prisma.labOrder.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: {
        id: true,
        status: true,
        sentDate: true,
        receivedDate: true,
        deliveredDate: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Lab order not found' }, { status: 404 })
    }

    const currentStatus = order.status
    const now = new Date()

    // Stamp the milestone dates the first time each status is reached.
    const data: Prisma.LabOrderUpdateInput = { status }
    if (status === LabOrderStatus.SENT_TO_LAB && !order.sentDate) data.sentDate = now
    if (status === LabOrderStatus.READY && !order.receivedDate) data.receivedDate = now
    if (status === LabOrderStatus.FITTED && !order.deliveredDate) data.deliveredDate = now

    await prisma.$transaction([
      prisma.labOrder.update({ where: { id }, data }),
      // The status trail is the audit log. It used to be `LabOrderHistory`,
      // a table that recorded who changed a lab order's status and when — and
      // nothing else, which is precisely what AuditLog already records for
      // every other kind of change in the system.
      prisma.auditLog.create({
        data: {
          hospitalId,
          userId: session?.user?.id ?? null,
          action: AUDIT_ACTIONS.LAB_ORDER_STATUS_CHANGED,
          entityType: 'LabOrder',
          entityId: id,
          oldValues: JSON.stringify({ status: currentStatus }),
          newValues: JSON.stringify({ status, notes: notes || `Status changed to ${status}` }),
        },
      }),
    ])

    return NextResponse.json({
      success: true,
      message: 'Lab order status updated successfully',
    })
  } catch (error: any) {
    console.error('Error updating lab order status:', error)
    return NextResponse.json(
      { error: 'Failed to update lab order status', details: error.message },
      { status: 500 }
    )
  }
}
