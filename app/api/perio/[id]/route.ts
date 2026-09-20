import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { summarise } from '@/lib/perio'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const exam = await prisma.perioExam.findFirst({
      where: { id, hospitalId },
      include: {
        measurements: true,
        toothFindings: true,
        recordedBy: { select: { id: true, name: true } },
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
      },
    })

    if (!exam) return NextResponse.json({ error: 'Chart not found' }, { status: 404 })

    return NextResponse.json({ exam: { ...exam, summary: summarise(exam.measurements) } })
  } catch (err) {
    console.error('Error fetching perio exam:', err)
    return NextResponse.json({ error: 'Failed to load the chart' }, { status: 500 })
  }
}

/**
 * DELETE — remove a chart recorded in error.
 *
 * Needs `clinical:delete`. A perio chart is a clinical measurement; correcting
 * one means charting the mouth again on a new date, and this is only for the
 * exam that was saved against the wrong patient.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('clinical:delete')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const deleted = await prisma.perioExam.deleteMany({ where: { id, hospitalId } })
    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Chart not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting perio exam:', err)
    return NextResponse.json({ error: 'Failed to delete the chart' }, { status: 500 })
  }
}
