/**
 * FR-001 / UAT-01 — "Register a new patient and detect a likely duplicate".
 *
 * One hard block lives in the create route: a repeated CNIC is refused, because
 * a CNIC identifies a person. A repeated *phone number* used to be refused too
 * and is not any more — families share a number, and refusing the second child
 * of the same household was refusing a real registration.
 *
 * So this is now the whole of the duplicate check that matters, and it catches
 * what no unique index ever could: the same person walking back in with a new
 * number. A warning while the form is being filled, offering the record that
 * already exists.
 *
 * Deliberately deterministic. The desk is being asked to decide whether two
 * records are one person, so it is shown which fields matched and how closely;
 * a score it cannot interrogate would be worse than no score. Everything here
 * is a pure function over two records, which also means it can be tested
 * without a database.
 */

export interface Candidate {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  cnic: string | null
  dateOfBirth: Date | string | null
}

export interface Enquiry {
  firstName: string
  lastName: string
  phone?: string | null
  email?: string | null
  cnic?: string | null
  dateOfBirth?: string | null
}

export interface Duplicate {
  id: string
  patientId: string
  name: string
  confidence: number
  matchFields: string[]
}

/** Anything below this is not shown: a warning nobody trusts gets clicked past. */
export const REPORT_THRESHOLD = 0.6

/** Names compare on letters alone — "Muhammad Ali", "muhammad  ali" and
 *  "Muhammad-Ali" are one name typed three ways. */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/** Digits only, so 0300-1234567, 03001234567 and +92 300 1234567 compare equal
 *  on their last nine digits — the part that identifies the subscriber. */
export function normalisePhone(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length > 9 ? digits.slice(-9) : digits
}

export function normaliseCnic(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

export function normaliseEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** The calendar day, ignoring any time and any timezone shift on the stored
 *  value — a date of birth is a date, and nothing else. */
export function birthDay(value: Date | string | null | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  if (Number.isNaN(value.getTime())) return ''
  return value.toISOString().slice(0, 10)
}

/** Levenshtein distance, iterative with a single row. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution)
    }
    previous = current
  }

  return previous[b.length]
}

/**
 * 1 for identical, 0 for nothing in common. Word order is ignored: registers
 * disagree often enough about which part of a Pakistani name is the family name
 * that "Sana Malik" and "Malik Sana" must not read as two people.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normaliseName(a)
  const right = normaliseName(b)
  if (!left || !right) return 0
  if (left === right) return 1

  const sorted = (value: string) => value.split(' ').sort().join(' ')
  if (sorted(left) === sorted(right)) return 1

  const longest = Math.max(left.length, right.length)
  return Math.max(0, 1 - editDistance(left, right) / longest)
}

/**
 * How alike are these two, and on what?
 *
 * The weights say something specific: an identifier two people cannot share is
 * conclusive on its own, a phone number nearly so, and a name is never enough
 * by itself — a clinic with two unrelated Muhammad Alis is a clinic, not a data
 * problem. So a name only raises a warning when a second field agrees with it.
 */
export function compare(enquiry: Enquiry, candidate: Candidate): Duplicate | null {
  const matchFields: string[] = []
  let confidence = 0

  const cnic = normaliseCnic(enquiry.cnic)
  if (cnic && cnic === normaliseCnic(candidate.cnic)) {
    matchFields.push('CNIC')
    confidence = 1
  }

  const phone = normalisePhone(enquiry.phone)
  if (phone && phone === normalisePhone(candidate.phone)) {
    matchFields.push('phone')
    confidence = Math.max(confidence, 0.95)
  }

  const email = normaliseEmail(enquiry.email)
  if (email && email === normaliseEmail(candidate.email)) {
    matchFields.push('email')
    confidence = Math.max(confidence, 0.85)
  }

  const similarity = nameSimilarity(
    `${enquiry.firstName} ${enquiry.lastName}`,
    `${candidate.firstName} ${candidate.lastName}`
  )
  const sameName = similarity >= 0.85

  const dob = enquiry.dateOfBirth?.slice(0, 10) ?? ''
  const sameBirthday = Boolean(dob) && dob === birthDay(candidate.dateOfBirth)

  if (sameName) matchFields.push(similarity === 1 ? 'name' : 'similar name')
  if (sameBirthday) matchFields.push('date of birth')

  // The case this whole file exists for: same person, new phone number.
  if (sameName && sameBirthday) {
    confidence = Math.max(confidence, similarity === 1 ? 0.9 : 0.75)
  } else if (sameName && matchFields.length > 1) {
    // A name agreeing with a phone, email or CNIC that already scored.
    confidence = Math.max(confidence, 0.8)
  }

  if (confidence < REPORT_THRESHOLD) return null

  return {
    id: candidate.id,
    patientId: candidate.patientId,
    name: `${candidate.firstName} ${candidate.lastName}`,
    confidence: Math.round(confidence * 100) / 100,
    matchFields,
  }
}

/** Strongest match first, capped — a list of maybes is not a warning. */
export function findDuplicates(enquiry: Enquiry, candidates: Candidate[], limit = 5): Duplicate[] {
  return candidates
    .map((candidate) => compare(enquiry, candidate))
    .filter((match): match is Duplicate => match !== null)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit)
}
