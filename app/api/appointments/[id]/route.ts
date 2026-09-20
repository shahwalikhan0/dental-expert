import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { handleCancellationWaitlist } from '@/lib/services/smart-scheduler'
import {
  conflictResponseBody,
  findAppointmentConflicts,
  getDoubleBookingPolicy,
} from '@/lib/appointment-conflicts'
import { clinicTimezone, instantAt, withWallClock, wallClockIn } from '@/lib/appointment-time'

// GET - Get single appointment
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('appointments:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const appointment = await prisma.appointment.findFirst({
      where: { id, hospitalId },
      include: {
        patient: {
          include: {
            medicalHistory: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
            phone: true,
          },
        },
        visitor: {
          select: { id: true, name: true, phone: true, convertedPatientId: true },
        },
        treatments: {
          include: {
            procedure: true,
          },
        },
      },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const timezone = await clinicTimezone(prisma, hospitalId)
    return NextResponse.json(withWallClock(appointment, timezone))
  } catch (error) {
    console.error('Error fetching appointment:', error)
    return NextResponse.json({ error: 'Failed to fetch appointment' }, { status: 500 })
  }
}

// PUT - Update appointment
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('appointments:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const {
      scheduledDate,
      scheduledTime,
      duration,
      appointmentType,
      status,
      priority,
      chiefComplaint,
      notes,
      doctorId,
    } = body

    // Check if appointment exists and belongs to this hospital
    const existingAppointment = await prisma.appointment.findFirst({
      where: { id, hospitalId },
    })

    if (!existingAppointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const timezone = await clinicTimezone(prisma, hospitalId)

    // A reschedule can move the day, the time or neither; whichever half the
    // caller sends, the other comes from where the appointment already is.
    const current = wallClockIn(existingAppointment.startsAt, timezone)
    let startsAt = existingAppointment.startsAt
    if (scheduledDate !== undefined || scheduledTime !== undefined) {
      const moved = instantAt(
        scheduledDate ?? current.scheduledDate,
        scheduledTime ?? current.scheduledTime,
        timezone
      )
      if (!moved) {
        return NextResponse.json({ error: 'Invalid appointment date or time' }, { status: 400 })
      }
      startsAt = moved
    }

    // Build update data
    const updateData: any = {}

    if (scheduledDate !== undefined || scheduledTime !== undefined) {
      updateData.startsAt = startsAt
    }
    if (duration !== undefined) updateData.duration = duration
    if (appointmentType !== undefined) updateData.appointmentType = appointmentType
    if (status !== undefined) updateData.status = status
    if (priority !== undefined) updateData.priority = priority
    if (chiefComplaint !== undefined) updateData.chiefComplaint = chiefComplaint
    if (notes !== undefined) updateData.notes = notes
    if (doctorId !== undefined) updateData.doctorId = doctorId

    // FR-004 on the reschedule path. Duration changes move the
    // interval just as a time change does, so they have to re-check too — the
    // previous version only looked at date, time and doctor, so stretching a
    // 30-minute appointment to 90 minutes over a colleague's slot went through.
    let conflictWarnings: Awaited<ReturnType<typeof findAppointmentConflicts>> = []
    if (
      (scheduledDate !== undefined ||
        scheduledTime !== undefined ||
        doctorId !== undefined ||
        duration !== undefined) &&
      status !== 'CANCELLED' &&
      status !== 'NO_SHOW'
    ) {
      const conflicts = await findAppointmentConflicts({
        hospitalId,
        startsAt,
        timezone,
        duration: duration ?? existingAppointment.duration,
        doctorId: doctorId || existingAppointment.doctorId,
        excludeAppointmentId: id,
      })

      if (conflicts.length > 0) {
        const policy = await getDoubleBookingPolicy(hospitalId)
        if (policy === 'BLOCK') {
          return NextResponse.json(conflictResponseBody(conflicts), { status: 409 })
        }
        conflictWarnings = conflicts
      }
    }

    // Handle cancellation
    if (status === 'CANCELLED') {
      updateData.cancelledAt = new Date()
      if (body.cancellationReason) {
        updateData.cancellationReason = body.cancellationReason
      }
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: updateData,
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
        visitor: { select: { id: true, name: true, phone: true } },
      },
    })

    // Smart Scheduler: When appointment is cancelled, notify matching waitlist patients
    if (status === 'CANCELLED' && existingAppointment.status !== 'CANCELLED') {
      try {
        const waitlistResult = await handleCancellationWaitlist({
          hospitalId,
          doctorId: existingAppointment.doctorId,
          startsAt: existingAppointment.startsAt,
          timezone,
          duration: existingAppointment.duration,
        })

        if (waitlistResult.matchedPatients.length > 0) {
          // Return the waitlist notification info alongside the appointment
          return NextResponse.json({
            ...withWallClock(appointment, timezone),
            _waitlistNotifications: {
              patientsNotified: waitlistResult.matchedPatients.length,
              patients: waitlistResult.matchedPatients.map((p) => ({
                name: p.patientName,
                phone: p.patientPhone,
              })),
              slotDetails: waitlistResult.slotDetails,
            },
          })
        }
      } catch (err) {
        // Don't fail the cancellation if waitlist notification fails
        console.error('Smart scheduler error:', err)
      }
    }

    if (conflictWarnings.length > 0) {
      return NextResponse.json({
        ...withWallClock(appointment, timezone),
        conflicts: conflictWarnings,
      })
    }

    return NextResponse.json(withWallClock(appointment, timezone))
  } catch (error) {
    console.error('Error updating appointment:', error)
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
  }
}

// DELETE - Delete appointment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('appointments:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Check if appointment exists and belongs to this hospital
    const appointment = await prisma.appointment.findFirst({
      where: { id, hospitalId },
      include: { treatments: true },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Don't allow deletion if treatments are linked
    if (appointment.treatments.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete appointment with linked treatments. Cancel it instead.' },
        { status: 400 }
      )
    }

    // Delete appointment (reminders will cascade)
    await prisma.appointment.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Appointment deleted successfully' })
  } catch (error) {
    console.error('Error deleting appointment:', error)
    return NextResponse.json({ error: 'Failed to delete appointment' }, { status: 500 })
  }
}
