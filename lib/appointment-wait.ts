/**
 * How long a patient waited.
 *
 * `Appointment.waitTime` used to be written at check-in as the check-in time
 * minus the booked start (bug report 12 Oct, finding 32). That is how late the
 * patient was, not how long they sat in the waiting room: somebody who arrived
 * 67 minutes after their slot and was called straight in "waited" 67 minutes,
 * and somebody who came early and sat for an hour waited 0.
 *
 * A wait is the time from check-in to being called in — the moment the
 * appointment moves to IN_PROGRESS. It is written then and not before, so a
 * patient still in the waiting room has no recorded wait; the queue shows how
 * long they have been sitting so far instead.
 */

/** Whole minutes from `from` to `to`, never negative. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000))
}

/** How long somebody checked in at `checkedInAt` has been waiting at `now`. */
export function waitingFor(
  checkedInAt: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!checkedInAt) return null
  const from = new Date(checkedInAt)
  if (Number.isNaN(from.getTime())) return null
  return minutesBetween(from, now)
}

/**
 * The statuses whose `waitTime` is a finished wait: the patient was called in.
 *
 * Only these are averaged. A row that never got past the waiting room has no
 * wait to report, and older rows written under the lateness rule are most
 * often found on appointments that were checked in and then abandoned.
 */
export const CALLED_IN_STATUSES = ['IN_PROGRESS', 'COMPLETED'] as const

/**
 * The mean recorded wait, in whole minutes, over appointments whose patient
 * was called in. A wait of 0 — called in on arrival — counts; it is the best
 * case, and leaving it out made the average worse than the clinic was.
 */
export function averageWait(rows: { status: string; waitTime: number | null }[]): number {
  const waits = rows
    .filter(
      (r) =>
        (CALLED_IN_STATUSES as readonly string[]).includes(r.status) &&
        typeof r.waitTime === 'number'
    )
    .map((r) => r.waitTime as number)
  if (waits.length === 0) return 0
  return Math.round(waits.reduce((sum, w) => sum + w, 0) / waits.length)
}
