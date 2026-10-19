import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

// GET — single prescription with medications
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const prescription = await prisma.prescription.findFirst({
      where: { id, hospitalId },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            dateOfBirth: true,
            gender: true,
            address: true,
            city: true,
            medicalHistory: {
              // What the printed sheet's Clinical History column lists.
              select: {
                // allergies: true, // Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
                conditions: true,
                currentMedications: true,
                isPregnant: true,
                pregnancyWeeks: true,
                previousDentalWork: true,
              },
            },
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
            licenseNumber: true,
          },
        },
        medications: {
          include: { medication: { select: { id: true, name: true, genericName: true } } },
        },
        // Provenance for the reader of the record: the wording it started
        // from, and what was being treated at the time. Neither is the source
        // of the medicines below — those were copied at issue.
        template: { select: { id: true, name: true } },
        treatment: {
          select: {
            id: true,
            treatmentNo: true,
            procedure: { select: { name: true } },
          },
        },
      },
    })

    if (!prescription) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    // Also fetch hospital info for the print view
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: {
        name: true,
        tagline: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        postalCode: true,
        logo: true,
        registrationNo: true,
      },
    })

    return NextResponse.json({ success: true, data: prescription, hospital })
  } catch (err: any) {
    console.error('Error fetching prescription:', err)
    // Never `err.message`: it carries Prisma's query and the server's paths.
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to fetch prescription' }, { status: 500 })
    )
  }
}

// DELETE — delete prescription
//
// `clinical:delete`, as for every other clinical record, not `clinical:write`.
// It used to be write, so a dental assistant — who may not write a
// prescription — could destroy a dentist's, and nothing recorded that they had
// (bug report 16 Oct, finding 4).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, user } = await requirePermission('clinical:delete')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await prisma.prescription.findFirst({
      where: { id, hospitalId },
      include: {
        medications: {
          select: {
            medicationName: true,
            dosage: true,
            frequency: true,
            duration: true,
            quantity: true,
          },
        },
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    await prisma.prescription.delete({ where: { id } })

    // Recorded with what it said, since the row itself is gone.
    void recordAudit({
      hospitalId,
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.PRESCRIPTION_DELETED,
      entityType: 'Prescription',
      entityId: id,
      oldValues: {
        prescriptionNo: existing.prescriptionNo,
        patientId: existing.patientId,
        doctorId: existing.doctorId,
        diagnosis: existing.diagnosis,
        medications: existing.medications,
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ success: true, message: 'Prescription deleted' })
  } catch (err: any) {
    console.error('Error deleting prescription:', err)
    // Never `err.message`: it carries Prisma's query and the server's paths.
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to delete prescription' }, { status: 500 })
    )
  }
}
