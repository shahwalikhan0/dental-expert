/**
 * The new-patient and edit-patient forms' checks, said per field.
 *
 * Both forms asked `patientContactProblem` (lib/patient-validation.ts, the
 * server's own checks) and showed the first answer as a toast titled
 * "Validation Error" — which said what was wrong but not where, and only one
 * thing at a time. This asks the same function one field at a time, so every
 * problem is drawn under its own field (docs/UX_STANDARDS.md §5) and the
 * wording is still the server's.
 */
import { patientContactProblem, todayIso } from '@/lib/patient-validation'

export type PatientField =
  | 'firstName'
  | 'lastName'
  | 'phone'
  | 'alternatePhone'
  | 'email'
  | 'dateOfBirth'
  | 'emergencyContactPhone'

export type PatientFieldErrors = Partial<Record<PatientField, string>>

/** The order the form reads in, for "scroll to the first error". */
export const PATIENT_FIELD_ORDER: PatientField[] = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'phone',
  'alternatePhone',
  'email',
  'emergencyContactPhone',
]

export interface PatientFormValues {
  firstName: string
  lastName: string
  phone: string
  alternatePhone: string
  email: string
  dateOfBirth: string
  emergencyContactPhone: string
}

export function patientFormErrors(
  form: PatientFormValues,
  now: Date = new Date()
): PatientFieldErrors {
  const errors: PatientFieldErrors = {}
  if (!form.firstName.trim()) errors.firstName = 'Enter a first name'
  if (!form.lastName.trim()) errors.lastName = 'Enter a last name'
  if (!form.phone.trim()) errors.phone = 'Enter a phone number'

  const options = { today: todayIso(now) }
  for (const field of [
    'phone',
    'alternatePhone',
    'emergencyContactPhone',
    'email',
    'dateOfBirth',
  ] as const) {
    if (errors[field] || !form[field]) continue
    const problem = patientContactProblem({ [field]: form[field] }, now, options)
    if (problem) errors[field] = problem
  }
  return errors
}

/** The first field with an error, in the order the form reads. */
export function firstPatientError(errors: PatientFieldErrors): PatientField | undefined {
  return PATIENT_FIELD_ORDER.find((field) => errors[field])
}
