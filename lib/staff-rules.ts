/**
 * Rules about a member of staff that the screens and the routes share.
 *
 * Adding somebody, editing them and accepting an invitation used to carry
 * their own ideas of what a phone number is, which fields are private and what
 * a joining date may be, and the bug report of 12 October found them
 * disagreeing in exactly those places (findings 28, 42 and 47). Nothing here
 * touches the database, so the forms import the same rules the API enforces.
 * The parts that do are in lib/staff.ts.
 */

// ────────────────────────────────────────────────────────────────────────────
// Contact details
// ────────────────────────────────────────────────────────────────────────────

/**
 * Does this look like a telephone number?
 *
 * 7 to 15 digits, with `+`, spaces and dashes allowed as people write them:
 * `0300 1234567`, `+92 300-1234567`, a landline `042 3571 2345`. Deliberately
 * not Pakistani-mobile-only — a clinic's staff include landlines, and a locum
 * may well have a foreign number. What it refuses is `abc` (finding 28).
 */
export function isValidPhone(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!/^\+?[\d\s-]+$/.test(trimmed)) return false
  const digits = trimmed.replace(/\D/g, '').length
  return digits >= 7 && digits <= 15
}

export const PHONE_RULE = 'Enter a phone number of 7 to 15 digits, like 0300 1234567'

export const PHONE_PLACEHOLDER = '0300 1234567'

/**
 * Why a phone field is not acceptable, or null.
 *
 * `required` is for the main number; the alternate and emergency numbers may
 * be blank, but if something is written there it has to be a number.
 */
export function phoneProblem(
  value: unknown,
  label: string,
  { required = false }: { required?: boolean } = {}
): string | null {
  const blank = value === undefined || value === null || String(value).trim() === ''
  if (blank) return required ? `${label} is required` : null
  return isValidPhone(value) ? null : `${label}: ${PHONE_RULE}`
}

// ────────────────────────────────────────────────────────────────────────────
// Private details
// ────────────────────────────────────────────────────────────────────────────

/**
 * The fields of a staff record that are the person's own business.
 *
 * Identity documents, date of birth, where they live and who to call if
 * something happens to them. Shown only to callers with `staff:hr` — the
 * administrator and the clinic manager — and not to every colleague who can
 * open the staff directory (finding 42). The directory exists so a dentist can
 * find the receptionist's extension, not her CNIC.
 */
export const STAFF_HR_FIELDS = [
  'cnic',
  'nationalTaxNo',
  'dateOfBirth',
  'address',
  'city',
  'state',
  'postalCode',
  'emergencyContact',
  'emergencyPhone',
] as const

export type StaffHrField = (typeof STAFF_HR_FIELDS)[number]

/**
 * The record without its private fields — absent, not null, so a screen can
 * tell "withheld" from "never filled in".
 */
export function withoutHrFields<T extends Record<string, unknown>>(
  staff: T
): Omit<T, StaffHrField> {
  const out: Record<string, unknown> = { ...staff }
  for (const field of STAFF_HR_FIELDS) delete out[field]
  return out as Omit<T, StaffHrField>
}

// ────────────────────────────────────────────────────────────────────────────
// Joining date
// ────────────────────────────────────────────────────────────────────────────

/**
 * A joining date from a date field, as the stored value.
 *
 * `2026-10-01` is stored as UTC midnight, which the attendance register reads
 * back as the calendar day it names (see `joinedOnOf` in
 * lib/attendance-records.ts). Refused when it is not a real day — `2026-02-30`
 * is not — or when it is after `today`, the clinic's own today: nobody has
 * joined on a day that has not happened yet.
 */
export function parseJoiningDate(
  value: unknown,
  today: string
): { ok: true; date: Date; day: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) {
    return { ok: false, error: 'Joining date must be a date, like 2026-10-01' }
  }
  const day = value.slice(0, 10)
  const date = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    return { ok: false, error: `${day} is not a real date` }
  }
  if (day > today) {
    return { ok: false, error: 'Joining date cannot be in the future' }
  }
  return { ok: true, date, day }
}

// ────────────────────────────────────────────────────────────────────────────
// Audit
// ────────────────────────────────────────────────────────────────────────────

/**
 * The fields an audit entry compares on a staff edit.
 *
 * Dates as days, so a value that did not change does not show up as changed
 * because one side is a Date and the other a string.
 */
export function staffAuditSnapshot(staff: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  alternatePhone?: string | null
  gender?: string | null
  qualification?: string | null
  specialization?: string | null
  licenseNumber?: string | null
  joiningDate?: Date | string | null
  isActive?: boolean | null
  role?: string | null
  clinicalRole?: string | null
  cnic?: string | null
  nationalTaxNo?: string | null
  dateOfBirth?: Date | string | null
  address?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  emergencyContact?: string | null
  emergencyPhone?: string | null
}): Record<string, unknown> {
  const day = (d: Date | string | null | undefined) =>
    d ? (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null
  return {
    firstName: staff.firstName ?? null,
    lastName: staff.lastName ?? null,
    email: staff.email ?? null,
    phone: staff.phone ?? null,
    alternatePhone: staff.alternatePhone ?? null,
    gender: staff.gender ?? null,
    qualification: staff.qualification ?? null,
    specialization: staff.specialization ?? null,
    licenseNumber: staff.licenseNumber ?? null,
    joiningDate: day(staff.joiningDate),
    isActive: staff.isActive ?? null,
    role: staff.role ?? null,
    clinicalRole: staff.clinicalRole ?? null,
    cnic: staff.cnic ?? null,
    nationalTaxNo: staff.nationalTaxNo ?? null,
    dateOfBirth: day(staff.dateOfBirth),
    address: staff.address ?? null,
    city: staff.city ?? null,
    state: staff.state ?? null,
    postalCode: staff.postalCode ?? null,
    emergencyContact: staff.emergencyContact ?? null,
    emergencyPhone: staff.emergencyPhone ?? null,
  }
}
