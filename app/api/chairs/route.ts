import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { z } from 'zod'

/**
 * Chairs / operatories — master data per FR-025.
 *
 * Reading is gated on `appointments:read`, not `masters:read`: reception picks
 * a chair every time they book, and the list is nothing but the clinic's own
 * room names. Writing is `settings:write`, alongside the other masters.
 */

const createChairSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  room: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

// GET /api/chairs - list chairs for the clinic
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Booking forms want only the chairs that can be used today; settings wants
    // the full list including the ones taken out of service.
    const includeInactive = req.nextUrl.searchParams.get('includeInactive') === 'true'

    const chairs = await prisma.chair.findMany({
      where: { hospitalId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return NextResponse.json({ success: true, data: chairs, count: chairs.length })
  } catch (err: any) {
    console.error('Get chairs error:', err)
    return NextResponse.json({ error: 'Failed to get chairs' }, { status: 500 })
  }
}

// POST /api/chairs - add a chair
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const data = createChairSchema.parse(await req.json())

    const existing = await prisma.chair.findFirst({
      where: { hospitalId, name: { equals: data.name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: 'A chair with that name already exists' }, { status: 409 })
    }

    const chair = await prisma.chair.create({
      data: {
        hospitalId,
        name: data.name,
        room: data.room || null,
        notes: data.notes || null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    })

    return NextResponse.json({ success: true, data: chair }, { status: 201 })
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid chair' },
        { status: 400 }
      )
    }
    console.error('Create chair error:', err)
    return NextResponse.json({ error: 'Failed to create chair' }, { status: 500 })
  }
}
