/**
 * The rules a prescription is checked against, in one place.
 *
 * Shared by the New Prescription screen and `POST /api/prescriptions`. Each
 * rule used to live on one side only (bug report 12 Oct):
 *
 *  - The screen checked the rows and the API did not, so an empty row reached
 *    Prisma and came back as a 500 carrying the server's build path and the
 *    query (finding 4).
 *  - The screen checked allergies and the API did not, so a template, a script
 *    or any future screen prescribed amoxicillin to a patient recorded as
 *    allergic to penicillin without a word (finding 35).
 *
 * Nothing here touches the database, so the browser can import it.
 */
import { allergyClashes, type AllergyClash } from '@/lib/medical-history'

/** A prescribed line as it arrives from a screen, before it is trusted. */
export interface PrescriptionLineInput {
  medicationId?: unknown
  medicationName?: unknown
  dosage?: unknown
  frequency?: unknown
  duration?: unknown
  route?: unknown
  timing?: unknown
  quantity?: unknown
  instructions?: unknown
}

const REQUIRED_FIELDS = [
  ['medicationName', 'the medicine'],
  ['dosage', 'a dosage'],
  ['frequency', 'a frequency'],
  ['duration', 'a duration'],
] as const

const OPTIONAL_TEXT_FIELDS = ['route', 'timing', 'instructions'] as const

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Nothing typed into the row at all — the blank line a new form opens with. */
export function isEmptyLine(line: PrescriptionLineInput | null | undefined): boolean {
  if (!line || typeof line !== 'object') return true
  return (
    !text(line.medicationName) &&
    !text(line.dosage) &&
    !text(line.frequency) &&
    !text(line.duration) &&
    !text(line.instructions) &&
    (line.quantity === undefined || line.quantity === null || line.quantity === '')
  )
}

/**
 * Why this one line cannot be prescribed, or null.
 *
 * `index` is zero-based; the sentence numbers from one, as the screen does
 * ("Medication 2"), so the toast points at the row the prescriber can see.
 */
export function lineRefusal(line: PrescriptionLineInput | null | undefined, index: number) {
  const label = `Medication ${index + 1}`

  if (isEmptyLine(line)) {
    return `${label} is empty. Choose a medicine and give it a dosage, frequency and duration, or remove the row.`
  }
  const row = line as PrescriptionLineInput

  const named = text(row.medicationName)
  const which = named ? `${label} (${named})` : label

  for (const [field, words] of REQUIRED_FIELDS) {
    if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') {
      return `${which}: ${field} must be text.`
    }
    if (!text(row[field])) return `${which} needs ${words}.`
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = row[field]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${which}: ${field} must be text.`
    }
  }

  if (
    row.medicationId !== undefined &&
    row.medicationId !== null &&
    typeof row.medicationId !== 'string'
  ) {
    return `${which}: medicationId must be text.`
  }

  // `parseInt('')` on the screen and a stray string from anywhere else both
  // end up here; Prisma would otherwise answer them with a 500.
  const quantity = row.quantity
  if (quantity !== undefined && quantity !== null && quantity !== '') {
    const n = typeof quantity === 'number' ? quantity : Number(quantity)
    if (!Number.isInteger(n) || n <= 0) {
      return `${which}: the quantity must be a whole number above zero.`
    }
  }

  return null
}

/**
 * Why these lines cannot be prescribed, or null.
 *
 * Every row is checked, including an empty one: by the time a request reaches
 * the server, a blank row is a mistake to be named rather than quietly
 * dropped — dropping it is how a dentist ends up issuing two medicines out of
 * the three they wrote.
 */
export function prescriptionLinesRefusal(lines: unknown): string | null {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 'Add at least one medication with a dosage, frequency and duration.'
  }
  for (let i = 0; i < lines.length; i++) {
    const refusal = lineRefusal(lines[i] as PrescriptionLineInput, i)
    if (refusal) return refusal
  }
  return null
}

/** One allergy clash, with the row it came from. */
export interface LineAllergyClash extends AllergyClash {
  /** Zero-based, as in the request. */
  line: number
}

/**
 * Which lines clash with a recorded allergy.
 *
 * The same matching the New Prescription screen has always used —
 * `allergyClashes` over the medicine's name and its generic name — applied to
 * every line. The screen shows the result beside each row; the API refuses
 * the request with it unless the prescriber has said they mean it.
 */
export function prescriptionAllergyClashes(
  allergies: string[] | null | undefined,
  lines: Array<{ name?: string | null; genericName?: string | null }>
): LineAllergyClash[] {
  if (!allergies?.length) return []
  return lines.flatMap((line, index) =>
    allergyClashes(allergies, line).map((clash) => ({ ...clash, line: index }))
  )
}

/** "Amoxil 500mg against a recorded allergy to penicillin; …" */
export function describeAllergyClashes(clashes: AllergyClash[]): string {
  return clashes.map((c) => `${c.drug} against a recorded allergy to ${c.allergy}`).join('; ')
}

/**
 * The prescriber's name as it is printed: "Dr. Qasim Ali".
 *
 * Staff names are free text, and clinics write the title into the name as
 * often as not. Prefixing every one gave "Dr. Dr. Qasim Admin" (bug report
 * 12 Oct, finding 66). The title is added only when the name does not already
 * start with it — "Dr", "Dr." or "dr", followed by a space or a dot, so that
 * "Drew" still gets one.
 */
export function prescriberName(
  doctor: { firstName?: string | null; lastName?: string | null } | null | undefined
): string {
  const full = [doctor?.firstName, doctor?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
  if (!full) return ''
  return /^dr(\.|\s|$)/i.test(full) ? full : `Dr. ${full}`
}
