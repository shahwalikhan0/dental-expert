import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'

// GET - Get single dental chart entry
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const entry = await prisma.dentalChartEntry.findFirst({
      where: { id, hospitalId },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Dental chart entry not found' }, { status: 404 })
    }

    return NextResponse.json(entry)
  } catch (error) {
    console.error('Error fetching dental chart entry:', error)
    return NextResponse.json({ error: 'Failed to fetch dental chart entry' }, { status: 500 })
  }
}

// PUT - Update dental chart entry
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('clinical:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    // Check if entry exists and belongs to this hospital
    const existingEntry = await prisma.dentalChartEntry.findFirst({
      where: { id, hospitalId },
    })

    if (!existingEntry) {
      return NextResponse.json({ error: 'Dental chart entry not found' }, { status: 404 })
    }

    const updateData: any = {}

    if (body.condition !== undefined) updateData.condition = body.condition
    if (body.severity !== undefined) updateData.severity = body.severity
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.resolvedDate !== undefined) updateData.resolvedDate = body.resolvedDate
    // Update individual surface fields if provided
    if (body.mesial !== undefined) updateData.mesial = body.mesial
    if (body.distal !== undefined) updateData.distal = body.distal
    if (body.occlusal !== undefined) updateData.occlusal = body.occlusal
    if (body.buccal !== undefined) updateData.buccal = body.buccal
    if (body.lingual !== undefined) updateData.lingual = body.lingual

    const entry = await prisma.dentalChartEntry.update({
      where: { id },
      data: updateData,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    })

    return NextResponse.json(entry)
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating dental chart entry:', error)
    return NextResponse.json({ error: 'Failed to update dental chart entry' }, { status: 500 })
  }
}

// DELETE - Delete dental chart entry (soft delete - mark as inactive)
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

    // Check if entry exists and belongs to this hospital
    const entry = await prisma.dentalChartEntry.findFirst({
      where: { id, hospitalId },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Dental chart entry not found' }, { status: 404 })
    }

    // Hard delete the entry
    await prisma.dentalChartEntry.delete({
      where: { id },
    })

    return NextResponse.json({
      message: 'Dental chart entry deleted successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting dental chart entry:', error)
    return NextResponse.json({ error: 'Failed to delete dental chart entry' }, { status: 500 })
  }
}
