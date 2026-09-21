import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { dayRangeIn, wallClockIn } from '@/lib/appointment-time'
import { availableSlots, hoursOn } from '@/lib/working-hours'
import { closureOn, obstaclesOn, shiftOn, type AvailabilityRow } from '@/lib/availability'
import { bookableDays, readBookingSettings } from '@/lib/booking/rules'

/**
 * GET /api/public/[slug]/next-available — the first day this dentist has a
 * time free.
 *
 * The booking page could only say "Nothing free on this day. Please try
 * another." A patient on a phone then picked their way forward one day at a
 * time, and for a busy dentist that is a dozen taps before anything appears —
 * which is the point at which somebody gives up and telephones, or does not.
 *
 * Scanning is bounded in three ways so that a public endpoint cannot be made
 * to do unbounded work: it never looks past the clinic's own booking horizon,
 * never past `MAX_DAYS`, and never runs more than two database queries however
 * many days it covers. Availability rows and booked appointments are read once
 * for the whole window and the days are then worked out in memory.
 */

/**
 * How far to look. Six weeks is past the point where a patient would rather
 * ring up anyway, and a clinic with nothing free for six weeks has a problem
 * this screen cannot solve.
 */
const MAX_DAYS = 42

/** `2026-09-21` plus n days, staying in calendar days rather than instants. */
function addDays(day: string, n: number): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(req.url)
    const doctorId = searchParams.get('doctorId')
    const from = searchParams.get('from')
    const duration = parseInt(searchParams.get('duration') || '30')

    if (!doctorId || !from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return NextResponse.json({ error: 'doctorId and from are required' }, { status: 400 })
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

    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId },
      select: { id: true },
    })
    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    // The same window the booking form offers, so this can never point at a
    // day the form would then refuse.
    const settings = await readBookingSettings(prisma, hospitalId)
    const window = bookableDays(settings, (at) => wallClockIn(at, timezone).scheduledDate)

    const start = from < window.first ? window.first : from
    const days: string[] = []
    for (let i = 0; i < MAX_DAYS; i++) {
      const day = addDays(start, i)
      if (day > window.last) break
      days.push(day)
    }

    if (days.length === 0) {
      return NextResponse.json({ nextAvailable: null, searchedTo: window.last })
    }

    const lastDay = days[days.length - 1]

    // Both reads cover the whole window. `relevantOn` narrows to one day, which
    // is right for the per-day route and wrong here — a scan of six weeks would
    // become eighty-four queries.
    const [availability, appointments] = await Promise.all([
      prisma.availability.findMany({
        where: {
          hospitalId,
          AND: [{ OR: [{ staffId: null }, { staffId: doctorId }] }],
        },
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
      }) as Promise<AvailabilityRow[]>,
      prisma.appointment.findMany({
        where: {
          hospitalId,
          doctorId,
          startsAt: {
            gte: dayRangeIn(days[0], timezone).gte,
            lt: dayRangeIn(lastDay, timezone).lt,
          },
          status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
        },
        select: { startsAt: true, duration: true },
      }),
    ])

    // Booked time, bucketed by the clinic's calendar day.
    const bookedByDay = new Map<string, { start: string; duration: number }[]>()
    for (const appointment of appointments) {
      const wall = wallClockIn(appointment.startsAt, timezone)
      const bucket = bookedByDay.get(wall.scheduledDate)
      const entry = { start: wall.scheduledTime, duration: appointment.duration }
      if (bucket) bucket.push(entry)
      else bookedByDay.set(wall.scheduledDate, [entry])
    }

    const now = wallClockIn(new Date(), timezone)

    for (const day of days) {
      const workingHours = hoursOn(hospital.workingHours, day)
      if (!workingHours) continue
      if (closureOn(availability, day)) continue

      const slots = availableSlots({
        hours: workingHours,
        shift: shiftOn(availability, day, doctorId),
        duration,
        booked: bookedByDay.get(day) ?? [],
        blocked: obstaclesOn(workingHours, availability, day),
        day,
        now: { day: now.scheduledDate, time: now.scheduledTime },
      })

      const free = slots.find((slot) => slot.available)
      if (free) {
        return NextResponse.json({ nextAvailable: { date: day, time: free.time } })
      }
    }

    return NextResponse.json({ nextAvailable: null, searchedTo: lastDay })
  } catch (err: unknown) {
    console.error('Next-available error:', err)
    return NextResponse.json({ error: 'Failed to look for a free day' }, { status: 500 })
  }
}
