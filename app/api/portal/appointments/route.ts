/**
 * GET /api/portal/appointments — when they are next in, and when they came before.
 *
 * Read-only: no cancelling, no rescheduling. A patient who needs to change one
 * telephones the clinic, which is what the booking confirmation already tells
 * them to do.
 *
 * Only this patient's own appointments, and only ones on their patient record.
 * A walk-in visit booked before they were registered belongs to a `Visitor`
 * row and is deliberately not reachable here — the portal is scoped to a
 * patient record, and a visitor is by definition somebody the clinic had not
 * yet tied to one.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePortalPatient } from '@/lib/portal/auth'
import { clinicTimezone, wallClockIn } from '@/lib/appointment-time'

export async function GET() {
  const { error, caller } = await requirePortalPatient()
  if (error) return error

  const timezone = await clinicTimezone(prisma, caller.patient.hospitalId)

  const appointments = await prisma.appointment.findMany({
    where: {
      patientId: caller.patient.id,
      hospitalId: caller.patient.hospitalId,
    },
    select: {
      id: true,
      appointmentNo: true,
      startsAt: true,
      duration: true,
      status: true,
      appointmentType: true,
      doctor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startsAt: 'desc' },
    take: 100,
  })

  const now = new Date()

  return NextResponse.json({
    success: true,
    data: appointments.map((a) => ({
      id: a.id,
      appointmentNo: a.appointmentNo,
      // The clinic's wall clock, not the server's and not the browser's. A
      // patient told "10:00" must be told the same 10:00 the clinic wrote down.
      ...wallClockIn(a.startsAt, timezone),
      startsAt: a.startsAt,
      upcoming: a.startsAt >= now,
      duration: a.duration,
      status: a.status,
      type: a.appointmentType,
      dentist: `${a.doctor.firstName} ${a.doctor.lastName}`.trim(),
    })),
  })
}
