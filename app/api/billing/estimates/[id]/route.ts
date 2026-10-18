import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthenticatedHospital, requirePermission } from '@/lib/api-helpers'
import { holderCan } from '@/lib/rbac'

/**
 * GET - One treatment plan, as the estimate the patient takes home.
 *
 * Read by two sets of people: the clinician who drew the plan up
 * (`clinical:read`, from the plan's own page) and the desk that discusses what
 * it costs (`billing:read`, from the patient's Billing tab — bug report 16 Oct,
 * finding 25). The full plan at `/api/treatment-plans/[id]` stays clinical; this
 * carries only what the printed estimate shows, which the patient is handed
 * anyway.
 */
async function requireEstimateReader() {
  const who = await getAuthenticatedHospital()
  if (who.user && holderCan(who.user, 'clinical:read')) return who
  // Refused and recorded as a billing refusal, which is the narrower of the two.
  return requirePermission('billing:read')
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requireEstimateReader()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const estimate = await prisma.treatmentPlan.findFirst({
      where: { id, hospitalId },
      select: {
        id: true,
        planNumber: true,
        title: true,
        notes: true,
        status: true,
        estimatedCost: true,
        phaseNames: true,
        createdAt: true,
        consentDate: true,
        patient: {
          select: { id: true, patientId: true, firstName: true, lastName: true, phone: true },
        },
        items: {
          select: {
            id: true,
            phase: true,
            priority: true,
            toothNumbers: true,
            estimatedCost: true,
            notes: true,
            status: true,
            procedure: { select: { code: true, name: true, description: true } },
          },
          orderBy: [{ phase: 'asc' }, { priority: 'asc' }],
        },
      },
    })

    if (!estimate) {
      return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 })
    }

    return NextResponse.json(estimate)
  } catch (error) {
    console.error('Error fetching estimate:', error)
    return NextResponse.json({ error: 'Failed to fetch the estimate' }, { status: 500 })
  }
}
