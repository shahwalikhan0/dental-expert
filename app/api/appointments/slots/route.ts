import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { clinicTimezone, dayRangeIn, wallClockIn } from '@/lib/appointment-time'
import { availableSlots, hoursOn } from '@/lib/working-hours'
import {
  closureOn,
  obstaclesOn,
  relevantOn,
  shiftOn,
  type AvailabilityRow,
} from '@/lib/availability'

// GET - Get available time slots for a doctor on a specific date
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const doctorId = searchParams.get('doctorId')
    const date = searchParams.get('date')
    const duration = parseInt(searchParams.get('duration') || '30')

    if (!doctorId || !date) {
      return NextResponse.json({ error: 'Doctor ID and date are required' }, { status: 400 })
    }

    // Get hospital working hours (default 9 AM to 9 PM)
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { workingHours: true, timezone: true },
    })

    const timezone = hospital?.timezone || (await clinicTimezone(prisma, hospitalId))

    // The clinic's hours for this weekday. This used to parse the stored JSON
    // into a shape nothing writes — see lib/working-hours.ts.
    const workingHours = hoursOn(hospital?.workingHours, date)
    if (!workingHours) {
      return NextResponse.json({
        available: false,
        reason: 'The clinic is closed on this day',
        slots: [],
      })
    }

    const dateObj = new Date(date)

    // Verify doctor belongs to this hospital
    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId },
    })

    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    // Clinic closures and this dentist's own shifts and leave, in one query.
    // These were two tables consulted separately, and the holiday check ran
    // before the doctor was even verified — see lib/availability.ts.
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

    // Get existing appointments for the doctor on this date
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        hospitalId,
        doctorId,
        startsAt: dayRangeIn(dateObj, timezone),
        status: {
          notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
        },
      },
      select: {
        startsAt: true,
        duration: true,
      },
    })

    const slots = availableSlots({
      hours: workingHours,
      shift: doctorShift,
      duration,
      booked: existingAppointments.map((apt) => ({
        start: wallClockIn(apt.startsAt, timezone).scheduledTime,
        duration: apt.duration,
      })),
      blocked: obstaclesOn(workingHours, availability, date),
      day: date.slice(0, 10),
      now: {
        day: wallClockIn(new Date(), timezone).scheduledDate,
        time: wallClockIn(new Date(), timezone).scheduledTime,
      },
    })

    return NextResponse.json({
      available: true,
      date,
      doctorId,
      slots,
      workingHours: doctorShift
        ? { open: doctorShift.startTime, close: doctorShift.endTime }
        : workingHours,
    })
  } catch (error) {
    console.error('Error fetching time slots:', error)
    return NextResponse.json({ error: 'Failed to fetch time slots' }, { status: 500 })
  }
}
