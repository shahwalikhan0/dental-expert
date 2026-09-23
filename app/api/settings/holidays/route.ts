import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const createHolidaySchema = z.object({
  name: z.string().min(1),
  date: z.string().datetime(),
  isRecurring: z.boolean().optional(),
})

// GET /api/settings/holidays - Get all holidays
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams
    const year = searchParams.get('year')

    const where: any = { hospitalId }

    if (year) {
      const yearNum = parseInt(year)
      where.date = {
        gte: new Date(`${yearNum}-01-01`),
        lte: new Date(`${yearNum}-12-31`),
      }
    }

    // A clinic holiday is a dated `Availability` row that closes the whole day
    // for everybody — see lib/availability.ts.
    const holidays = await prisma.availability.findMany({
      where: { ...where, staffId: null, date: where.date ?? { not: null }, isAvailable: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, date: true, isRecurring: true },
    })

    return NextResponse.json({
      success: true,
      data: holidays,
      count: holidays.length,
    })
  } catch (error: any) {
    console.error('Get holidays error:', error)
    return NextResponse.json({ error: error.message || 'Failed to get holidays' }, { status: 500 })
  }
}

// POST /api/settings/holidays - Create a new holiday
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const data = createHolidaySchema.parse(body)

    const holiday = await prisma.availability.create({
      data: {
        name: data.name,
        date: new Date(data.date),
        isRecurring: data.isRecurring || false,
        hospitalId,
        // Nobody is bookable, and no times means the whole day.
        staffId: null,
        isAvailable: false,
      },
      select: { id: true, name: true, date: true, isRecurring: true },
    })

    return NextResponse.json({
      success: true,
      data: holiday,
      message: 'Holiday created successfully',
    })
  } catch (error: any) {
    console.error('Create holiday error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create holiday' },
      { status: 500 }
    )
  }
}

// DELETE /api/settings/holidays?id=xxx - Delete a holiday
export async function DELETE(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Holiday ID is required' }, { status: 400 })
    }

    // `deleteMany` rather than `delete` so the clinic filter is part of the
    // statement: deleting by id alone would reach another clinic's row.
    const removed = await prisma.availability.deleteMany({
      where: { id, hospitalId, staffId: null, date: { not: null } },
    })

    if (removed.count === 0) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Holiday deleted successfully',
    })
  } catch (error: any) {
    console.error('Delete holiday error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete holiday' },
      { status: 500 }
    )
  }
}
