import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { knownErrorResponse } from '@/lib/api-errors'

/**
 * GET — a patient's treatments, for the "treatment this is for" picker on the
 * lab order form (bug report 12 Oct, finding 60).
 *
 * Its own endpoint rather than `/api/treatments`, which is gated on
 * `clinical:read`: the Lab Technician raises and edits cases (`lab:write`) and
 * deliberately holds no clinical read. What is returned is what a case slip
 * already carries — the procedure, the teeth, the date — and nothing of the
 * notes, findings or diagnosis behind it.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const patientId = request.nextUrl.searchParams.get('patientId')
    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 })
    }

    const treatments = await prisma.treatment.findMany({
      where: { hospitalId, patientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        treatmentNo: true,
        toothNumbers: true,
        status: true,
        createdAt: true,
        procedure: { select: { name: true } },
      },
    })

    return NextResponse.json({
      success: true,
      data: treatments.map(({ procedure, ...t }) => ({
        ...t,
        procedureName: procedure?.name ?? null,
      })),
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching treatments for a lab order:', error)
    return NextResponse.json({ error: 'Failed to fetch treatments' }, { status: 500 })
  }
}
