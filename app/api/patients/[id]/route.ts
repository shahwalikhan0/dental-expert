import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { parseOptionalCNIC } from '@/lib/cnic'
import prisma from '@/lib/prisma'
import { clinicTimezone, withWallClock } from '@/lib/appointment-time'
import { mayBeScoped, patientScopeFilter, OUT_OF_SCOPE_MESSAGE } from '@/lib/patient-scope'
import { readSecuritySettings } from '@/lib/security-settings'
import { noteRecordAccess } from '@/lib/record-access'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { medicalHistoryInput } from '@/lib/medical-history'
import { holderCan } from '@/lib/rbac'
import { knownErrorResponse } from '@/lib/api-errors'
import { buildLedger } from '@/lib/ledger'
import { patientContactProblem } from '@/lib/patient-validation'
import { withoutAiSummary } from '@/lib/patient-record'

// GET /api/patients/[id] - Get a specific patient with all details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('patients:read')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    /**
     * What this caller may be shown beyond the register entry itself.
     *
     * The record used to carry the treatments (diagnosis, findings, procedure
     * notes), prescriptions and dental chart to anybody with `patients:read` —
     * the front desk, the accountant and the lab technician included — while
     * `/api/treatments`, `/api/prescriptions` and `/api/dental-chart` refused
     * the same people (bug report 12 Oct, finding 5). The clinical parts now
     * need `clinical:read`, as they do everywhere else, and the invoices need
     * `billing:read`, as the patient's ledger does. Fetched only when they
     * will be sent, rather than fetched and then dropped.
     */
    const holder = { role: user.role, clinicalRole: user.clinicalRole }
    const canReadClinical = holderCan(holder, 'clinical:read')
    const canReadBilling = holderCan(holder, 'billing:read')

    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
      include: {
        // Where this record went, if it was merged away as a duplicate. Its
        // patient ID is on paper the clinic has already handed out, so opening
        // it has to say where the history is rather than show an empty record.
        mergedInto: {
          select: { id: true, patientId: true, firstName: true, lastName: true },
        },
        medicalHistory: true,
        // Who settles this patient's bills, and who this patient settles for.
        // Both directions, because the record has to be able to say "her
        // mother pays for this" and "she pays for these three".
        guarantor: {
          select: { id: true, patientId: true, firstName: true, lastName: true, phone: true },
        },
        dependants: {
          select: { id: true, patientId: true, firstName: true, lastName: true, phone: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        },
        appointments: {
          take: 10,
          orderBy: { startsAt: 'desc' },
          include: {
            doctor: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        _count: {
          select: {
            appointments: true,
            treatments: true,
            invoices: true,
            prescriptions: true,
          },
        },
      },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    /**
     * "Own patients only" (§10), when the clinic has turned it on.
     *
     * Checked after the record is found rather than folded into the query, so
     * that the refusal can say *why*. A 403 with a reason is the right answer
     * here and a 404 would be wrong: this patient exists, the person asking is
     * a clinician at the same clinic, and pretending the record is not there
     * would send them to reception to report a missing patient.
     */
    if (mayBeScoped(user)) {
      const { restrictToOwnPatients } = await readSecuritySettings(prisma, hospitalId)
      const scope = patientScopeFilter(
        {
          userId: user.id,
          staffId: user.staffId,
          role: user.role,
          clinicalRole: user.clinicalRole,
        },
        restrictToOwnPatients
      )

      if (scope) {
        const mine = await prisma.patient.findFirst({
          where: { id, hospitalId, ...scope },
          select: { id: true },
        })
        if (!mine) {
          return NextResponse.json({ error: OUT_OF_SCOPE_MESSAGE }, { status: 403 })
        }
      }
    }

    // Who read whose record, and when. See lib/record-access.ts for why this
    // is here and not on the list endpoint. Not awaited: the record has already
    // been fetched, and a log write must never be what stops it being shown.
    void noteRecordAccess({
      db: prisma,
      hospitalId,
      userId: user.id,
      patientId: patient.id,
      kind: 'patient',
      via: 'record',
      ...requestContext(req.headers),
    })

    const [timezone, treatments, prescriptions, dentalChart, invoices] = await Promise.all([
      clinicTimezone(prisma, hospitalId),
      canReadClinical
        ? prisma.treatment.findMany({
            where: { patientId: id, hospitalId },
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: {
              procedure: { select: { name: true, category: true } },
              doctor: { select: { firstName: true, lastName: true } },
            },
          })
        : null,
      // The medicines this patient was told to take, newest first. Read on
      // the record rather than fetched when the tab opens, like treatments
      // beside it: a prescription list is short, and a clinician opening a
      // patient is as likely to want it as the treatment history.
      canReadClinical
        ? prisma.prescription.findMany({
            where: { patientId: id, hospitalId },
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              prescriptionNo: true,
              diagnosis: true,
              toothNumbers: true,
              createdAt: true,
              doctor: { select: { firstName: true, lastName: true } },
              // What was prescribed, as it was written at the time — see the
              // note on PrescriptionMedication. Not read through `medication`,
              // which is the catalogue entry and may since have been edited.
              medications: {
                select: { id: true, medicationName: true, dosage: true, frequency: true },
              },
            },
          })
        : null,
      canReadClinical
        ? prisma.dentalChartEntry.findMany({ where: { patientId: id, hospitalId } })
        : null,
      canReadBilling
        ? prisma.invoice.findMany({
            where: { patientId: id, hospitalId },
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: { payments: true },
          })
        : null,
    ])

    const { _count, ...record } = withoutAiSummary(patient)

    return NextResponse.json({
      success: true,
      patient: {
        ...record,
        appointments: patient.appointments.map((a) => withWallClock(a, timezone)),
        // Absent, not empty, for a caller who may not read them: an empty list
        // would say "no treatments", which is a clinical statement of its own.
        ...(canReadClinical && { treatments, prescriptions, dentalChart }),
        ...(canReadBilling && { invoices }),
        _count: {
          appointments: _count.appointments,
          ...(canReadClinical && {
            treatments: _count.treatments,
            prescriptions: _count.prescriptions,
          }),
          ...(canReadBilling && { invoices: _count.invoices }),
        },
      },
    })
  } catch (err: unknown) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Error fetching patient:', err)
    return NextResponse.json({ error: 'Failed to fetch patient' }, { status: 500 })
  }
}

// PUT /api/patients/[id] - Update a patient, or bring a deactivated one back
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('patients:write')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await req.json()

    // Check if patient exists and belongs to this hospital
    const existingPatient = await prisma.patient.findFirst({
      where: { id, hospitalId },
    })

    if (!existingPatient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      alternatePhone,
      dateOfBirth,
      gender,
      bloodGroup,
      address,
      city,
      state,
      postalCode,
      cnic,
      occupation,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
      medicalHistory,
      isActive,
    } = body

    /**
     * The way back from a deactivation (bug report 12 Oct, finding 22).
     *
     * Deactivating is `DELETE`, behind `patients:delete`; there was no way to
     * undo it, so a patient deactivated by mistake — or one who simply came
     * back after two years — had to be registered again under a new number,
     * with their history stranded on the old one. `{ isActive: true }` brings
     * the record back. It is a `patients:write` act, the same as registering
     * them would have been.
     *
     * Only `true` is accepted here. Deactivating has checks of its own — an
     * outstanding balance, a patient in the chair — and goes through DELETE so
     * that nothing can skip them by sending `false` with an address change.
     */
    if (isActive !== undefined && isActive !== true) {
      return NextResponse.json(
        { error: 'To deactivate a patient, use Deactivate on their record.' },
        { status: 400 }
      )
    }
    const reactivating = isActive === true && !existingPatient.isActive
    if (reactivating && existingPatient.mergedIntoId) {
      // A merged-away duplicate is inactive because its history now lives on
      // another record. Bringing it back would make two records again.
      return NextResponse.json(
        {
          error:
            'This record was merged into another as a duplicate. Open the record it was merged into instead.',
        },
        { status: 409 }
      )
    }

    // Required on registration, so it may not be blanked on an edit either.
    for (const [value, label] of [
      [firstName, 'First name'],
      [lastName, 'Last name'],
      [phone, 'Phone'],
    ] as const) {
      if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
        return NextResponse.json({ error: `${label} cannot be blank` }, { status: 400 })
      }
    }

    // Finding 30: a date of birth in the future, and any text as a phone
    // number or an email address. See lib/patient-validation.ts.
    const contactProblem = patientContactProblem({
      phone,
      alternatePhone,
      emergencyContactPhone,
      email,
      dateOfBirth,
    })
    if (contactProblem) {
      return NextResponse.json({ error: contactProblem }, { status: 400 })
    }

    // The CNIC was accepted by the edit form but silently dropped here, so a
    // corrected number never reached the database.
    const cnicResult = parseOptionalCNIC(cnic)
    if (!cnicResult.ok) {
      return NextResponse.json({ error: cnicResult.error }, { status: 400 })
    }
    const parsedCnic = cnicResult.value

    if (parsedCnic) {
      const holder = await prisma.patient.findFirst({
        where: { hospitalId, cnic: parsedCnic, id: { not: id } },
        select: { id: true, patientId: true, firstName: true, lastName: true },
      })
      if (holder) {
        return NextResponse.json(
          {
            error: `That CNIC is already registered to ${holder.firstName} ${holder.lastName} (${holder.patientId})`,
            existingPatient: holder,
          },
          { status: 409 }
        )
      }
    }

    const patient = await prisma.patient.update({
      where: { id },
      data: {
        firstName,
        lastName,
        email,
        phone,
        alternatePhone,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        gender,
        bloodGroup,
        address,
        city,
        state,
        postalCode,
        ...(cnic !== undefined && { cnic: parsedCnic }),
        occupation,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelation,
        ...(reactivating && { isActive: true }),
        /*
         * Allergies, conditions and current medications.
         *
         * An upsert rather than an update, because most patients on the books
         * were registered before any screen asked for a history and so have no
         * row to update. Absent from the body means "leave it alone" — the
         * edit form always sends it, but other callers of this route do not,
         * and they should not be able to wipe a record's allergies by omission.
         *
         * Only the three lists are written. Everything else on the table — the
         * habits, pregnancy, the dental-anxiety score — belongs to the intake
         * questionnaire and is left exactly as it was.
         */
        ...(medicalHistory !== undefined && {
          medicalHistory: {
            upsert: {
              create: medicalHistoryInput(medicalHistory),
              update: medicalHistoryInput(medicalHistory),
            },
          },
        }),
      },
    })

    if (reactivating) {
      void recordAudit({
        hospitalId,
        userId: user.id,
        action: AUDIT_ACTIONS.PATIENT_REACTIVATED,
        entityType: 'Patient',
        entityId: id,
        oldValues: { isActive: false },
        newValues: { isActive: true, patientId: existingPatient.patientId },
        ...requestContext(req.headers),
      })
    }

    return NextResponse.json({
      success: true,
      patient: withoutAiSummary(patient),
    })
  } catch (err: unknown) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Error updating patient:', err)
    return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 })
  }
}

/** The visit states that mean the patient is in the building right now. */
const IN_CLINIC_STATUSES = ['CHECKED_IN', 'IN_PROGRESS'] as const

/** What deactivation does to bookings it cancels, so they say why. */
const DEACTIVATION_REASON = 'Patient deactivated'

// DELETE /api/patients/[id] - Soft delete (deactivate) a patient
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('patients:delete')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
      select: { id: true, patientId: true, firstName: true, lastName: true, isActive: true },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }
    if (!patient.isActive) {
      return NextResponse.json({ error: 'This patient is already inactive' }, { status: 409 })
    }

    const name = `${patient.firstName} ${patient.lastName}`

    /**
     * Two reasons not to, each refused with what to do about it (bug report
     * 12 Oct, finding 22).
     *
     * **Money owed.** A deactivated patient vanished from the register while
     * receivables went on carrying the debt, so the desk chasing it could no
     * longer open the record it belonged to. The amount is the one the
     * receivables screen shows — the open balances on the patient's chargeable
     * invoices, from the same ledger — so the two cannot disagree.
     *
     * **A visit in progress.** Somebody checked in or in the chair is not a
     * patient whose record should close underneath the dentist treating them.
     */
    const [ledger, inClinic] = await Promise.all([
      buildLedger(hospitalId, [id]),
      prisma.appointment.findFirst({
        where: { hospitalId, patientId: id, status: { in: [...IN_CLINIC_STATUSES] } },
        select: { appointmentNo: true, status: true },
      }),
    ])

    const owed = ledger.ageing.total
    if (owed > 0) {
      return NextResponse.json(
        {
          error: `${name} still owes Rs ${owed.toLocaleString('en-PK', { maximumFractionDigits: 2 })}. Settle or cancel the open invoices before deactivating.`,
          balance: owed,
        },
        { status: 409 }
      )
    }

    if (inClinic) {
      return NextResponse.json(
        {
          error: `${name} has a visit in progress (${inClinic.appointmentNo}). Finish or cancel it before deactivating.`,
        },
        { status: 409 }
      )
    }

    /**
     * Their future bookings, cancelled as a cancellation — not by overwriting
     * the notes with "Auto-cancelled", which is what this did, destroying
     * whatever the desk had written there ("Bring old X-rays") and leaving
     * `cancelledAt` and `cancellationReason` empty for every report that reads
     * them.
     */
    const now = new Date()
    const cancelled = await prisma.$transaction(async (tx) => {
      const result = await tx.appointment.updateMany({
        where: {
          patientId: id,
          hospitalId,
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
          startsAt: { gte: now },
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancellationReason: DEACTIVATION_REASON,
        },
      })

      // Soft delete. The record and its history stay; see PUT for the way back.
      await tx.patient.update({
        where: { id },
        data: { isActive: false },
      })

      return result.count
    })

    void recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.PATIENT_DEACTIVATED,
      entityType: 'Patient',
      entityId: id,
      oldValues: { isActive: true },
      newValues: {
        isActive: false,
        patientId: patient.patientId,
        appointmentsCancelled: cancelled,
      },
      ...requestContext(req.headers),
    })

    return NextResponse.json({
      success: true,
      message:
        cancelled > 0
          ? `Patient deactivated. ${cancelled} upcoming appointment${cancelled === 1 ? ' was' : 's were'} cancelled.`
          : 'Patient deactivated successfully',
      appointmentsCancelled: cancelled,
    })
  } catch (err: unknown) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Error deactivating patient:', err)
    return NextResponse.json({ error: 'Failed to deactivate patient' }, { status: 500 })
  }
}
