import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const updateChairSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  room: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

// PATCH /api/chairs/[id] - rename a chair, or take it in/out of service
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const data = updateChairSchema.parse(await req.json())

    const chair = await prisma.chair.findFirst({ where: { id, hospitalId }, select: { id: true } })
    if (!chair) {
      return NextResponse.json({ error: 'Chair not found' }, { status: 404 })
    }

    if (data.name) {
      const clash = await prisma.chair.findFirst({
        where: { hospitalId, id: { not: id }, name: { equals: data.name, mode: 'insensitive' } },
        select: { id: true },
      })
      if (clash) {
        return NextResponse.json(
          { error: 'A chair with that name already exists' },
          { status: 409 }
        )
      }
    }

    const updated = await prisma.chair.update({ where: { id }, data })
    return NextResponse.json({ success: true, data: updated })
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid chair' },
        { status: 400 }
      )
    }
    console.error('Update chair error:', err)
    return NextResponse.json({ error: 'Failed to update chair' }, { status: 500 })
  }
}

/**
 * DELETE /api/chairs/[id]
 *
 * A chair with history is deactivated rather than deleted: the appointments
 * that used it are part of the clinical record, and `onDelete: SetNull` would
 * quietly erase which chair a past treatment happened in. Only a chair that has
 * never been used is actually removed.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const chair = await prisma.chair.findFirst({
      where: { id, hospitalId },
      select: { id: true, _count: { select: { appointments: true } } },
    })
    if (!chair) {
      return NextResponse.json({ error: 'Chair not found' }, { status: 404 })
    }

    if (chair._count.appointments > 0) {
      const deactivated = await prisma.chair.update({
        where: { id },
        data: { isActive: false },
      })
      return NextResponse.json({
        success: true,
        data: deactivated,
        deactivated: true,
        message: `This chair has ${chair._count.appointments} appointment(s) against it, so it was taken out of service rather than deleted.`,
      })
    }

    await prisma.chair.delete({ where: { id } })
    return NextResponse.json({ success: true, deactivated: false })
  } catch (err: any) {
    console.error('Delete chair error:', err)
    return NextResponse.json({ error: 'Failed to delete chair' }, { status: 500 })
  }
}
