import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit'
import { requireFeature } from '@/lib/plan-gate'
import { knownErrorResponse } from '@/lib/api-errors'
import { canMoveStatus, milestoneUpdate, nextStatuses, statusLabel } from '@/lib/lab-orders'
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

  // The lab module is a paid feature (finding 26). Reading a case stays open
  // to a clinic that has dropped plans; moving one on does not.
  const gated = await requireFeature(hospitalId, 'labModule')
  if (gated) return gated

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

    // One stage at a time, plus the rework steps lib/lab-orders.ts names
    // (finding 45). Anything else is refused with the moves that are allowed,
    // so the toast tells the desk what to do instead.
    if (status === currentStatus) {
      return NextResponse.json(
        { error: `This case is already ${statusLabel(status).toLowerCase()}` },
        { status: 400 }
      )
    }

    if (!canMoveStatus(currentStatus, status)) {
      const allowed = nextStatuses(currentStatus).map((s) => statusLabel(s).toLowerCase())
      return NextResponse.json(
        {
          error:
            allowed.length > 0
              ? `A case that is ${statusLabel(currentStatus).toLowerCase()} cannot move to ${statusLabel(status).toLowerCase()}. It can go to: ${allowed.join(', ')}.`
              : `A case that is ${statusLabel(currentStatus).toLowerCase()} cannot change status.`,
        },
        { status: 400 }
      )
    }

    // Stamp the milestone dates the first time each stage is reached, and
    // clear the ones a move back leaves the case short of.
    const data: Prisma.LabOrderUpdateInput = {
      status,
      ...milestoneUpdate(order, currentStatus, status),
    }

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
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating lab order status:', error)
    return NextResponse.json({ error: 'Failed to update lab order status' }, { status: 500 })
  }
}
