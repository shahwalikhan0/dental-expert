import { prisma } from '@/lib/prisma'
import { endsAt, wallClockIn } from '@/lib/appointment-time'
import { subjectName } from '@/lib/visitors'

/**
 * FR-004 — "Prevent or clearly warn against double-booking a doctor beyond
 * configured rules."
 *
 * Before this module the check was a string equality on `scheduledTime`, which
 * only caught appointments starting at the exact same minute. A 60-minute
 * appointment at 09:00 and a 30-minute one at 09:15 did not collide, so the
 * commonest form of double-booking — an overlap, not a tie — went through.
 *
 * The chair half of FR-004 went with the chairs themselves: the clinic runs a
 * token queue, not a set of numbered operatories, and a chair clash could only
 * ever occur where a dentist clash already had.
 *
 * Appointments are instants now, so the overlap test is arithmetic on
 * milliseconds rather than on minutes-since-midnight parsed out of a string.
 * Candidates are narrowed in SQL and compared in memory: Postgres cannot index
 * an interval it has to compute, but every appointment that overlaps must start
 * before this one ends and no earlier than the longest possible appointment
 * before it begins, which is a plain range scan on `startsAt`.
 */

/**
 * Statuses that no longer occupy the slot. A cancelled or no-show appointment
 * must not block the time from being rebooked.
 */
export const BLOCKING_STATUSES_EXCLUDED = ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const

/**
 * Matches `Appointment.duration`'s schema default. The self-service booking
 * routes do not let the patient choose a length, so the slot they occupy — and
 * therefore the slot they must not collide with — is this long.
 */
export const DEFAULT_APPOINTMENT_DURATION = 30

/**
 * The longest appointment the API will accept, and so how far back a candidate
 * can start and still overlap the slot being checked. Kept in step with the
 * duration validation on the appointment routes.
 */
export const MAX_APPOINTMENT_DURATION = 480

/**
 * Do two appointments overlap?
 *
 * Half-open intervals: back-to-back appointments (09:00–09:30 and 09:30–10:00)
 * do not overlap, which is the whole point of booking them that way.
 */
export function intervalsOverlap(
  startA: Date,
  durationA: number,
  startB: Date,
  durationB: number
): boolean {
  const aStart = startA.getTime()
  const bStart = startB.getTime()
  return aStart < bStart + durationB * 60000 && bStart < aStart + durationA * 60000
}

export type ConflictPolicy = 'BLOCK' | 'WARN'

/** Stored in `Setting` under the `appointments` category, not on `Hospital`. */
export const DOUBLE_BOOKING_POLICY_KEY = 'appointments.doubleBookingPolicy'
export const DEFAULT_DOUBLE_BOOKING_POLICY: ConflictPolicy = 'BLOCK'

/**
 * The "configured rules" half of FR-004. `BLOCK` refuses the booking; `WARN`
 * lets it through and returns the clash for the caller to show. Clinics that
 * deliberately overlap short check-ups on one doctor need `WARN`; the default
 * is `BLOCK` because a silent double-booking is the expensive failure.
 */
export async function getDoubleBookingPolicy(hospitalId: string): Promise<ConflictPolicy> {
  const setting = await prisma.setting.findUnique({
    where: { hospitalId_key: { hospitalId, key: DOUBLE_BOOKING_POLICY_KEY } },
    select: { value: true },
  })
  return setting?.value === 'WARN' ? 'WARN' : DEFAULT_DOUBLE_BOOKING_POLICY
}

export interface ConflictQuery {
  hospitalId: string
  startsAt: Date
  duration: number
  /** Only to word the clash — the overlap test itself is timezone-free. */
  timezone: string
  doctorId?: string | null
  /** The assistant on the booking, who cannot be at two chairs at once either. */
  assistantId?: string | null
  /** The appointment being rescheduled, which must not clash with itself. */
  excludeAppointmentId?: string | null
}

export interface AppointmentConflict {
  resource: 'doctor' | 'assistant'
  appointmentId: string
  appointmentNo: string
  scheduledTime: string
  endTime: string
  duration: number
  patientName: string
  resourceName: string
  message: string
}

/**
 * Every appointment that overlaps the proposed slot on the same doctor, or
 * that already has the proposed assistant at the chair. Empty means the slot
 * is free.
 */
export async function findAppointmentConflicts(
  query: ConflictQuery
): Promise<AppointmentConflict[]> {
  const { hospitalId, startsAt, duration, timezone, doctorId } = query
  const assistantId = query.assistantId || null

  if (!doctorId && !assistantId) return []

  const candidates = await prisma.appointment.findMany({
    where: {
      hospitalId,
      startsAt: {
        gte: new Date(startsAt.getTime() - MAX_APPOINTMENT_DURATION * 60000),
        lt: endsAt(startsAt, duration),
      },
      status: { notIn: [...BLOCKING_STATUSES_EXCLUDED] as never },
      OR: [
        ...(doctorId ? [{ doctorId }] : []),
        // The assistant is busy whichever role they hold on the other visit.
        ...(assistantId ? [{ assistantId }, { doctorId: assistantId }] : []),
      ],
      ...(query.excludeAppointmentId ? { id: { not: query.excludeAppointmentId } } : {}),
    },
    select: {
      id: true,
      appointmentNo: true,
      startsAt: true,
      duration: true,
      doctorId: true,
      assistantId: true,
      patient: { select: { firstName: true, lastName: true } },
      visitor: { select: { name: true } },
      doctor: { select: { firstName: true, lastName: true } },
      assistant: { select: { firstName: true, lastName: true } },
    },
  })

  const conflicts: AppointmentConflict[] = []

  for (const existing of candidates) {
    // The SQL narrows to these people already; the check is repeated here so
    // the function is correct on the rows it is given rather than only on the
    // rows the query happens to return.
    const dentistBusy = !!doctorId && existing.doctorId === doctorId
    const assistantBusy =
      !!assistantId && (existing.assistantId === assistantId || existing.doctorId === assistantId)
    if (!dentistBusy && !assistantBusy) continue

    if (!intervalsOverlap(startsAt, duration, existing.startsAt, existing.duration)) {
      continue
    }

    // A clashing appointment may belong to a walk-in who has no patient record.
    const patientName = subjectName(existing)
    const startTime = wallClockIn(existing.startsAt, timezone).scheduledTime
    const endTime = wallClockIn(
      endsAt(existing.startsAt, existing.duration),
      timezone
    ).scheduledTime

    const doctorName = `Dr. ${existing.doctor.firstName} ${existing.doctor.lastName}`.trim()
    const assistantName =
      existing.assistantId === assistantId && existing.assistant
        ? `${existing.assistant.firstName} ${existing.assistant.lastName}`.trim()
        : doctorName
    const resourceName = dentistBusy ? doctorName : assistantName
    conflicts.push({
      resource: dentistBusy ? 'doctor' : 'assistant',
      appointmentId: existing.id,
      appointmentNo: existing.appointmentNo,
      scheduledTime: startTime,
      endTime,
      duration: existing.duration,
      patientName,
      resourceName,
      message: `${resourceName} is with ${patientName} from ${startTime} to ${endTime} (${existing.appointmentNo})`,
    })
  }

  return conflicts
}

/** A 409 body shaped so the UI can list what clashes rather than just "conflict". */
export function conflictResponseBody(conflicts: AppointmentConflict[]) {
  return {
    error:
      conflicts.length === 1
        ? conflicts[0].message
        : `This slot clashes with ${conflicts.length} existing appointments`,
    conflicts,
  }
}
