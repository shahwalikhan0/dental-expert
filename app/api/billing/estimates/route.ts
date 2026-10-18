import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/**
 * GET - A patient's treatment plans, as the estimates the desk can hand over.
 *
 * `?patientId=` names the patient. For the patient's Billing tab: Front Desk
 * and Accounts talk cost with the patient, and the plan list under
 * `/api/treatment-plans` needs `clinical:read`, which they do not hold (bug
 * report 16 Oct, finding 25). So this answers with what is printed on the
 * estimate's heading — number, title, status, total — and nothing clinical.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const patientId = request.nextUrl.searchParams.get('patientId')
  if (!patientId) {
    return NextResponse.json({ error: 'Name the patient' }, { status: 400 })
  }

  try {
    const estimates = await prisma.treatmentPlan.findMany({
      where: { hospitalId, patientId },
      select: {
        id: true,
        planNumber: true,
        title: true,
        status: true,
        estimatedCost: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ estimates })
  } catch (error) {
    console.error('Error fetching estimates:', error)
    return NextResponse.json({ error: 'Failed to fetch the estimates' }, { status: 500 })
  }
}
