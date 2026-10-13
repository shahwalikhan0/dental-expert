import { NextRequest, NextResponse } from 'next/server'
import { Prisma, TreatmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { requirePermission } from '@/lib/api-helpers'
import { clinicTimezone, withWallClock } from '@/lib/appointment-time'
import { knownErrorResponse } from '@/lib/api-errors'
import { findDentist, NOT_A_DENTIST } from '@/lib/clinicians'
import { readTeeth } from '@/lib/teeth'
import {
  linkPlanItem,
  PlanItemTaken,
  STARTABLE_ITEM,
  STARTABLE_PLAN,
} from '@/lib/treatment-plan-status'

// Generate unique treatment number
async function generateTreatmentNo(hospitalId: string): Promise<string> {
  const today = new Date()
  const prefix = `TRT${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

  return nextInSeries(prisma, {
    hospitalId,
    prefix,
    width: 4,
    currentMax: async () => {
      const last = await prisma.treatment.findFirst({
        where: { hospitalId, treatmentNo: { startsWith: prefix } },
        orderBy: { treatmentNo: 'desc' },
        select: { treatmentNo: true },
      })
      return trailingNumber(last?.treatmentNo, 4)
    },
  })
}

// GET - List treatments with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('clinical:read')
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
    const doctorId = searchParams.get('doctorId') || ''
    const procedureId = searchParams.get('procedureId') || ''
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const followUpRequired = searchParams.get('followUpRequired')

    const skip = (page - 1) * limit

    // Build where clause
    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { treatmentNo: { contains: search, mode: 'insensitive' } },
        { chiefComplaint: { contains: search, mode: 'insensitive' } },
        { diagnosis: { contains: search, mode: 'insensitive' } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { patientId: { contains: search, mode: 'insensitive' } } },
      ]
    }

    if (status) {
      // Checked here rather than left to Prisma, which rejects an unknown enum
      // value by throwing — a bookmarked `?status=all` came back as a 500.
      if (!(Object.values(TreatmentStatus) as string[]).includes(status)) {
        return NextResponse.json({ error: `Unknown status: ${status}` }, { status: 400 })
      }
      where.status = status
    }

    if (patientId) {
      where.patientId = patientId
    }

    if (doctorId) {
      where.doctorId = doctorId
    }

    if (procedureId) {
      where.procedureId = procedureId
    }

    if (followUpRequired === 'true') {
      where.followUpRequired = true
    }

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom)
      }
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        where.createdAt.lte = endDate
      }
    }

    const [treatments, total] = await Promise.all([
      prisma.treatment.findMany({
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
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
          procedure: {
            select: {
              id: true,
              code: true,
              name: true,
              category: true,
            },
          },
          appointment: {
            select: {
              id: true,
              appointmentNo: true,
              startsAt: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.treatment.count({ where }),
    ])

    const timezone = await clinicTimezone(prisma, hospitalId)

    return NextResponse.json({
      treatments: treatments.map((t) => ({
        ...t,
        appointment: t.appointment ? withWallClock(t.appointment, timezone) : t.appointment,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching treatments:', error)
    return NextResponse.json({ error: 'Failed to fetch treatments' }, { status: 500 })
  }
}

// POST - Create new treatment
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('clinical:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      patientId,
      appointmentId,
      procedureId,
      doctorId,
      treatmentPlanItemId,
      chiefComplaint,
      diagnosis,
      findings,
      procedureNotes,
      materialsUsed,
      complications,
      followUpRequired = false,
      followUpDate,
    } = body

    // Validate required fields
    if (!patientId || !procedureId || !doctorId) {
      return NextResponse.json(
        { error: 'Patient, procedure, and doctor are required' },
        { status: 400 }
      )
    }

    // Tooth numbers are checked, not stored as typed: "99,ABC" was accepted
    // (bug report 12 Oct, finding 54) and then read back as no teeth at all.
    const teeth = readTeeth(body.toothNumbers)
    if (!teeth.ok) {
      return NextResponse.json({ error: teeth.error }, { status: 400 })
    }

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId, hospitalId },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // The treating dentist is an active dentist at this clinic. Belonging to
    // the clinic was the whole check before, so the receptionist could be the
    // treating dentist on a treatment (finding 7).
    const doctor = await findDentist(hospitalId, doctorId)
    if (!doctor) {
      return NextResponse.json({ error: NOT_A_DENTIST, code: 'NOT_A_DENTIST' }, { status: 400 })
    }

    // Check if procedure exists
    const procedure = await prisma.procedure.findUnique({
      where: { id: procedureId, hospitalId },
    })
    if (!procedure) {
      return NextResponse.json({ error: 'Procedure not found' }, { status: 404 })
    }
    // A procedure taken out of the catalogue is not offered for new work. Its
    // existing treatments keep it; nothing new is recorded against it
    // (finding 48).
    if (procedure.isActive === false) {
      return NextResponse.json(
        {
          error: `${procedure.name} has been deactivated in the procedure catalogue and cannot be used for a new treatment.`,
        },
        { status: 400 }
      )
    }

    // The appointment has to be this patient's, not just this clinic's. A
    // treatment saved against somebody else's visit put it on their timeline
    // and on anything billed from that visit (finding 9). Same check, and the
    // same words, as a clinical note.
    if (appointmentId) {
      const appointment = await prisma.appointment.findFirst({
        where: { id: appointmentId, hospitalId },
        select: { id: true, patientId: true },
      })
      if (!appointment) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
      }
      if (appointment.patientId !== patientId) {
        return NextResponse.json(
          { error: 'That appointment is not this patient’s' },
          { status: 400 }
        )
      }
    }

    // Started from a plan item: the item has to be this patient's, for this
    // procedure, and not already carried out or dropped (finding 11).
    let planItem: {
      id: string
      estimatedCost: Prisma.Decimal
      treatmentPlanId: string
      planStatus: string
    } | null = null
    if (treatmentPlanItemId) {
      const item = await prisma.treatmentPlanItem.findFirst({
        where: { id: treatmentPlanItemId, treatmentPlan: { hospitalId } },
        select: {
          id: true,
          procedureId: true,
          status: true,
          treatmentId: true,
          estimatedCost: true,
          treatmentPlanId: true,
          treatmentPlan: { select: { patientId: true, status: true, planNumber: true } },
        },
      })
      if (!item || item.treatmentPlan.patientId !== patientId) {
        return NextResponse.json({ error: 'That plan step is not this patient’s' }, { status: 400 })
      }
      if (item.procedureId !== procedureId) {
        return NextResponse.json(
          { error: 'That plan step is for a different procedure' },
          { status: 400 }
        )
      }
      if (item.treatmentId) {
        return NextResponse.json(
          { error: 'That plan step has already been started by another treatment' },
          { status: 409 }
        )
      }
      if (!STARTABLE_ITEM.has(item.status)) {
        return NextResponse.json(
          { error: `That plan step is ${item.status.toLowerCase().replace('_', ' ')}` },
          { status: 400 }
        )
      }
      if (!STARTABLE_PLAN.has(item.treatmentPlan.status)) {
        return NextResponse.json(
          {
            error: `${item.treatmentPlan.planNumber} is ${item.treatmentPlan.status.toLowerCase().replace('_', ' ')}. A step can be started once the plan is accepted.`,
          },
          { status: 400 }
        )
      }
      planItem = {
        id: item.id,
        estimatedCost: item.estimatedCost,
        treatmentPlanId: item.treatmentPlanId,
        planStatus: item.treatmentPlan.status,
      }
    }

    // Rs 0 is a price — a goodwill redo, a free review — and used to be
    // replaced by the list price because `cost || basePrice` cannot tell 0
    // from nothing (finding 33). Nothing sent means the plan's quoted price
    // when there is a plan step, otherwise the catalogue's. Negative is refused.
    let cost: number | Prisma.Decimal
    if (body.cost === undefined || body.cost === null || body.cost === '') {
      cost = planItem?.estimatedCost ?? procedure.basePrice
    } else {
      cost = Number(body.cost)
      if (!Number.isFinite(cost) || cost < 0) {
        return NextResponse.json(
          { error: 'The cost must be a number of zero or more' },
          { status: 400 }
        )
      }
    }

    // Generate treatment number
    const treatmentNo = await generateTreatmentNo(hospitalId)

    // The treatment and its plan step are linked in one write: a treatment
    // that started a step nobody can see, or a step marked started by a
    // treatment that was never saved, are both the bug this fixes.
    const treatment = await prisma.$transaction(async (tx) => {
      const created = await tx.treatment.create({
        data: {
          hospitalId,
          treatmentNo,
          patientId,
          appointmentId: appointmentId || null,
          procedureId,
          doctorId: doctor.id,
          toothNumbers: teeth.column,
          chiefComplaint,
          diagnosis,
          findings,
          procedureNotes,
          materialsUsed,
          complications,
          followUpRequired,
          followUpDate: followUpDate ? new Date(followUpDate) : null,
          cost,
          status: 'PLANNED',
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
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          procedure: {
            select: {
              id: true,
              code: true,
              name: true,
              category: true,
            },
          },
        },
      })

      if (planItem) {
        await linkPlanItem(tx, {
          planItemId: planItem.id,
          planId: planItem.treatmentPlanId,
          planStatus: planItem.planStatus,
          treatmentId: created.id,
        })
      }

      return created
    })

    return NextResponse.json(treatment, { status: 201 })
  } catch (error) {
    if (error instanceof PlanItemTaken) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating treatment:', error)
    return NextResponse.json({ error: 'Failed to create treatment' }, { status: 500 })
  }
}
