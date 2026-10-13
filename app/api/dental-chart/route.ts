import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { noteRecordAccess } from '@/lib/record-access'
import { requestContext } from '@/lib/audit'
import { knownErrorResponse } from '@/lib/api-errors'
import { isTooth, TOOTH_NUMBER_HINT } from '@/lib/teeth'

// GET - Get dental chart entries for a patient
export async function GET(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('clinical:read')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')
    const toothNumber = searchParams.get('toothNumber')
    const condition = searchParams.get('condition')
    const isActive = searchParams.get('isActive')

    if (!patientId) {
      return NextResponse.json({ error: 'Patient ID is required' }, { status: 400 })
    }

    // Verify patient belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Reading somebody's chart is the access §4 withholds from the front desk
    // and §10 asks to be recorded.
    void noteRecordAccess({
      db: prisma,
      hospitalId,
      userId: user.id,
      patientId: patient.id,
      kind: 'clinical',
      via: 'chart',
      ...requestContext(request.headers),
    })

    // Build where clause
    const where: any = {
      patientId,
      hospitalId,
    }

    if (toothNumber) {
      const tooth = Number(toothNumber)
      if (!isTooth(tooth)) {
        return NextResponse.json(
          { error: `Invalid tooth number. ${TOOTH_NUMBER_HINT}` },
          { status: 400 }
        )
      }
      where.toothNumber = tooth
    }

    if (condition) {
      where.condition = condition
    }

    // Filter by resolved status if provided
    if (isActive !== null && isActive !== '') {
      if (isActive === 'true') {
        // Active = not resolved (no resolvedDate)
        where.resolvedDate = null
      } else {
        // Inactive = resolved (has resolvedDate)
        where.resolvedDate = { not: null }
      }
    }

    const entries = await prisma.dentalChartEntry.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ toothNumber: 'asc' }, { diagnosedDate: 'desc' }],
    })

    // Group entries by tooth number for easier consumption
    const chartData: Record<number, any[]> = {}
    entries.forEach((entry) => {
      if (!chartData[entry.toothNumber]) {
        chartData[entry.toothNumber] = []
      }
      chartData[entry.toothNumber].push(entry)
    })

    return NextResponse.json({
      entries,
      chartData,
      patientId,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching dental chart:', error)
    return NextResponse.json({ error: 'Failed to fetch dental chart' }, { status: 500 })
  }
}

// POST - Create new dental chart entry
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('clinical:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      patientId,
      toothNumber,
      condition,
      severity,
      mesial,
      distal,
      occlusal,
      buccal,
      lingual,
      notes,
      toothNotation,
    } = body

    // Validate required fields
    if (!patientId || !toothNumber || !condition) {
      return NextResponse.json(
        { error: 'Patient ID, tooth number, and condition are required' },
        { status: 400 }
      )
    }

    // FDI notation, permanent (11–48) or primary (51–85). The list here was
    // permanent teeth only, so tooth 75 on an eleven-year-old was refused
    // (bug report 12 Oct, finding 55).
    if (!isTooth(toothNumber)) {
      return NextResponse.json(
        { error: `Invalid tooth number. ${TOOTH_NUMBER_HINT}` },
        { status: 400 }
      )
    }

    // Check if patient exists and belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // If condition is MISSING or EXTRACTION, mark previous entries as resolved
    if (['MISSING', 'EXTRACTION'].includes(condition)) {
      await prisma.dentalChartEntry.updateMany({
        where: {
          patientId,
          hospitalId,
          toothNumber,
          resolvedDate: null,
        },
        data: {
          resolvedDate: new Date(),
        },
      })
    }

    // Create new entry
    const entry = await prisma.dentalChartEntry.create({
      data: {
        hospitalId,
        patientId,
        toothNumber,
        toothNotation: toothNotation || String(toothNumber),
        condition,
        severity: severity || 'MILD',
        mesial: mesial || false,
        distal: distal || false,
        occlusal: occlusal || false,
        buccal: buccal || false,
        lingual: lingual || false,
        notes: notes || null,
        // Who charted it. Without this a finding is an assertion about a
        // patient's mouth that nobody is standing behind.
        recordedById: session?.user?.id ?? null,
        diagnosedDate: new Date(),
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
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    // An unknown condition or severity is a 400 naming the field, not a 500.
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating dental chart entry:', error)
    return NextResponse.json({ error: 'Failed to create dental chart entry' }, { status: 500 })
  }
}
