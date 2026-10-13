import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { TreatmentPlanStatus } from '@prisma/client'
import { requirePermission } from '@/lib/api-helpers'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { normalisePhaseNames } from '@/lib/treatment-phases'
import { readPlanItems } from '@/lib/treatment-plan-items'

// Generate unique plan number for a hospital
async function generatePlanNumber(hospitalId: string): Promise<string> {
  const today = new Date()
  const prefix = `PLN${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`

  return nextInSeries(prisma, {
    hospitalId,
    prefix,
    width: 4,
    currentMax: async () => {
      const last = await prisma.treatmentPlan.findFirst({
        where: { hospitalId, planNumber: { startsWith: prefix } },
        orderBy: { planNumber: 'desc' },
        select: { planNumber: true },
      })
      return trailingNumber(last?.planNumber, 4)
    },
  })
}

// GET - List treatment plans with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('clinical:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const patientId = searchParams.get('patientId') || ''
    const consentGiven = searchParams.get('consentGiven')

    const skip = (page - 1) * limit

    // Build where clause
    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { planNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { patientId: { contains: search, mode: 'insensitive' } } },
      ]
    }

    if (status) {
      if (!isEnumMember(TreatmentPlanStatus, status)) {
        return enumRefusal('Status', status, TreatmentPlanStatus)
      }
      where.status = status
    }

    if (patientId) {
      where.patientId = patientId
    }

    if (consentGiven !== null && consentGiven !== '') {
      where.consentGiven = consentGiven === 'true'
    }

    const [treatmentPlans, total] = await Promise.all([
      prisma.treatmentPlan.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
          items: {
            include: {
              procedure: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  category: true,
                },
              },
            },
            // Phase first, then the order within it. Sorting on `priority`
            // alone interleaved the phases, so a plan read as one list again.
            orderBy: [{ phase: 'asc' }, { priority: 'asc' }],
          },
          _count: {
            select: {
              items: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.treatmentPlan.count({ where }),
    ])

    return NextResponse.json({
      treatmentPlans,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching treatment plans:', error)
    return NextResponse.json({ error: 'Failed to fetch treatment plans' }, { status: 500 })
  }
}

// POST - Create new treatment plan
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('clinical:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { patientId, title, notes, startDate, expectedEndDate, phaseNames, items = [] } = body

    // Validate required fields
    if (!patientId || !title) {
      return NextResponse.json({ error: 'Patient and title are required' }, { status: 400 })
    }

    // Check if patient exists and belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Same procedure on several lines, deactivated procedures, teeth and
    // prices — all checked in one place for create and edit.
    const checked = await readPlanItems(prisma, hospitalId, items)
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: checked.status })
    }
    const { estimatedCost, estimatedDuration } = checked

    // Generate plan number unique to this hospital
    const planNumber = await generatePlanNumber(hospitalId)

    // Create treatment plan with items
    const treatmentPlan = await prisma.treatmentPlan.create({
      data: {
        hospitalId,
        planNumber,
        patientId,
        title,
        notes,
        status: 'DRAFT',
        estimatedCost,
        estimatedDuration,
        startDate: startDate ? new Date(startDate) : null,
        expectedEndDate: expectedEndDate ? new Date(expectedEndDate) : null,
        consentGiven: false,
        phaseNames: normalisePhaseNames(phaseNames) ?? undefined,
        items: {
          create: checked.items.map((item) => ({
            procedureId: item.procedureId,
            toothNumbers: item.toothNumbers,
            phase: item.phase,
            priority: item.priority,
            estimatedCost: item.estimatedCost,
            notes: item.notes,
            // A new plan has done nothing yet.
            status: 'PENDING',
          })),
        },
      },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: {
            procedure: {
              select: {
                id: true,
                code: true,
                name: true,
                category: true,
                basePrice: true,
              },
            },
          },
          orderBy: [{ phase: 'asc' }, { priority: 'asc' }],
        },
      },
    })

    return NextResponse.json(treatmentPlan, { status: 201 })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating treatment plan:', error)
    return NextResponse.json({ error: 'Failed to create treatment plan' }, { status: 500 })
  }
}
