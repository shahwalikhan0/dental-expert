import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { nextAppointmentNo } from '@/lib/numbering'
import { requirePermission } from '@/lib/api-helpers'
import {
  conflictResponseBody,
  findAppointmentConflicts,
  getDoubleBookingPolicy,
} from '@/lib/appointment-conflicts'
import {
  clinicTimezone,
  dayRangeIn,
  instantAt,
  localDay,
  withWallClock,
} from '@/lib/appointment-time'
import { validateVisitor } from '@/lib/visitors'
import { readAppointmentSettings } from '@/lib/appointment-settings'
import { orderByFrom, sortFromParams, type SortMap } from '@/lib/sorting'

/**
 * A walk-in has no patient record, so sorting by patient puts every walk-in
 * together at one end rather than interleaving them by the name on screen.
 * Prisma cannot order across a union of two relations; the alternative is
 * sorting the page in memory, which would order the page rather than the list.
 */
const APPOINTMENT_SORTS: SortMap = {
  appointmentNo: (direction) => ({ appointmentNo: direction }),
  startsAt: (direction) => ({ startsAt: direction }),
  status: (direction) => ({ status: direction }),
  type: (direction) => ({ appointmentType: direction }),
  token: (direction) => ({ tokenNumber: direction }),
  patient: (direction) => [{ patient: { lastName: direction } }, { startsAt: 'asc' }],
  doctor: (direction) => ({ doctor: { lastName: direction } }),
}

// GET - List appointments with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const date = searchParams.get('date') || ''
    const doctorId = searchParams.get('doctorId') || ''
    const patientId = searchParams.get('patientId') || ''
    const type = searchParams.get('type') || ''
    const view = searchParams.get('view') || 'list' // list, day, week, month
    // Online bookings nobody at the desk has dealt with yet.
    const needsReview = searchParams.get('needsReview') === 'true'

    const skip = (page - 1) * limit
    const timezone = await clinicTimezone(prisma, hospitalId)

    // Build where clause - always include hospitalId
    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { appointmentNo: { contains: search } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { phone: { contains: search } } },
        // A walk-in is searched for by the same box. Somebody asking for
        // "Bilal" does not know whether he was registered.
        { visitor: { name: { contains: search, mode: 'insensitive' } } },
        { visitor: { phone: { contains: search } } },
        { tokenNumber: { contains: search } },
      ]
    }

    if (status) {
      where.status = status
    }

    // A day, a week or a month of the clinic's own calendar, expressed as the
    // half-open instant range it covers. The previous version called
    // `setHours()` on a date column, which is the *server's* midnight, and then
    // compared it against a value that was always midnight anyway.
    if (date) {
      if (view === 'week') {
        const start = new Date(`${date}T00:00:00Z`)
        start.setUTCDate(start.getUTCDate() - start.getUTCDay())
        where.startsAt = dayRangeIn(start, timezone, 7)
      } else if (view === 'month') {
        const start = new Date(`${date}T00:00:00Z`)
        start.setUTCDate(1)
        const days = new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
        ).getUTCDate()
        where.startsAt = dayRangeIn(start, timezone, days)
      } else {
        where.startsAt = dayRangeIn(date, timezone)
      }
    }

    if (doctorId) {
      where.doctorId = doctorId
    }

    if (patientId) {
      where.patientId = patientId
    }

    /**
     * "What came in overnight."
     *
     * The patient's confirmation page says the clinic will telephone them. This
     * is the list that makes that possible: booked on the website, not yet
     * touched by anybody at the desk, and still worth calling about — a booking
     * that has already been cancelled or attended needs no call.
     */
    if (needsReview) {
      where.bookedOnline = true
      where.reviewedAt = null
      where.status = { in: ['SCHEDULED', 'CONFIRMED'] }
    }

    if (type) {
      where.appointmentType = type
    }

    const [appointments, total, pendingReview] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
          visitor: { select: { id: true, name: true, phone: true, convertedPatientId: true } },
        },
        orderBy: orderByFrom(sortFromParams(searchParams), APPOINTMENT_SORTS, {
          startsAt: 'asc',
        }) as never,
        skip: view === 'list' ? skip : undefined,
        take: view === 'list' ? limit : undefined,
      }),
      prisma.appointment.count({ where }),
      // How many online bookings are still waiting to be called, whatever this
      // particular query was filtering for. Returned on every list so the
      // screen can say so without asking a second time.
      prisma.appointment.count({
        where: {
          hospitalId,
          bookedOnline: true,
          reviewedAt: null,
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
        },
      }),
    ])

    return NextResponse.json({
      appointments: appointments.map((a) => withWallClock(a, timezone)),
      pendingReview,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching appointments:', error)
    return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
  }
}

// POST - Create new appointment
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      patientId,
      doctorId,
      scheduledDate,
      scheduledTime,
      duration = 30,
      visitor,
      appointmentType = 'CONSULTATION',
      priority = 'NORMAL',
      chiefComplaint,
      notes,
    } = body

    // A patient or a walk-in, and exactly one of the two. The database says the
    // same thing in a CHECK constraint; this is so the desk gets a sentence
    // rather than a constraint violation.
    if (!patientId && !visitor) {
      return NextResponse.json(
        { error: 'An appointment needs a patient, or a name for a walk-in' },
        { status: 400 }
      )
    }

    if (patientId && visitor) {
      return NextResponse.json(
        { error: 'An appointment belongs to a patient or to a walk-in, not both' },
        { status: 400 }
      )
    }

    if (!doctorId || !scheduledDate || !scheduledTime) {
      return NextResponse.json({ error: 'Doctor, date, and time are required' }, { status: 400 })
    }

    const visitorError = visitor ? validateVisitor(visitor) : null
    if (visitorError) {
      return NextResponse.json({ error: visitorError }, { status: 400 })
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/
    if (!timeRegex.test(scheduledTime)) {
      return NextResponse.json(
        { error: 'Invalid time format. Use HH:MM (24-hour format)' },
        { status: 400 }
      )
    }

    // Validate duration (between 5 and 480 minutes / 8 hours max)
    if (duration < 5 || duration > 480) {
      return NextResponse.json(
        { error: 'Duration must be between 5 and 480 minutes' },
        { status: 400 }
      )
    }

    // The clinic books a wall-clock time; what is stored is the instant that
    // refers to in the clinic's own timezone.
    const timezone = await clinicTimezone(prisma, hospitalId)
    const startsAt = instantAt(scheduledDate, scheduledTime, timezone)
    if (!startsAt) {
      return NextResponse.json({ error: 'Invalid appointment date' }, { status: 400 })
    }

    // "In the past" means the clinic's yesterday, not the server's: a booking
    // made at 02:00 Karachi for later that morning is not in the past, however
    // the host's own clock reads.
    if (localDay(startsAt, timezone) < localDay(new Date(), timezone)) {
      return NextResponse.json(
        { error: 'Cannot schedule appointments in the past' },
        { status: 400 }
      )
    }

    /**
     * How far ahead the desk may book.
     *
     * `appointments.maxAdvanceBookingDays` was stored by Settings →
     * Appointments and read by nothing, so the only horizon in the application
     * was the public page's. A diary with no far end is one where a mistyped
     * year puts a patient in 2036 and the clinic carries the row until somebody
     * notices.
     *
     * Counted in the clinic's own calendar days, so it agrees with the "in the
     * past" check above rather than with the server's clock.
     */
    const scheduling = await readAppointmentSettings(prisma, hospitalId)
    const horizon = new Date(Date.now() + scheduling.maxAdvanceBookingDays * 24 * 60 * 60 * 1000)
    if (localDay(startsAt, timezone) > localDay(horizon, timezone)) {
      return NextResponse.json(
        {
          error: `Appointments can be booked up to ${scheduling.maxAdvanceBookingDays} days ahead. Change this at Settings → Appointments.`,
        },
        { status: 400 }
      )
    }

    if (patientId) {
      const patient = await prisma.patient.findFirst({
        where: { id: patientId, hospitalId },
        select: { id: true },
      })
      if (!patient) {
        return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
      }
    }

    // Check if doctor exists and belongs to this hospital
    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId },
    })
    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    // FR-004: refuse (or warn about) an overlap on the doctor. This compares
    // intervals, not start times — see lib/appointment-conflicts.ts.
    const conflicts = await findAppointmentConflicts({
      hospitalId,
      startsAt,
      duration,
      timezone,
      doctorId,
    })

    let conflictWarnings: typeof conflicts = []
    if (conflicts.length > 0) {
      const policy = await getDoubleBookingPolicy(hospitalId)
      if (policy === 'BLOCK') {
        return NextResponse.json(conflictResponseBody(conflicts), { status: 409 })
      }
      conflictWarnings = conflicts
    }

    // Generate appointment number for this hospital
    const appointmentNo = await nextAppointmentNo(prisma, hospitalId)

    // Create appointment
    // The walk-in and the appointment are written together. A visitor row with
    // no appointment is a name the clinic cannot account for, so if the second
    // write fails the first is rolled back with it.
    const appointment = await prisma.$transaction(async (tx) => {
      let visitorId: string | null = null

      if (!patientId) {
        const created = await tx.visitor.create({
          data: {
            hospitalId,
            name: String(visitor.name).trim(),
            phone: visitor.phone ? String(visitor.phone).trim() : null,
            notes: visitor.notes ? String(visitor.notes).trim() : null,
          },
          select: { id: true },
        })
        visitorId = created.id
      }

      return tx.appointment.create({
        data: {
          appointmentNo,
          hospitalId,
          patientId: patientId ?? null,
          visitorId,
          doctorId,
          startsAt,
          duration,
          appointmentType,
          priority,
          chiefComplaint,
          notes,
          status: 'SCHEDULED',
        },
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
          visitor: { select: { id: true, name: true, phone: true } },
          doctor: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    })

    // Under the WARN policy the booking stands, but the caller is told exactly
    // what it overlaps so the front desk can see it rather than discover it.
    const body201 = withWallClock(appointment, timezone)

    if (conflictWarnings.length > 0) {
      return NextResponse.json({ ...body201, conflicts: conflictWarnings }, { status: 201 })
    }

    return NextResponse.json(body201, { status: 201 })
  } catch (error) {
    console.error('Error creating appointment:', error)
    return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 })
  }
}
