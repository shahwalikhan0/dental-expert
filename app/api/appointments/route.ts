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

    const skip = (page - 1) * limit
    const timezone = await clinicTimezone(prisma, hospitalId)

    // Build where clause - always include hospitalId
    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { appointmentNo: { contains: search } },
        { patient: { firstName: { contains: search } } },
        { patient: { lastName: { contains: search } } },
        { patient: { phone: { contains: search } } },
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

    if (type) {
      where.appointmentType = type
    }

    const [appointments, total] = await Promise.all([
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
          chair: { select: { id: true, name: true } },
        },
        orderBy: { startsAt: 'asc' },
        skip: view === 'list' ? skip : undefined,
        take: view === 'list' ? limit : undefined,
      }),
      prisma.appointment.count({ where }),
    ])

    return NextResponse.json({
      appointments: appointments.map((a) => withWallClock(a, timezone)),
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
      chairId,
      appointmentType = 'CONSULTATION',
      priority = 'NORMAL',
      chiefComplaint,
      notes,
    } = body

    // Validate required fields
    if (!patientId || !doctorId || !scheduledDate || !scheduledTime) {
      return NextResponse.json(
        { error: 'Patient, doctor, date, and time are required' },
        { status: 400 }
      )
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

    // Check if patient exists and belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Check if doctor exists and belongs to this hospital
    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId },
    })
    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    // Check the chair belongs to this clinic and is in service
    if (chairId) {
      const chair = await prisma.chair.findFirst({
        where: { id: chairId, hospitalId },
        select: { id: true, isActive: true },
      })
      if (!chair) {
        return NextResponse.json({ error: 'Chair not found' }, { status: 404 })
      }
      if (!chair.isActive) {
        return NextResponse.json({ error: 'That chair is out of service' }, { status: 400 })
      }
    }

    // FR-004: refuse (or warn about) an overlap on either the doctor or the
    // chair. This compares intervals, not start times — see
    // lib/appointment-conflicts.ts.
    const conflicts = await findAppointmentConflicts({
      hospitalId,
      startsAt,
      duration,
      timezone,
      doctorId,
      chairId,
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
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNo,
        patientId,
        doctorId,
        hospitalId,
        startsAt,
        duration,
        chairId,
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
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        chair: { select: { id: true, name: true } },
      },
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
