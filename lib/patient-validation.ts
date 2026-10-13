/**
 * What a patient's date of birth and contact details have to look like.
 *
 * Registration accepted anything (bug report 12 Oct, finding 30): a date of
 * birth in 2030, `xyz` as a phone number, `nope` as an email address. Each of
 * those breaks something further down the line without saying so — the age
 * column reads blank, the reminder SMS goes nowhere, the statement email
 * bounces — and nobody finds out until the patient asks why they were never
 * told.
 *
 * Shared by the API and the registration and edit forms, so the desk is told
 * before it presses Save and the server refuses the same things when a caller
 * skips the form. Nothing here imports Prisma; it has to run in the browser.
 */

/** Digits, an optional leading +, and the spaces and dashes people type. */
const PHONE_SHAPE = /^\+?[\d\s-]+$/
const PHONE_MIN_DIGITS = 7
const PHONE_MAX_DIGITS = 15

/**
 * Deliberately loose: something, an @, something with a dot in it. The full
 * RFC grammar refuses nothing a real clinic will ever be given, and a stricter
 * pattern than this starts refusing real addresses.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The oldest anybody on a register can plausibly be. Matches lib/age.ts. */
const MAX_AGE_YEARS = 150

export function isValidPhone(value: string): boolean {
  const trimmed = value.trim()
  if (!PHONE_SHAPE.test(trimmed)) return false
  const digits = trimmed.replace(/\D/g, '').length
  return digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS
}

export function isValidEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim())
}

export interface DateOfBirthOptions {
  /** The caller's own calendar day as `YYYY-MM-DD`, when it has one. */
  today?: string
}

/**
 * Why this date of birth cannot be right, or null.
 *
 * "In the future" is judged against the furthest-ahead calendar on earth
 * (UTC+14) on the server, because a `YYYY-MM-DD` arrives as midnight UTC and a
 * baby born this morning in Karachi is otherwise refused for being born
 * tomorrow. The form passes the browser's own `today`, so the desk gets the
 * exact answer.
 */
export function dateOfBirthProblem(
  value: string | Date | null | undefined,
  now: Date = new Date(),
  options: DateOfBirthOptions = {}
): string | null {
  if (value === null || value === undefined || value === '') return null

  const dob = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(dob.getTime())) return 'Date of birth is not a valid date'

  // A form knows the desk's own calendar day, and a `YYYY-MM-DD` compares
  // exactly against it as text.
  const future =
    options.today && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value > options.today
      : dob.getTime() > now.getTime() + 14 * 3600_000
  if (future) return 'Date of birth cannot be in the future'

  const oldest = new Date(now)
  oldest.setUTCFullYear(oldest.getUTCFullYear() - MAX_AGE_YEARS)
  if (dob < oldest) return `Date of birth is more than ${MAX_AGE_YEARS} years ago`

  return null
}

export interface PatientContactFields {
  phone?: unknown
  alternatePhone?: unknown
  emergencyContactPhone?: unknown
  email?: unknown
  dateOfBirth?: unknown
}

const PHONE_FIELDS = [
  ['phone', 'Phone'],
  ['alternatePhone', 'Alternate phone'],
  ['emergencyContactPhone', 'Emergency contact phone'],
] as const

const PHONE_HINT = 'should be 7 to 15 digits, with an optional + and spaces or dashes'

/**
 * The first thing wrong with these fields, in words a toast can show, or null.
 *
 * Only the fields present are checked, and a blank optional field is fine —
 * an edit that does not send the email has not asked to change it, and a
 * patient with no email address is common. Whether the phone is required is
 * the caller's decision, made before this is asked.
 */
export function patientContactProblem(
  fields: PatientContactFields,
  now: Date = new Date(),
  options: DateOfBirthOptions = {}
): string | null {
  for (const [key, label] of PHONE_FIELDS) {
    const value = fields[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string' || !isValidPhone(value)) {
      return `${label} ${PHONE_HINT}`
    }
  }

  const email = fields.email
  if (email !== undefined && email !== null && email !== '') {
    if (typeof email !== 'string' || !isValidEmail(email)) {
      return 'Email is not a valid email address'
    }
  }

  const dob = fields.dateOfBirth
  if (dob !== undefined && dob !== null && dob !== '') {
    if (typeof dob !== 'string' && !(dob instanceof Date)) {
      return 'Date of birth is not a valid date'
    }
    const problem = dateOfBirthProblem(dob, now, options)
    if (problem) return problem
  }

  return null
}

/** Today as `YYYY-MM-DD` on this machine's calendar, for `dateOfBirthProblem`'s `today`. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
