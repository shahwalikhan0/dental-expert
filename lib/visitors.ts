/**
 * Visitors — people the clinic has seen but not registered.
 *
 * A dental practice sees walk-ins, emergencies, and relatives who came in with
 * somebody else and asked about a tooth while they were there. Requiring a full
 * patient record before any of them can be given a token produces a register
 * full of people with a first name, a guessed age and nothing else, and it
 * produces it at the front desk, at the busiest moment of the day.
 *
 * So an appointment belongs to a `Patient` or to a `Visitor`, and exactly one
 * of the two. A visitor is a name and, usually, a number. Later somebody
 * decides: convert them, and every appointment they have follows them into the
 * patient record; or discard them, and the row stays so the visit can still be
 * accounted for.
 */

export interface VisitorLike {
  id: string
  name: string
  phone: string | null
  convertedPatientId: string | null
  convertedAt: Date | string | null
  discardedAt: Date | string | null
}

export type VisitorState = 'OPEN' | 'CONVERTED' | 'DISCARDED'

export function visitorState(visitor: {
  convertedAt: Date | string | null
  discardedAt: Date | string | null
}): VisitorState {
  if (visitor.convertedAt) return 'CONVERTED'
  if (visitor.discardedAt) return 'DISCARDED'
  return 'OPEN'
}

/** Only an open visitor can be converted or discarded. */
export function canDecideOn(visitor: {
  convertedAt: Date | string | null
  discardedAt: Date | string | null
}): boolean {
  return visitorState(visitor) === 'OPEN'
}

/**
 * A visitor's name split for a patient record.
 *
 * The desk types a whole name into one box, because asking a walk-in to
 * decompose their name into two fields is how you end up with "Muhammad" in the
 * surname column. Everything before the last space is the given name — which is
 * a guess, and the conversion screen shows it for correction rather than
 * committing it silently.
 */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  }
}

/** A visitor needs a name; everything else is optional by design. */
export function validateVisitor(input: { name?: unknown; phone?: unknown }): string | null {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 2) return 'A visitor needs a name'
  if (name.length > 120) return 'That name is too long'

  if (input.phone != null && typeof input.phone === 'string' && input.phone.trim()) {
    const digits = input.phone.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) return 'That phone number does not look right'
  }

  return null
}

/** What the queue and the book call this appointment's subject. */
export function subjectName(appointment: {
  patient?: { firstName: string; lastName: string } | null
  visitor?: { name: string } | null
}): string {
  if (appointment.patient) {
    return `${appointment.patient.firstName} ${appointment.patient.lastName}`.trim()
  }
  return appointment.visitor?.name ?? 'Unknown'
}

/** And their number, whichever kind of subject it is. */
export function subjectPhone(appointment: {
  patient?: { phone: string | null } | null
  visitor?: { phone: string | null } | null
}): string | null {
  return appointment.patient?.phone ?? appointment.visitor?.phone ?? null
}
