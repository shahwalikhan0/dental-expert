import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findDentist } from '@/lib/clinicians'
import { dayRangeIn, wallClockIn } from '@/lib/appointment-time'
import { availableSlots, hoursOn } from '@/lib/working-hours'
import { readAppointmentSettings } from '@/lib/appointment-settings'
import {
  closureOn,
  obstaclesOn,
  relevantOn,
  shiftOn,
  type AvailabilityRow,
} from '@/lib/availability'

/**
 * GET: Public slot availability by hospital slug.
 * Query params: doctorId, date, duration (optional, default 30)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(req.url)
    const doctorId = searchParams.get('doctorId')
    const date = searchParams.get('date')
    const duration = parseInt(searchParams.get('duration') || '30')

    if (!doctorId || !date) {
      return NextResponse.json({ error: 'doctorId and date are required' }, { status: 400 })
    }

    const hospital = await prisma.hospital.findUnique({
      where: { slug },
      select: { id: true, workingHours: true, patientPortalEnabled: true, timezone: true },
    })

    if (!hospital) {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
    }

    if (!hospital.patientPortalEnabled) {
      return NextResponse.json({ error: 'Online booking is not enabled' }, { status: 403 })
    }

    const hospitalId = hospital.id
    const timezone = hospital.timezone

    // The same scheduling rules the desk books under — see
    // lib/appointment-settings.ts. A public page offering times the book would
    // refuse is worse than one offering none.
    const scheduling = await readAppointmentSettings(prisma, hospitalId)

    // The clinic's hours for this weekday — see lib/working-hours.ts for what
    // this used to parse the stored JSON into.
    const workingHours = hoursOn(hospital.workingHours, date)
    if (!workingHours) {
      return NextResponse.json({
        available: false,
        reason: 'The clinic is closed on this day',
        slots: [],
      })
    }

    const dateObj = new Date(date)

    // A dentist the clinic can actually book — not the receptionist, not
    // somebody deactivated this morning. See lib/clinicians.ts.
    const doctor = await findDentist(hospitalId, doctorId)
    if (!doctor) {
      return NextResponse.json({ error: 'That dentist is not available' }, { status: 404 })
    }

    // Clinic closures plus this dentist's shifts and leave, in one query —
    // see lib/availability.ts.
    const availability = (await prisma.availability.findMany({
      where: relevantOn(hospitalId, date, doctorId),
      select: {
        id: true,
        staffId: true,
        dayOfWeek: true,
        date: true,
        startTime: true,
        endTime: true,
        isAvailable: true,
        name: true,
        isRecurring: true,
      },
    })) as AvailabilityRow[]

    const closed = closureOn(availability, date)
    if (closed) {
      return NextResponse.json({ available: false, reason: closed.reason, slots: [] })
    }

    const doctorShift = shiftOn(availability, date, doctorId)

    // Existing appointments
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        hospitalId,
        doctorId,
        startsAt: dayRangeIn(dateObj, timezone),
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
      },
      select: { startsAt: true, duration: true },
    })

    const slots = availableSlots({
      hours: workingHours,
      shift: doctorShift,
      duration,
      booked: existingAppointments.map((apt) => ({
        start: wallClockIn(apt.startsAt, timezone).scheduledTime,
        duration: apt.duration,
      })),
      blocked: [
        ...obstaclesOn(workingHours, availability, date),
        ...(scheduling.lunchBreakStart && scheduling.lunchBreakEnd
          ? [{ start: scheduling.lunchBreakStart, end: scheduling.lunchBreakEnd }]
          : []),
      ],
      day: date.slice(0, 10),
      step: scheduling.slotDuration,
      buffer: scheduling.bufferTime,
      now: {
        // The clinic's clock, not the host's — this page is served to patients
        // from wherever the application happens to be running.
        day: wallClockIn(new Date(), timezone).scheduledDate,
        time: wallClockIn(new Date(), timezone).scheduledTime,
      },
    })

    return NextResponse.json({ available: true, date, doctorId, slots })
  } catch (err: unknown) {
    console.error('Public slots error:', err)
    return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 })
  }
}
