import { NextRequest, NextResponse } from 'next/server'
import { AppointmentStatus, AppointmentType, Priority } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { handleCancellationWaitlist } from '@/lib/services/smart-scheduler'
import {
  conflictResponseBody,
  findAppointmentConflicts,
  getDoubleBookingPolicy,
} from '@/lib/appointment-conflicts'
import {
  clinicTimezone,
  formatCalendarDay,
  instantAt,
  withWallClock,
  wallClockIn,
} from '@/lib/appointment-time'
import { scheduleRefusal } from '@/lib/appointment-availability'
import {
  BOOKED_STATUSES,
  INACTIVE_PATIENT,
  isBooked,
  noShowTooEarly,
  transitionRefusal,
} from '@/lib/appointment-status'
import { minutesBetween } from '@/lib/appointment-wait'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { findDentist, NOT_A_DENTIST } from '@/lib/clinicians'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { holderCan } from '@/lib/rbac'

// GET - Get single appointment
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('appointments:read')

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
        // The bills raised for this visit (review 4.3), cancelled ones too —
        // as the treatment page lists its invoices — so the history of what
        // was charged is all there and the status says which still stands.
        // Only for those who may read billing: a dental assistant opens
        // appointments but is not shown what patients are charged.
        ...(holderCan(user, 'billing:read')
          ? {
              invoices: {
                select: {
                  id: true,
                  invoiceNo: true,
                  status: true,
                  totalAmount: true,
                  balanceAmount: true,
                },
                orderBy: { createdAt: 'asc' as const },
              },
            }
          : {}),
      },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const timezone = await clinicTimezone(prisma, hospitalId)
    return NextResponse.json(withWallClock(appointment, timezone))
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching appointment:', error)
    return NextResponse.json({ error: 'Failed to fetch appointment' }, { status: 500 })
  }
}

/** Statuses that give the slot up, so a change into one is never a clash. */
const ENDED_STATUSES: string[] = ['CANCELLED', 'NO_SHOW', 'RESCHEDULED']

/** The dentist can be handed over until the patient is called in. */
const REASSIGNABLE_STATUSES: string[] = [...BOOKED_STATUSES, 'CHECKED_IN']

// PUT - Update appointment
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('appointments:write')

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
      cancellationReason,
    } = body

    // An unknown status or type reached Prisma and came back as a 500 (bug
    // report 12 Oct, findings 8 and 49). Refused here with what is allowed.
    if (status !== undefined && !isEnumMember(AppointmentStatus, status)) {
      return enumRefusal('status', status, AppointmentStatus)
    }
    if (appointmentType !== undefined && !isEnumMember(AppointmentType, appointmentType)) {
      return enumRefusal('appointmentType', appointmentType, AppointmentType)
    }
    if (priority !== undefined && !isEnumMember(Priority, priority)) {
      return enumRefusal('priority', priority, Priority)
    }
    if (
      duration !== undefined &&
      (typeof duration !== 'number' ||
        !Number.isInteger(duration) ||
        duration < 5 ||
        duration > 480)
    ) {
      return NextResponse.json(
        { error: 'Duration must be between 5 and 480 minutes' },
        { status: 400 }
      )
    }

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
      const target = instantAt(
        scheduledDate ?? current.scheduledDate,
        scheduledTime ?? current.scheduledTime,
        timezone
      )
      if (!target) {
        return NextResponse.json({ error: 'Invalid appointment date or time' }, { status: 400 })
      }
      startsAt = target
    }

    /**
     * What this request actually changes.
     *
     * The edit screen sends the dentist, date, time and duration every time,
     * changed or not, so "was it sent" says nothing. Comparing against the row
     * is what lets a note be added to this morning's appointment without it
     * being refused as "in the past".
     */
    const moved = startsAt.getTime() !== existingAppointment.startsAt.getTime()
    const nextDoctorId: string = doctorId ?? existingAppointment.doctorId
    const doctorChanged = doctorId !== undefined && doctorId !== existingAppointment.doctorId
    const nextDuration: number = duration ?? existingAppointment.duration
    const durationChanged = nextDuration !== existingAppointment.duration
    const nextStatus: string = status ?? existingAppointment.status
    const statusChanged = status !== undefined && status !== existingAppointment.status

    /**
     * Status follows lib/appointment-status.ts.
     *
     * Any status in any order used to be a 200 (finding 8): SCHEDULED straight
     * to COMPLETED, then back to SCHEDULED. Checking in and out have their own
     * routes, which issue the token and stamp the times; this route moves only
     * between the statuses around them.
     */
    if (statusChanged) {
      const refusal = transitionRefusal(existingAppointment.status, status)
      if (refusal) {
        return NextResponse.json({ error: refusal }, { status: 400 })
      }

      // A no-show was recorded two days before the appointment (finding 8).
      // Nobody has failed to attend something that has not started.
      if (status === 'NO_SHOW' && noShowTooEarly(startsAt)) {
        const when = wallClockIn(startsAt, timezone)
        return NextResponse.json(
          {
            error: `A no-show can only be recorded once the appointment has started (${when.scheduledTime} on ${formatCalendarDay(startsAt, timezone)}).`,
          },
          { status: 400 }
        )
      }
    }

    // A visit that is under way, finished or called off is a record of what
    // happened. Moving it rewrites that record; a new booking is the answer.
    if (
      (moved || durationChanged) &&
      (!isBooked(existingAppointment.status) || !isBooked(nextStatus))
    ) {
      return NextResponse.json(
        {
          error: `Only a scheduled or confirmed appointment can be moved. This one is ${nextStatus}.`,
        },
        { status: 400 }
      )
    }

    if (doctorChanged && !REASSIGNABLE_STATUSES.includes(existingAppointment.status)) {
      return NextResponse.json(
        { error: 'The dentist can only be changed until the patient is called in.' },
        { status: 400 }
      )
    }

    // Any staff id was written as the dentist, another clinic's included
    // (finding 2). A changed dentist, and the dentist on a moved appointment,
    // must be an active dentist here — the same rule booking applies.
    if (doctorChanged || moved) {
      const dentist = await findDentist(hospitalId, nextDoctorId)
      if (!dentist) {
        return NextResponse.json({ error: NOT_A_DENTIST }, { status: 400 })
      }
    }

    // Rebooking a deactivated patient is booking them (finding 22).
    if (moved && existingAppointment.patientId) {
      const patient = await prisma.patient.findFirst({
        where: { id: existingAppointment.patientId, hospitalId },
        select: { isActive: true },
      })
      if (!patient?.isActive) {
        return NextResponse.json({ error: INACTIVE_PATIENT }, { status: 400 })
      }
    }

    // A booking that moves, stretches or changes hands gets the checks a new
    // one gets: not in the past, inside the horizon, the clinic open and the
    // dentist working, clear of lunch and closures (findings 6 and 8).
    if ((moved || durationChanged || doctorChanged) && isBooked(nextStatus)) {
      const refusal = await scheduleRefusal(prisma, {
        hospitalId,
        doctorId: nextDoctorId,
        startsAt,
        duration: nextDuration,
        timezone,
      })
      if (refusal) {
        return NextResponse.json({ error: refusal }, { status: 400 })
      }
    }

    // Build update data
    const updateData: any = {}

    // Somebody at the desk has now dealt with this, which is what takes an
    // online booking off the "waiting to be called" list. Set once, on the
    // first staff action of any kind — confirming it, moving it, cancelling
    // it — because all of them mean a human has seen it.
    if (existingAppointment.reviewedAt === null) {
      updateData.reviewedAt = new Date()
    }

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
      !ENDED_STATUSES.includes(nextStatus)
    ) {
      const conflicts = await findAppointmentConflicts({
        hospitalId,
        startsAt,
        timezone,
        duration: nextDuration,
        doctorId: nextDoctorId,
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

    const cancelling = statusChanged && status === 'CANCELLED'
    if (cancelling) {
      updateData.cancelledAt = new Date()
      updateData.cancellationReason =
        typeof cancellationReason === 'string' && cancellationReason.trim()
          ? cancellationReason.trim()
          : null
    }

    // Called in from the waiting room. This is the moment a wait ends, so it
    // is when the wait is written: check-in until now. It used to be written at
    // check-in as how late the patient was (finding 32).
    if (statusChanged && status === 'IN_PROGRESS') {
      updateData.waitTime = existingAppointment.checkedInAt
        ? minutesBetween(existingAppointment.checkedInAt, new Date())
        : null
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

    // Cancellations were not audited (finding 24). A cancelled visit is one the
    // clinic will be asked about, and the reason alone does not say who.
    if (cancelling) {
      void recordAudit({
        hospitalId,
        userId: user?.id,
        action: AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
        entityType: 'Appointment',
        entityId: id,
        oldValues: { status: existingAppointment.status },
        newValues: {
          appointmentNo: existingAppointment.appointmentNo,
          status: 'CANCELLED',
          cancellationReason: updateData.cancellationReason,
        },
        ...requestContext(request.headers),
      })
    }

    /**
     * A moved appointment leaves its old reminders behind.
     *
     * `/api/cron/reminders` queues a reminder keyed by appointment *and* send
     * time, so moving an appointment did not replace the reminder that was
     * already waiting — it added a second one and left the first at PENDING.
     * The dispatcher only suppresses reminders for appointments that are
     * cancelled, completed or marked a no-show, and a rescheduled one is none
     * of those, so it went out: a text arriving at the moment that used to be
     * a day before the old appointment, about a booking that had moved.
     *
     * Only PENDING rows are touched. Anything already sent is a record of what
     * the patient was actually told, and deleting it would make the clinic
     * unable to answer "nobody reminded me".
     */
    if (moved) {
      await prisma.messageLog.deleteMany({
        where: {
          hospitalId,
          relatedType: 'Appointment',
          relatedId: id,
          status: 'PENDING',
        },
      })
    }

    // Smart Scheduler: When appointment is cancelled, notify matching waitlist patients
    if (cancelling) {
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
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating appointment:', error)
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
  }
}

// DELETE - Delete appointment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, user } = await requirePermission('appointments:write')

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

    // A deleted appointment leaves nothing behind to ask about, so the trail
    // is the only record it existed (bug report 12 Oct, finding 24).
    void recordAudit({
      hospitalId,
      userId: user?.id,
      action: AUDIT_ACTIONS.APPOINTMENT_DELETED,
      entityType: 'Appointment',
      entityId: id,
      oldValues: {
        appointmentNo: appointment.appointmentNo,
        status: appointment.status,
        startsAt: appointment.startsAt,
        patientId: appointment.patientId,
        visitorId: appointment.visitorId,
        doctorId: appointment.doctorId,
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ message: 'Appointment deleted successfully' })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting appointment:', error)
    return NextResponse.json({ error: 'Failed to delete appointment' }, { status: 500 })
  }
}
