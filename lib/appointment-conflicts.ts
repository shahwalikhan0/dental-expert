import { prisma } from '@/lib/prisma'

/**
 * FR-004 — "Prevent or clearly warn against double-booking a doctor/chair
 * beyond configured rules."
 *
 * Before this module the check was a string equality on `scheduledTime`, which
 * only caught appointments starting at the exact same minute. A 60-minute
 * appointment at 09:00 and a 30-minute one at 09:15 did not collide, so the
 * commonest form of double-booking — an overlap, not a tie — went through. The
 * chair was never checked at all.
 *
 * Times are stored as `HH:MM` strings alongside a `duration` in minutes, so the
 * overlap test is arithmetic on minutes-since-midnight rather than SQL. The day
 * is fetched in one query and compared in memory: a clinic's appointments for
 * one doctor on one date are a handful of rows, and expressing the interval
 * maths in the query would mean raw SQL against a string column.
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

/** `HH:MM` (24-hour) to minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** Minutes since midnight back to `HH:MM`, for reporting where a clash ends. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Do two appointments overlap?
 *
 * Half-open intervals: back-to-back appointments (09:00–09:30 and 09:30–10:00)
 * do not overlap, which is the whole point of booking them that way.
 */
export function intervalsOverlap(
  startA: string,
  durationA: number,
  startB: string,
  durationB: number
): boolean {
  const aStart = timeToMinutes(startA)
  const bStart = timeToMinutes(startB)
  return aStart < bStart + durationB && bStart < aStart + durationA
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
  scheduledDate: Date
  scheduledTime: string
  duration: number
  doctorId?: string | null
  chairId?: string | null
  /** The appointment being rescheduled, which must not clash with itself. */
  excludeAppointmentId?: string | null
}

export interface AppointmentConflict {
  resource: 'doctor' | 'chair'
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
 * Every appointment that overlaps the proposed slot on the same doctor or the
 * same chair. Empty means the slot is free.
 */
export async function findAppointmentConflicts(
  query: ConflictQuery
): Promise<AppointmentConflict[]> {
  const { hospitalId, scheduledDate, scheduledTime, duration, doctorId, chairId } = query

  if (!doctorId && !chairId) return []

  const resourceFilters: Record<string, unknown>[] = []
  if (doctorId) resourceFilters.push({ doctorId })
  if (chairId) resourceFilters.push({ chairId })

  const sameDay = await prisma.appointment.findMany({
    where: {
      hospitalId,
      scheduledDate,
      status: { notIn: [...BLOCKING_STATUSES_EXCLUDED] as never },
      OR: resourceFilters,
      ...(query.excludeAppointmentId ? { id: { not: query.excludeAppointmentId } } : {}),
    },
    select: {
      id: true,
      appointmentNo: true,
      scheduledTime: true,
      duration: true,
      doctorId: true,
      chairId: true,
      patient: { select: { firstName: true, lastName: true } },
      doctor: { select: { firstName: true, lastName: true } },
      chair: { select: { name: true } },
    },
  })

  const conflicts: AppointmentConflict[] = []

  for (const existing of sameDay) {
    if (!intervalsOverlap(scheduledTime, duration, existing.scheduledTime, existing.duration)) {
      continue
    }

    const patientName = `${existing.patient.firstName} ${existing.patient.lastName}`.trim()
    const endTime = minutesToTime(timeToMinutes(existing.scheduledTime) + existing.duration)

    // One appointment can clash on both resources — the same dentist *and* the
    // same chair. Report each, so the message names what actually needs moving.
    if (doctorId && existing.doctorId === doctorId) {
      const doctorName = `Dr. ${existing.doctor.firstName} ${existing.doctor.lastName}`.trim()
      conflicts.push({
        resource: 'doctor',
        appointmentId: existing.id,
        appointmentNo: existing.appointmentNo,
        scheduledTime: existing.scheduledTime,
        endTime,
        duration: existing.duration,
        patientName,
        resourceName: doctorName,
        message: `${doctorName} is with ${patientName} from ${existing.scheduledTime} to ${endTime} (${existing.appointmentNo})`,
      })
    }

    if (chairId && existing.chairId === chairId) {
      const chairName = existing.chair?.name ?? 'This chair'
      conflicts.push({
        resource: 'chair',
        appointmentId: existing.id,
        appointmentNo: existing.appointmentNo,
        scheduledTime: existing.scheduledTime,
        endTime,
        duration: existing.duration,
        patientName,
        resourceName: chairName,
        message: `${chairName} is occupied by ${patientName} from ${existing.scheduledTime} to ${endTime} (${existing.appointmentNo})`,
      })
    }
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
