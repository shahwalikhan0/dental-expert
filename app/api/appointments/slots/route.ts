import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { findDentist, NOT_A_DENTIST } from '@/lib/clinicians'
import { clinicTimezone, dayRangeIn, wallClockIn } from '@/lib/appointment-time'
import { availableSlots } from '@/lib/working-hours'
import { dayAvailability } from '@/lib/appointment-availability'

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

    // Only somebody who can be booked as the dentist is offered times. This
    // checked only that the staff id belonged to the clinic, so the picker
    // offered slots for the receptionist (bug report 12 Oct, finding 7).
    const doctor = await findDentist(hospitalId, doctorId)
    if (!doctor) {
      return NextResponse.json({ error: NOT_A_DENTIST }, { status: 400 })
    }

    const timezone = await clinicTimezone(prisma, hospitalId)

    // The clinic's hours for this weekday, its closures, this dentist's shift
    // and leave, and the lunch break — the same answer booking itself checks
    // against. See lib/appointment-availability.ts.
    const day = await dayAvailability(prisma, hospitalId, date, doctorId)
    if (day.closed || !day.hours) {
      return NextResponse.json({
        available: false,
        reason: day.closed,
        slots: [],
      })
    }

    // Get existing appointments for the doctor on this date
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        hospitalId,
        doctorId,
        startsAt: dayRangeIn(new Date(date), timezone),
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
      hours: day.hours,
      shift: day.shift,
      duration,
      booked: existingAppointments.map((apt) => ({
        start: wallClockIn(apt.startsAt, timezone).scheduledTime,
        duration: apt.duration,
      })),
      blocked: day.blocked,
      day: date.slice(0, 10),
      step: day.settings.slotDuration,
      buffer: day.settings.bufferTime,
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
      workingHours: day.shift ? { open: day.shift.startTime, close: day.shift.endTime } : day.hours,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching time slots:', error)
    return NextResponse.json({ error: 'Failed to fetch time slots' }, { status: 500 })
  }
}
