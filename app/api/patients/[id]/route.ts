import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { parseOptionalCNIC } from '@/lib/cnic'
import prisma from '@/lib/prisma'
import { clinicTimezone, withWallClock } from '@/lib/appointment-time'
import { Prisma } from '@prisma/client'
import { mayBeScoped, patientScopeFilter, OUT_OF_SCOPE_MESSAGE } from '@/lib/patient-scope'
import { readSecuritySettings } from '@/lib/security-settings'
import { noteRecordAccess } from '@/lib/record-access'
import { requestContext } from '@/lib/audit'

// GET /api/patients/[id] - Get a specific patient with all details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('patients:read')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

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
        treatments: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            procedure: {
              select: {
                name: true,
                category: true,
              },
            },
            doctor: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        invoices: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            payments: true,
          },
        },
        documents: {
          where: { isArchived: false },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        dentalChart: true,
        _count: {
          select: {
            appointments: true,
            treatments: true,
            invoices: true,
            documents: true,
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

    const timezone = await clinicTimezone(prisma, hospitalId)

    return NextResponse.json({
      success: true,
      patient: {
        ...patient,
        appointments: patient.appointments.map((a) => withWallClock(a, timezone)),
      },
    })
  } catch (error: any) {
    console.error('Error fetching patient:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch patient' }, { status: 500 })
  }
}

// PUT /api/patients/[id] - Update a patient
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('patients:write')

  if (error || !hospitalId) {
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
    } = body

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
        // Clear cached AI summary so it regenerates on next view
        aiSummary: Prisma.JsonNull,
        aiSummaryAt: null,
      },
    })

    return NextResponse.json({
      success: true,
      patient,
    })
  } catch (error: any) {
    console.error('Error updating patient:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update patient' },
      { status: 500 }
    )
  }
}

// DELETE /api/patients/[id] - Soft delete a patient
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('patients:delete')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Cancel any pending/scheduled appointments for this patient
    await prisma.appointment.updateMany({
      where: {
        patientId: id,
        hospitalId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
      },
      data: {
        status: 'CANCELLED',
        notes: 'Auto-cancelled: Patient deactivated',
      },
    })

    // Soft delete
    await prisma.patient.update({
      where: { id },
      data: { isActive: false },
    })

    return NextResponse.json({
      success: true,
      message: 'Patient deactivated successfully',
    })
  } catch (error: any) {
    console.error('Error deleting patient:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete patient' },
      { status: 500 }
    )
  }
}
