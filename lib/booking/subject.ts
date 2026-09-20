/**
 * Who the online booking is for.
 *
 * An appointment belongs to a `Patient` or to a `Visitor` and to exactly one of
 * them. A booking made on the clinic's public page has to become one or the
 * other without anybody at the clinic being present to decide, and without the
 * page disclosing anything about who is already a patient.
 *
 * ## What it used to do
 *
 * It looked the phone number up in the patient register, and if it found
 * nothing it answered:
 *
 *     "No patient account found with this phone number. Please contact the
 *      clinic."
 *
 * Two things wrong with that. It turned a public, unauthenticated endpoint into
 * an oracle for "is this number a patient of this dental practice" — ask it
 * about your neighbour's number and it tells you. And it meant a new patient,
 * the one person a clinic most wants to hear from, was the one person the
 * booking page refused.
 *
 * ## What it does now
 *
 * A known number attaches the booking to that patient. An unknown one creates a
 * `Visitor` — the same record a walk-in gets, which the desk then converts into
 * a patient or discards. Nothing in the response says which happened, so the
 * page discloses nothing either way.
 *
 * The match is exact, on an active patient, and only when it is unambiguous. A
 * number shared by two family members matches neither, because guessing which
 * relative is coming in is worse than letting the desk ask.
 */
import type { Prisma } from '@prisma/client'

/** The appointment's owner, as the two mutually exclusive columns. */
export type BookingSubject =
  | { patientId: string; visitorId?: undefined; isKnownPatient: true }
  | { visitorId: string; patientId?: undefined; isKnownPatient: false }

export interface SubjectRequest {
  hospitalId: string
  name: string
  phone: string
  notes?: string | null
}

/**
 * Digits only, for matching a number typed with spaces, dashes or a country
 * code against one stored some other way.
 *
 * Compared on the last nine digits: `+92 300 1234567`, `0300-1234567` and
 * `03001234567` are one number, and a clinic's register contains all three
 * spellings because people typed them in over years.
 */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-9)
}

/**
 * Find the patient this number belongs to, or nobody.
 *
 * Deliberately narrow. It reads only the id, so nothing about a patient can
 * escape through this path even by accident, and it returns null on more than
 * one match.
 */
export async function matchPatientByPhone(
  tx: Prisma.TransactionClient,
  hospitalId: string,
  phone: string
): Promise<string | null> {
  const key = phoneKey(phone)
  if (key.length < 7) return null

  // `endsWith` on the stored number: an index cannot serve this, but the
  // candidate set is one clinic's register and the alternative is a normalised
  // column that every write path would have to keep in step.
  const matches = await tx.patient.findMany({
    where: { hospitalId, isActive: true, phone: { endsWith: key } },
    select: { id: true },
    take: 2,
  })

  return matches.length === 1 ? matches[0].id : null
}

/**
 * Resolve a booking to a patient or a new visitor.
 *
 * Runs inside the booking transaction, so a visitor is never created for an
 * appointment that then fails to be.
 */
export async function resolveSubject(
  tx: Prisma.TransactionClient,
  request: SubjectRequest
): Promise<BookingSubject> {
  const patientId = await matchPatientByPhone(tx, request.hospitalId, request.phone)

  if (patientId) return { patientId, isKnownPatient: true }

  const visitor = await tx.visitor.create({
    data: {
      hospitalId: request.hospitalId,
      name: request.name,
      phone: request.phone,
      // Says where the row came from, because the walk-ins screen shows
      // visitors the desk created at the counter beside ones that arrived
      // through the website, and they need different handling: nobody has met
      // this one.
      notes: ['Booked online.', request.notes?.trim()].filter(Boolean).join(' '),
    },
    select: { id: true },
  })

  return { visitorId: visitor.id, isKnownPatient: false }
}

/** The two columns, for the appointment's `data`. */
export function subjectColumns(subject: BookingSubject): {
  patientId: string | null
  visitorId: string | null
} {
  return {
    patientId: subject.patientId ?? null,
    visitorId: subject.visitorId ?? null,
  }
}
