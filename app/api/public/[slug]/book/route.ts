import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DEFAULT_APPOINTMENT_DURATION, findAppointmentConflicts } from '@/lib/appointment-conflicts'
import { prisma } from '@/lib/prisma'
import { instantAt, wallClockIn } from '@/lib/appointment-time'
import { nextAppointmentNo } from '@/lib/numbering'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { readBookingSettings, windowRefusal, WINDOW_MESSAGES } from '@/lib/booking/rules'
import { phoneKey, resolveSubject, subjectColumns } from '@/lib/booking/subject'

/**
 * POST /api/public/[slug]/book — a patient books their own appointment.
 *
 * The one write in this application that nobody is signed in for, which is what
 * every decision below is about.
 *
 * **Anyone may book.** It used to require an existing patient record, matched
 * on phone number, and answer "No patient account found with this phone number"
 * when it found none. That refused the one person a clinic most wants to hear
 * from — somebody new — and it turned a public endpoint into an oracle for
 * "is this number a patient of this practice". A booking from an unknown number
 * now creates a `Visitor`, which is the same record a walk-in gets, and the
 * desk converts or discards it. See lib/booking/subject.ts.
 *
 * **Nothing in the response says which happened.** Known patient or new
 * visitor, the answer is the same.
 *
 * **The rules are the website's, not the desk's.** A minimum notice period, a
 * horizon, and a cap on open bookings per phone number — see
 * lib/booking/rules.ts for why those are different rules rather than a
 * permission.
 *
 * **A double-booking is never waved through.** The staff routes honour a WARN
 * policy that lets the desk overbook deliberately; overbooking is a decision
 * for the front desk, not for whoever is on the website.
 */

/**
 * Every message is one a patient can act on.
 *
 * `error` rather than only a message on each rule, because a missing field
 * otherwise produces Zod's own "expected string, received undefined" — which
 * is a sentence written for whoever wrote the form, shown to whoever is
 * filling it in.
 */
const bookingSchema = z.object({
  name: z
    .string({ error: 'Please give your name' })
    .trim()
    .min(2, 'Please give your name')
    .max(120, 'That name is too long'),
  phone: z
    .string({ error: 'Please give a phone number' })
    .trim()
    .min(7, 'Please give a phone number')
    .max(20, 'That phone number is too long'),
  doctorId: z.string({ error: 'Please choose a dentist' }).min(1, 'Please choose a dentist'),
  date: z
    .string({ error: 'Please choose a date' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a date'),
  time: z.string({ error: 'Please choose a time' }).regex(/^\d{2}:\d{2}$/, 'Please choose a time'),
  reason: z.string().trim().max(500, 'That is too long').optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    const parsed = bookingSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Please check the form' },
        { status: 400 }
      )
    }

    const { name, phone, doctorId, date, time, reason } = parsed.data

    const hospital = await prisma.hospital.findUnique({
      where: { slug },
      select: { id: true, isActive: true, patientPortalEnabled: true, timezone: true },
    })

    if (!hospital || !hospital.isActive) {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
    }

    if (!hospital.patientPortalEnabled) {
      return NextResponse.json({ error: 'Online booking is not enabled' }, { status: 403 })
    }

    const hospitalId = hospital.id

    // The time the patient picked is wall clock on the clinic's own page, so it
    // is resolved against the clinic's zone and stored as the instant.
    const startsAt = instantAt(date, time, hospital.timezone)
    if (!startsAt) {
      return NextResponse.json({ error: 'That date and time are not valid' }, { status: 400 })
    }

    const settings = await readBookingSettings(prisma, hospitalId)

    const refusal = windowRefusal(startsAt, settings)
    if (refusal) {
      return NextResponse.json({ error: WINDOW_MESSAGES[refusal](settings) }, { status: 400 })
    }

    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    })

    if (!doctor) {
      return NextResponse.json({ error: 'That dentist is not available' }, { status: 404 })
    }

    /**
     * How many open bookings this number already holds.
     *
     * The only abuse control on an unauthenticated write. It counts across
     * patients and visitors alike, on the last nine digits, so somebody cannot
     * get past it by writing the number a different way.
     */
    const key = phoneKey(phone)
    const openForPhone = await prisma.appointment.count({
      where: {
        hospitalId,
        startsAt: { gte: new Date() },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        OR: [{ visitor: { phone: { endsWith: key } } }, { patient: { phone: { endsWith: key } } }],
      },
    })

    if (openForPhone >= settings.maxOpenPerPhone) {
      return NextResponse.json(
        {
          error:
            'There are already several appointments booked against this number. Please telephone the clinic.',
        },
        { status: 429 }
      )
    }

    // FR-004. Checked before the transaction for a fast, clear refusal, and the
    // unique slot is not guaranteed by it — two bookings landing in the same
    // millisecond is a race the clinic resolves at the desk, which is the same
    // thing that happens when two people telephone at once.
    const conflicts = await findAppointmentConflicts({
      hospitalId,
      startsAt,
      timezone: hospital.timezone,
      duration: DEFAULT_APPOINTMENT_DURATION,
      doctorId,
    })

    if (conflicts.length > 0) {
      return NextResponse.json(
        { error: 'That time has just been taken. Please choose another slot.' },
        { status: 409 }
      )
    }

    const appointment = await prisma.$transaction(async (tx) => {
      // A visitor is created here rather than before, so a visitor row is never
      // left behind by an appointment that failed to be written.
      const subject = await resolveSubject(tx, { hospitalId, name, phone, notes: reason })

      // The same series the desk uses. This route had its own, incompatible
      // one — see nextAppointmentNo.
      const appointmentNo = await nextAppointmentNo(tx, hospitalId)

      return tx.appointment.create({
        data: {
          hospitalId,
          appointmentNo,
          ...subjectColumns(subject),
          doctorId,
          startsAt,
          duration: DEFAULT_APPOINTMENT_DURATION,
          appointmentType: 'CONSULTATION',
          // SCHEDULED, not CONFIRMED. Nobody at the clinic has seen this yet,
          // and the distinction is what lets the desk work through what came in
          // overnight.
          status: 'SCHEDULED',
          chiefComplaint: reason || null,
        },
        select: { id: true, appointmentNo: true, startsAt: true },
      })
    })

    // Booked by a patient, not by staff. There is no user to attribute it to,
    // and the trail should say so rather than leave it looking like desk work.
    void recordAudit({
      hospitalId,
      userId: null,
      action: AUDIT_ACTIONS.PUBLIC_BOOKING_CREATED,
      entityType: 'Appointment',
      entityId: appointment.id,
      newValues: { appointmentNo: appointment.appointmentNo, doctorId },
      ...requestContext(req.headers),
    })

    const wall = wallClockIn(appointment.startsAt, hospital.timezone)

    return NextResponse.json(
      {
        success: true,
        appointment: {
          reference: appointment.appointmentNo,
          date: wall.scheduledDate,
          time: wall.scheduledTime,
          doctor: `Dr. ${doctor.firstName} ${doctor.lastName}`.trim(),
        },
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error('Public booking error:', err)
    return NextResponse.json({ error: 'Failed to book the appointment' }, { status: 500 })
  }
}
