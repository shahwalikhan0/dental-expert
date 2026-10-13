/**
 * Which status an appointment may move to from the one it is in.
 *
 * `PUT /api/appointments/[id]` wrote whatever status it was sent (bug report
 * 12 Oct, finding 8): SCHEDULED straight to COMPLETED with nobody checked in or
 * out, then back to SCHEDULED, every step a 200. The visit record then claimed
 * an attendance nobody recorded, with no check-in time, no token and no wait.
 *
 * The rules:
 *
 *  - CHECKED_IN is reached only through the check-in route, which issues the
 *    token, and COMPLETED only through the check-out route. Neither is a
 *    status the edit route will set.
 *  - IN_PROGRESS is "called in" from the waiting room, so only a checked-in
 *    appointment can reach it.
 *  - COMPLETED, CANCELLED, NO_SHOW and RESCHEDULED are where an appointment
 *    ends. None is reopened: a patient who did come after all, or who rebooks,
 *    gets a new appointment, and the record of what happened stays as it was.
 *
 * Pure and free of Prisma, so the screens can hide an action the API would
 * refuse rather than offer a button that only ever produces an error.
 */

export type AppointmentStatusName =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED'

export const STATUS_TRANSITIONS: Record<AppointmentStatusName, AppointmentStatusName[]> = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
  CONFIRMED: ['SCHEDULED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
  // A patient who gives up and leaves the waiting room is a cancellation.
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: [],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
}

/** The statuses an appointment can be moved, re-timed or stretched in. */
export const BOOKED_STATUSES: AppointmentStatusName[] = ['SCHEDULED', 'CONFIRMED']

export function isBooked(status: string): boolean {
  return (BOOKED_STATUSES as string[]).includes(status)
}

export function canMoveTo(from: string, to: string): boolean {
  if (from === to) return true
  return (STATUS_TRANSITIONS[from as AppointmentStatusName] ?? []).includes(
    to as AppointmentStatusName
  )
}

/**
 * Why `from` → `to` is refused, in words for the toast, or null if it is not.
 */
export function transitionRefusal(from: string, to: string): string | null {
  if (canMoveTo(from, to)) return null
  if (to === 'CHECKED_IN') return 'Use Check In, which issues the patient their token.'
  if (to === 'COMPLETED') return 'Use Check Out to finish an appointment.'
  if (to === 'IN_PROGRESS') return 'Only a patient who has checked in can be called in.'
  const allowed = STATUS_TRANSITIONS[from as AppointmentStatusName] ?? []
  return allowed.length === 0
    ? `This appointment is ${from} and can no longer change status. Book a new appointment instead.`
    : `An appointment that is ${from} can only become ${allowed.join(', ')}.`
}

/**
 * The 400 for booking or moving an appointment for a deactivated patient (bug
 * report 12 Oct, finding 22).
 */
export const INACTIVE_PATIENT =
  "This patient's record is deactivated, so they cannot be booked. Reactivate the record first."

/** A no-show can only be recorded once the appointment's time has come. */
export function noShowTooEarly(startsAt: Date | string, now: Date = new Date()): boolean {
  return new Date(startsAt).getTime() > now.getTime()
}
