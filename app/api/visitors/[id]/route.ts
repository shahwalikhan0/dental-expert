import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { canDecideOn, validateVisitor } from '@/lib/visitors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('patients:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const visitor = await prisma.visitor.findFirst({
      where: { id, hospitalId },
      include: {
        convertedPatient: {
          select: { id: true, patientId: true, firstName: true, lastName: true },
        },
        convertedBy: { select: { id: true, name: true } },
        discardedBy: { select: { id: true, name: true } },
        appointments: {
          orderBy: { startsAt: 'desc' },
          select: {
            id: true,
            appointmentNo: true,
            startsAt: true,
            status: true,
            tokenNumber: true,
            doctor: { select: { firstName: true, lastName: true } },
          },
        },
      },
    })

    if (!visitor) return NextResponse.json({ error: 'Visitor not found' }, { status: 404 })

    return NextResponse.json({ visitor })
  } catch (err) {
    console.error('Error fetching visitor:', err)
    return NextResponse.json({ error: 'Failed to fetch visitor' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('patients:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.visitor.findFirst({
      where: { id, hospitalId },
      select: { id: true, convertedAt: true, discardedAt: true },
    })
    if (!existing) return NextResponse.json({ error: 'Visitor not found' }, { status: 404 })

    if (!canDecideOn(existing)) {
      return NextResponse.json(
        { error: 'A visitor who has been registered or discarded cannot be edited' },
        { status: 409 }
      )
    }

    const invalid = validateVisitor(body)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    const visitor = await prisma.visitor.update({
      where: { id },
      data: {
        name: String(body.name).trim(),
        phone: body.phone ? String(body.phone).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
      },
    })

    return NextResponse.json({ visitor })
  } catch (err) {
    console.error('Error updating visitor:', err)
    return NextResponse.json({ error: 'Failed to update visitor' }, { status: 500 })
  }
}

/**
 * DELETE — write this walk-in off.
 *
 * Soft, and deliberately so. The visit happened; a clinic that saw somebody
 * should still be able to answer for the appointment afterwards, and the
 * appointment's foreign key would refuse a hard delete anyway.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, user } = await requirePermission('patients:delete')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const visitor = await prisma.visitor.findFirst({
      where: { id, hospitalId },
      select: { id: true, name: true, convertedAt: true, discardedAt: true },
    })
    if (!visitor) return NextResponse.json({ error: 'Visitor not found' }, { status: 404 })

    if (!canDecideOn(visitor)) {
      return NextResponse.json(
        {
          error: visitor.convertedAt
            ? 'This visitor has been registered as a patient and cannot be discarded'
            : 'This visitor was already discarded',
        },
        { status: 409 }
      )
    }

    await prisma.visitor.update({
      where: { id },
      data: { discardedAt: new Date(), discardedById: user.id },
    })

    await recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.VISITOR_DISCARDED,
      entityType: 'Visitor',
      entityId: visitor.id,
      oldValues: { name: visitor.name },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ success: true, message: `${visitor.name} was discarded` })
  } catch (err) {
    console.error('Error discarding visitor:', err)
    return NextResponse.json({ error: 'Failed to discard this visitor' }, { status: 500 })
  }
}
