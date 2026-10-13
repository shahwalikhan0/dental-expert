import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { formatTeeth, parseTeeth } from '@/lib/teeth'
import { holderCan } from '@/lib/rbac'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import {
  describeAllergyClashes,
  prescriptionAllergyClashes,
  prescriptionLinesRefusal,
  type PrescriptionLineInput,
} from '@/lib/prescribing'

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
    // Never `err.message`: a Prisma error carries the server's build path,
    // the ids and the query (bug report 12 Oct, finding 4).
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to fetch prescriptions' }, { status: 500 })
    )
  }
}

// POST — create prescription
export async function POST(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('clinical:write')
  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /*
   * Only a dentist prescribes (bug report 12 Oct, finding 36).
   *
   * `clinical:write` alone let the administrator and the dental assistants
   * prescribe, and the prescriber recorded is whoever is signed in — so the
   * administrator, who is not a dentist, was the prescriber on a real
   * prescription. Prescribing is the same kind of act as signing a note, and
   * `clinical:sign` is already held by dentists only, including an owner who
   * holds DOCTOR as a second, clinical role.
   */
  if (!holderCan({ role: user.role, clinicalRole: user.clinicalRole }, 'clinical:sign')) {
    await recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      entityType: 'Permission',
      entityId: 'clinical:sign',
      newValues: { permission: 'clinical:sign', role: user.role, attempted: 'prescription' },
      ...requestContext(request.headers),
    })
    return NextResponse.json({ error: 'Only a dentist can write a prescription.' }, { status: 403 })
  }

  try {
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'The request was not valid JSON.' }, { status: 400 })
    }
    const { patientId, diagnosis, notes, validUntil, medications, templateId, treatmentId } =
      body ?? {}

    if (!patientId || typeof patientId !== 'string') {
      return NextResponse.json(
        { error: 'Patient and at least one medication are required' },
        { status: 400 }
      )
    }

    /*
     * Every row checked before anything is read or written.
     *
     * An empty row used to go straight to Prisma, which answered with a 500
     * whose message — returned to the browser — held the server's build path,
     * the clinic, patient and doctor ids and the whole query (finding 4). Now
     * it is a 400 that names the row and the field, in the words the screen
     * uses.
     */
    const lineRefusal = prescriptionLinesRefusal(medications)
    if (lineRefusal) return NextResponse.json({ error: lineRefusal }, { status: 400 })
    const lines = medications as PrescriptionLineInput[]

    let validUntilDate: Date | null = null
    if (validUntil) {
      validUntilDate = new Date(validUntil)
      if (Number.isNaN(validUntilDate.getTime())) {
        return NextResponse.json(
          { error: 'validUntil is not a date. Use YYYY-MM-DD.' },
          { status: 400 }
        )
      }
    }

    // The patient, with the allergies the check below reads.
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
      select: { id: true, medicalHistory: { select: { allergies: true } } },
    })
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
     * The catalogue entries the rows link to.
     *
     * Each must be this clinic's and still active: a drug retired from the
     * catalogue is refused here however it arrived — a stale screen, a
     * template saved before it was retired, a script (finding 48). The generic
     * name is read from here rather than trusted from the request, because it
     * is half of what the allergy check below matches on.
     */
    const linkedIds = [
      ...new Set(lines.map((m) => m.medicationId).filter((id): id is string => !!id)),
    ]
    const catalogue = linkedIds.length
      ? await prisma.medication.findMany({
          where: { hospitalId, id: { in: linkedIds } },
          select: { id: true, name: true, genericName: true, isActive: true },
        })
      : []
    const catalogueById = new Map(catalogue.map((m) => [m.id, m]))

    for (let i = 0; i < lines.length; i++) {
      const id = lines[i].medicationId as string | null | undefined
      if (!id) continue
      const entry = catalogueById.get(id)
      const label = `Medication ${i + 1} (${String(lines[i].medicationName).trim()})`
      if (!entry) {
        return NextResponse.json(
          { error: `${label} is not in this clinic's drug catalogue.` },
          { status: 400 }
        )
      }
      if (!entry.isActive) {
        return NextResponse.json(
          {
            error: `${label} has been deactivated in the drug catalogue and cannot be prescribed. Choose another medicine.`,
          },
          { status: 400 }
        )
      }
    }

    /*
     * The allergy check, on the server (finding 35).
     *
     * It existed only on the New Prescription screen, so the API, a template
     * or any other screen prescribed amoxicillin to a patient recorded as
     * allergic to penicillin with a 201 and no word. Same matching as the
     * screen (lib/prescribing.ts). Like the screen it does not refuse outright
     * — a prescriber may have a reason — but it will not go through unless
     * the request says, in so many words, that the prescriber has seen the
     * clash and means it.
     */
    const clashes = prescriptionAllergyClashes(
      patient.medicalHistory?.allergies,
      lines.map((m) => ({
        name: String(m.medicationName),
        genericName: m.medicationId
          ? (catalogueById.get(m.medicationId as string)?.genericName ?? null)
          : null,
      }))
    )
    const acknowledged = body.allergyAcknowledged === true
    if (clashes.length > 0 && !acknowledged) {
      return NextResponse.json(
        {
          error: `This prescription clashes with a recorded allergy: ${describeAllergyClashes(clashes)}. Confirm to prescribe anyway.`,
          code: 'ALLERGY_CLASH',
          allergyClashes: clashes,
        },
        { status: 409 }
      )
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

    // The prescriber is whoever is signed in, so their staff record is needed
    // before anything is numbered.
    const staff = await prisma.staff.findFirst({ where: { userId: user.id, hospitalId } })
    if (!staff) {
      return NextResponse.json({ error: 'Doctor staff record not found' }, { status: 400 })
    }

    /*
     * Numbered and written in one transaction, after every check above.
     *
     * The number used to be allocated before the staff lookup and before the
     * write, so every refused or failed request used up an RX number and left
     * a gap in the series. Inside the transaction, a write that fails rolls
     * the counter back with it.
     *
     * One counter per clinic per year, allocated atomically: two doctors
     * prescribing in the same second get two numbers rather than one number
     * and a unique-constraint failure.
     */
    const year = new Date().getFullYear()
    const prescription = await prisma.$transaction(async (tx) => {
      const prescriptionNo = await nextInSeries(tx, {
        hospitalId,
        prefix: `RX${year}`,
        width: 4,
        currentMax: async () => {
          const last = await tx.prescription.findFirst({
            where: { hospitalId, prescriptionNo: { startsWith: `RX${year}` } },
            orderBy: { prescriptionNo: 'desc' },
            select: { prescriptionNo: true },
          })
          return trailingNumber(last?.prescriptionNo, 4)
        },
      })

      return tx.prescription.create({
        data: {
          hospitalId,
          prescriptionNo,
          patientId,
          doctorId: staff.id,
          templateId: templateId || null,
          treatmentId: treatmentId || null,
          toothNumbers,
          diagnosis: typeof diagnosis === 'string' && diagnosis.trim() ? diagnosis : null,
          notes: typeof notes === 'string' && notes.trim() ? notes : null,
          validUntil: validUntilDate,
          medications: {
            create: lines.map((m) => ({
              medicationId: (m.medicationId as string | null | undefined) || null,
              medicationName: String(m.medicationName).trim(),
              dosage: String(m.dosage).trim(),
              frequency: String(m.frequency).trim(),
              duration: String(m.duration).trim(),
              route: (typeof m.route === 'string' && m.route.trim()) || 'Oral',
              timing: (typeof m.timing === 'string' && m.timing.trim()) || null,
              quantity:
                m.quantity === undefined || m.quantity === null || m.quantity === ''
                  ? null
                  : Number(m.quantity),
              instructions: (typeof m.instructions === 'string' && m.instructions.trim()) || null,
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
    })

    // A prescription is a clinical act with legal weight (finding 24). An
    // allergy clash the prescriber chose to override is the part of it most
    // likely to be asked about later, so it is recorded with the entry.
    await recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.PRESCRIPTION_CREATED,
      entityType: 'Prescription',
      entityId: prescription.id,
      newValues: {
        prescriptionNo: prescription.prescriptionNo,
        patientId,
        doctorId: staff.id,
        medications: lines.map((m) => String(m.medicationName).trim()),
        templateId: templateId || null,
        treatmentId: treatmentId || null,
        ...(clashes.length > 0
          ? {
              allergyAcknowledged: true,
              allergyClashes: clashes.map((c) => ({
                drug: c.drug,
                allergy: c.allergy,
                note: c.note ?? null,
              })),
            }
          : {}),
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ success: true, data: prescription }, { status: 201 })
  } catch (err: any) {
    console.error('Error creating prescription:', err)
    // Never `err.message` (finding 4): see the GET handler above.
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to create prescription' }, { status: 500 })
    )
  }
}
