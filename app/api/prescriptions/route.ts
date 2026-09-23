import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { formatTeeth, parseTeeth } from '@/lib/teeth'

// GET — list prescriptions
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sp = request.nextUrl.searchParams
    const search = sp.get('search') || ''
    const patientId = sp.get('patientId') || ''
    const doctorId = sp.get('doctorId') || ''
    const page = parseInt(sp.get('page') || '1')
    const limit = parseInt(sp.get('limit') || '20')
    const skip = (page - 1) * limit

    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { prescriptionNo: { contains: search, mode: 'insensitive' } },
        {
          patient: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { patientId: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ]
    }

    if (patientId) where.patientId = patientId
    if (doctorId) where.doctorId = doctorId

    const [prescriptions, total] = await Promise.all([
      prisma.prescription.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
              dateOfBirth: true,
            },
          },
          doctor: { select: { id: true, firstName: true, lastName: true } },
          // Both are provenance for the reader: which wording this came from,
          // and what was being treated at the time.
          template: { select: { id: true, name: true } },
          treatment: {
            select: {
              id: true,
              treatmentNo: true,
              toothNumbers: true,
              procedure: { select: { name: true } },
            },
          },
          medications: {
            include: { medication: { select: { id: true, name: true, genericName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.prescription.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: prescriptions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err: any) {
    console.error('Error fetching prescriptions:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to fetch prescriptions' },
      { status: 500 }
    )
  }
}

// POST — create prescription
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('clinical:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { patientId, diagnosis, notes, validUntil, medications, templateId, treatmentId } = body

    if (!patientId || !medications || medications.length === 0) {
      return NextResponse.json(
        { error: 'Patient and at least one medication are required' },
        { status: 400 }
      )
    }

    // Verify patient
    const patient = await prisma.patient.findFirst({ where: { id: patientId, hospitalId } })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    /*
     * A template is optional, and a retired one is still a valid source.
     *
     * Only its existence in this clinic is checked. Nothing is read from it:
     * the medicines were copied onto the request by the screen that applied
     * it, and re-reading them here would reintroduce exactly the coupling this
     * design exists to avoid — a template edited tomorrow changing what was
     * prescribed today.
     */
    if (templateId) {
      const template = await prisma.prescriptionTemplate.findFirst({
        where: { id: templateId, hospitalId },
        select: { id: true },
      })
      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }
    }

    /*
     * A treatment, if one was named, must belong to this patient.
     *
     * Scoped by `patientId` as well as `hospitalId`: attaching Mrs Khan's
     * prescription to Mr Ahmed's extraction would put a wrong clinical reason
     * on a drug record, and it is the sort of thing a mistyped id does
     * silently.
     */
    let teethFromTreatment: string | null = null
    if (treatmentId) {
      const treatment = await prisma.treatment.findFirst({
        where: { id: treatmentId, hospitalId, patientId },
        select: { id: true, toothNumbers: true },
      })
      if (!treatment) {
        return NextResponse.json(
          { error: 'That treatment does not belong to this patient' },
          { status: 400 }
        )
      }
      teethFromTreatment = treatment.toothNumbers
    }

    /*
     * The teeth, normalised through one parser.
     *
     * Falls back to the treatment's own teeth when the screen sent none, so
     * prescribing from a treatment records what was treated without the
     * dentist retyping it. `formatTeeth` drops anything that is not a
     * permanent FDI tooth rather than storing it — see lib/teeth.ts.
     */
    const toothNumbers =
      formatTeeth(parseTeeth(body.toothNumbers)) ?? formatTeeth(parseTeeth(teethFromTreatment))

    // One counter per clinic per year, allocated atomically: two doctors
    // prescribing in the same second get two numbers rather than one number
    // and a unique-constraint failure.
    const year = new Date().getFullYear()
    const prescriptionNo = await nextInSeries(prisma, {
      hospitalId,
      prefix: `RX${year}`,
      width: 4,
      currentMax: async () => {
        const last = await prisma.prescription.findFirst({
          where: { hospitalId, prescriptionNo: { startsWith: `RX${year}` } },
          orderBy: { prescriptionNo: 'desc' },
          select: { prescriptionNo: true },
        })
        return trailingNumber(last?.prescriptionNo, 4)
      },
    })

    // Get doctor's staff record
    const staff = await prisma.staff.findFirst({ where: { userId: session!.user!.id, hospitalId } })
    if (!staff) {
      return NextResponse.json({ error: 'Doctor staff record not found' }, { status: 400 })
    }

    const prescription = await prisma.prescription.create({
      data: {
        hospitalId,
        prescriptionNo,
        patientId,
        doctorId: staff.id,
        templateId: templateId || null,
        treatmentId: treatmentId || null,
        toothNumbers,
        diagnosis: diagnosis || null,
        notes: notes || null,
        validUntil: validUntil ? new Date(validUntil) : null,
        medications: {
          create: medications.map((m: any) => ({
            medicationId: m.medicationId || null,
            medicationName: m.medicationName,
            dosage: m.dosage,
            frequency: m.frequency,
            duration: m.duration,
            route: m.route || 'Oral',
            timing: m.timing || null,
            quantity: m.quantity || null,
            instructions: m.instructions || null,
          })),
        },
      },
      include: {
        patient: { select: { patientId: true, firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
        template: { select: { id: true, name: true } },
        treatment: { select: { id: true, treatmentNo: true } },
        medications: true,
      },
    })

    return NextResponse.json({ success: true, data: prescription }, { status: 201 })
  } catch (err: any) {
    console.error('Error creating prescription:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to create prescription' },
      { status: 500 }
    )
  }
}
