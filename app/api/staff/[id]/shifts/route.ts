import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

// GET - Get staff member's shifts
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('staff:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Verify staff belongs to hospital
    const staffMember = await prisma.staff.findFirst({
      where: { id, hospitalId },
    })
    if (!staffMember) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    // A weekly shift is an `Availability` row scoped to this person — see
    // lib/availability.ts. The clinic filter is on the query as well as on the
    // staff check above, so tenant isolation does not rest on one of them.
    const shifts = await prisma.availability.findMany({
      where: { hospitalId, staffId: id, dayOfWeek: { not: null }, isAvailable: true },
      orderBy: { dayOfWeek: 'asc' },
      select: { id: true, dayOfWeek: true, startTime: true, endTime: true },
    })

    return NextResponse.json({ shifts })
  } catch (error) {
    console.error('Error fetching shifts:', error)
    return NextResponse.json({ error: 'Failed to fetch shifts' }, { status: 500 })
  }
}

// PUT - Update staff member's shifts (replace all)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('staff:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { shifts } = body

    // Verify staff belongs to hospital
    const staffMember = await prisma.staff.findFirst({
      where: { id, hospitalId },
    })
    if (!staffMember) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    if (!Array.isArray(shifts)) {
      return NextResponse.json({ error: 'shifts must be an array' }, { status: 400 })
    }

    // Validate shifts
    for (const shift of shifts) {
      if (shift.dayOfWeek < 0 || shift.dayOfWeek > 6) {
        return NextResponse.json(
          { error: 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday)' },
          { status: 400 }
        )
      }
      if (!shift.startTime || !shift.endTime) {
        return NextResponse.json(
          { error: 'Each shift must have startTime and endTime' },
          { status: 400 }
        )
      }
    }

    // Replace the week. Only the weekly rows go: this person's days of leave
    // are dated entries in the same table and are not what this screen edits.
    const result = await prisma.$transaction(async (tx) => {
      await tx.availability.deleteMany({
        where: { hospitalId, staffId: id, dayOfWeek: { not: null } },
      })

      const working = shifts.filter((shift: any) => shift.isActive !== false)
      if (working.length > 0) {
        await tx.availability.createMany({
          data: working.map((shift: any) => ({
            hospitalId,
            staffId: id,
            dayOfWeek: shift.dayOfWeek,
            startTime: shift.startTime,
            endTime: shift.endTime,
            isAvailable: true,
          })),
        })
      }

      return await tx.availability.findMany({
        where: { hospitalId, staffId: id, dayOfWeek: { not: null } },
        orderBy: { dayOfWeek: 'asc' },
        select: { id: true, dayOfWeek: true, startTime: true, endTime: true },
      })
    })

    return NextResponse.json({ shifts: result })
  } catch (error) {
    console.error('Error updating shifts:', error)
    return NextResponse.json({ error: 'Failed to update shifts' }, { status: 500 })
  }
}
