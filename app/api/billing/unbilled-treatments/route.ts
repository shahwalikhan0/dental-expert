import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { BILLABLE_TREATMENT_STATUSES, BILLED_ON_LIVE_INVOICE } from '@/lib/invoice-settlement'
import { clinicTimezone, withWallClock } from '@/lib/appointment-time'

/**
 * GET - What a patient has had done and not yet been billed for.
 *
 * `?patientId=` names the patient. `?appointmentId=` may be given instead, or
 * as well: the New Invoice page opened from a visit (`/billing/invoices/new?
 * appointmentId=…`) gets the visit's patient and a line describing the visit
 * from here, so it can say "For the visit on 14 Oct with Dr Khan" without the
 * desk needing `appointments:read` — an accountant raising the bill has no
 * other reason to hold it.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    let patientId = searchParams.get('patientId')
    const appointmentId = searchParams.get('appointmentId')

    let appointment: {
      id: string
      appointmentNo: string
      startsAt: Date
      scheduledDate: string
      scheduledTime: string
      doctor: string | null
    } | null = null

    if (appointmentId) {
      const found = await prisma.appointment.findFirst({
        where: { id: appointmentId, hospitalId },
        select: {
          id: true,
          appointmentNo: true,
          startsAt: true,
          patientId: true,
          doctor: { select: { firstName: true, lastName: true } },
        },
      })
      if (!found) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
      }
      if (!found.patientId) {
        // A walk-in visitor's visit: there is no patient record to bill yet.
        return NextResponse.json(
          { error: 'This visit is a walk-in with no patient record. Register them first.' },
          { status: 409 }
        )
      }
      if (patientId && patientId !== found.patientId) {
        return NextResponse.json(
          { error: 'That appointment is another patient’s' },
          { status: 409 }
        )
      }
      patientId = found.patientId
      const timezone = await clinicTimezone(prisma, hospitalId)
      const clock = withWallClock(found, timezone)
      appointment = {
        id: found.id,
        appointmentNo: found.appointmentNo,
        startsAt: found.startsAt,
        scheduledDate: clock.scheduledDate,
        scheduledTime: clock.scheduledTime,
        doctor: found.doctor ? `Dr. ${found.doctor.firstName} ${found.doctor.lastName}` : null,
      }
    }

    if (!patientId) {
      return NextResponse.json({ error: 'Patient ID is required' }, { status: 400 })
    }

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId, hospitalId },
      select: {
        id: true,
        patientId: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
      },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Treatments not on any invoice that is still live. The rule is shared
    // with the invoice routes, which refuse a treatment already billed, so a
    // treatment listed here is one they will accept — and one whose invoice
    // was cancelled comes back here to be billed again (findings 13 and 17).
    // The statuses are shared with them too (invoice review 4.1).
    const treatments = await prisma.treatment.findMany({
      where: {
        hospitalId,
        patientId,
        status: { in: [...BILLABLE_TREATMENT_STATUSES] },
        invoiceItems: {
          none: BILLED_ON_LIVE_INVOICE,
        },
      },
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
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Format treatments for invoice creation
    const unbilledItems = treatments.map((treatment) => ({
      treatmentId: treatment.id,
      treatmentNo: treatment.treatmentNo,
      // The visit it was done at, so the page can mark this visit's work.
      appointmentId: treatment.appointmentId ?? null,
      description: treatment.procedure
        ? `${treatment.procedure.name} (${treatment.procedure.code})`
        : 'Treatment',
      procedure: treatment.procedure,
      doctor: treatment.doctor
        ? `Dr. ${treatment.doctor.firstName} ${treatment.doctor.lastName}`
        : null,
      toothNumbers: treatment.toothNumbers,
      completedAt: treatment.endTime,
      status: treatment.status,
      quantity: 1,
      // The treatment's price: its plan item's estimate or the procedure's
      // base price when it was recorded (api/treatments). `cost` is required,
      // so the procedure's *current* base price is never the answer — the
      // `cost || basePrice` this replaced only looked as if it could fall back.
      unitPrice: Number(treatment.cost),
      // Taxable unless marked otherwise. Neither the procedure nor the clinic
      // settings carry an exemption flag, so there is nothing to read one
      // from; with the clinic's tax off (the default), it charges nothing.
      taxable: true,
    }))

    // Calculate total unbilled amount
    const totalUnbilled = unbilledItems.reduce((sum, item) => sum + item.unitPrice, 0)

    return NextResponse.json({
      patient,
      appointment,
      treatments: unbilledItems,
      summary: {
        totalTreatments: unbilledItems.length,
        totalUnbilled,
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching unbilled treatments:', error)
    return NextResponse.json({ error: 'Failed to fetch unbilled treatments' }, { status: 500 })
  }
}
