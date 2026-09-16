import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_APPOINTMENT_DURATION, findAppointmentConflicts } from '@/lib/appointment-conflicts'
import { prisma } from '@/lib/prisma'
import { instantAt, wallClockIn } from '@/lib/appointment-time'
import { nextAppointmentNo } from '@/lib/numbering'

/**
 * POST: Public booking endpoint.
 * Requires patient phone verification (patient must exist).
 * Body: { phone, doctorId, date, time, type, chiefComplaint }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const body = await req.json()
    const { phone, doctorId, date, time, type, chiefComplaint } = body as {
      phone: string
      doctorId: string
      date: string
      time: string
      type?: string
      chiefComplaint?: string
    }

    if (!phone || !doctorId || !date || !time) {
      return NextResponse.json(
        { error: 'Phone, doctor, date, and time are required' },
        { status: 400 }
      )
    }

    const hospital = await prisma.hospital.findUnique({
      where: { slug },
      select: { id: true, patientPortalEnabled: true, timezone: true },
    })

    if (!hospital) {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
    }

    if (!hospital.patientPortalEnabled) {
      return NextResponse.json({ error: 'Online booking is not enabled' }, { status: 403 })
    }

    // Find patient by phone
    const patient = await prisma.patient.findFirst({
      where: { hospitalId: hospital.id, phone, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    })

    if (!patient) {
      return NextResponse.json(
        { error: 'No patient account found with this phone number. Please contact the clinic.' },
        { status: 404 }
      )
    }

    // Verify doctor
    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId: hospital.id },
      select: { id: true, firstName: true, lastName: true },
    })

    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    // The time the patient picked is wall clock on the clinic's own page, so
    // it is resolved against the clinic's zone and stored as the instant.
    const startsAt = instantAt(date, time, hospital.timezone)
    if (!startsAt) {
      return NextResponse.json({ error: 'Invalid date or time' }, { status: 400 })
    }

    // Check for duplicate booking
    const existing = await prisma.appointment.findFirst({
      where: {
        hospitalId: hospital.id,
        patientId: patient.id,
        doctorId,
        startsAt,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'You already have a booking at this time' },
        { status: 409 }
      )
    }

    // FR-004 on the public booking page. This checked only whether the patient
    // was double-booking *themselves* — nothing stopped an outside caller
    // booking a dentist who was already occupied. Unlike the staff routes this
    // never honours a WARN policy: overbooking is a decision for the front
    // desk, not for whoever is on the website.
    const conflicts = await findAppointmentConflicts({
      hospitalId: hospital.id,
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

    // The same series the desk uses. This route had its own, incompatible
    // one — see nextAppointmentNo.
    const appointmentNo = await nextAppointmentNo(prisma, hospital.id)

    const appointment = await prisma.appointment.create({
      data: {
        hospitalId: hospital.id,
        appointmentNo,
        patientId: patient.id,
        doctorId,
        startsAt,
        duration: DEFAULT_APPOINTMENT_DURATION,
        appointmentType: (type as any) || 'CONSULTATION',
        status: 'SCHEDULED',
        chiefComplaint: chiefComplaint || null,
      },
    })

    return NextResponse.json(
      {
        success: true,
        appointment: {
          appointmentNo: appointment.appointmentNo,
          date: wallClockIn(appointment.startsAt, hospital.timezone).scheduledDate,
          time: wallClockIn(appointment.startsAt, hospital.timezone).scheduledTime,
          doctor: `Dr. ${doctor.firstName} ${doctor.lastName}`,
        },
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error('Public booking error:', err)
    return NextResponse.json({ error: 'Failed to book appointment' }, { status: 500 })
  }
}
