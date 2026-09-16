import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { nextAppointmentNo } from '@/lib/numbering'
import { requirePermission } from '@/lib/api-helpers'
import {
  conflictResponseBody,
  findAppointmentConflicts,
  getDoubleBookingPolicy,
} from '@/lib/appointment-conflicts'

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

    if (date) {
      const dateObj = new Date(date)
      where.scheduledDate = dateObj
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

    // For calendar views, get date range
    if (view === 'day' && date) {
      const dayStart = new Date(date)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(date)
      dayEnd.setHours(23, 59, 59, 999)
      where.scheduledDate = {
        gte: dayStart,
        lte: dayEnd,
      }
    } else if (view === 'week' && date) {
      const weekStart = new Date(date)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)
      weekEnd.setHours(23, 59, 59, 999)
      where.scheduledDate = {
        gte: weekStart,
        lte: weekEnd,
      }
    } else if (view === 'month' && date) {
      const monthStart = new Date(date)
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const monthEnd = new Date(monthStart)
      monthEnd.setMonth(monthEnd.getMonth() + 1)
      monthEnd.setDate(0)
      monthEnd.setHours(23, 59, 59, 999)
      where.scheduledDate = {
        gte: monthStart,
        lte: monthEnd,
      }
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
        orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }],
        skip: view === 'list' ? skip : undefined,
        take: view === 'list' ? limit : undefined,
      }),
      prisma.appointment.count({ where }),
    ])

    return NextResponse.json({
      appointments,
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

    // Validate scheduled date is not in the past
    const scheduledDateObj = new Date(scheduledDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (scheduledDateObj < today) {
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
    const appointmentDate = new Date(scheduledDate)
    const conflicts = await findAppointmentConflicts({
      hospitalId,
      scheduledDate: appointmentDate,
      scheduledTime,
      duration,
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
        scheduledDate: appointmentDate,
        scheduledTime,
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
    if (conflictWarnings.length > 0) {
      return NextResponse.json({ ...appointment, conflicts: conflictWarnings }, { status: 201 })
    }

    return NextResponse.json(appointment, { status: 201 })
  } catch (error) {
    console.error('Error creating appointment:', error)
    return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 })
  }
}
