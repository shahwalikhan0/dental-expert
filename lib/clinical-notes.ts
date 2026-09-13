/**
 * FR-007 — "Completed/signed notes must be locked or version-controlled with
 * audit history for later amendments." Spec §10 puts it more bluntly: "Lock or
 * version completed clinical notes instead of allowing silent overwrite."
 *
 * What was there before: `Treatment` had no signature at all. `COMPLETED` is a
 * workflow status, and the only protection was a rule that let anyone holding
 * `clinical:delete` — ADMIN, who deliberately cannot sign a note — rewrite a
 * completed one with no record of what changed. That is the silent overwrite
 * the spec names. A completed treatment could also be deleted outright, so
 * long as it had not been invoiced.
 *
 * The model here:
 *
 *  - signing is a clinical act, `clinical:sign`, which only DOCTOR holds
 *  - a signed note is locked: it cannot be deleted, by anyone, ever
 *  - additions go in an addendum, attributed and append-only
 *  - a factual correction is allowed, but only by a clinician, only with a
 *    reason, and only by writing down what the note said before
 */

/** The clinical content of a note — the fields an amendment has to account for. */
export const CLINICAL_NOTE_FIELDS = [
  'toothNumbers',
  'chiefComplaint',
  'diagnosis',
  'findings',
  'procedureNotes',
  'materialsUsed',
  'complications',
  'followUpRequired',
  'followUpDate',
  'followUpNotes',
] as const

export type ClinicalNoteField = (typeof CLINICAL_NOTE_FIELDS)[number]

/**
 * Fields that stay editable after signing without counting as an amendment.
 *
 * `cost` and `status` are billing and workflow, not the clinical record: a
 * signed note whose price is corrected has not had its clinical content
 * changed, and forcing a clinical amendment reason for a pricing fix would
 * teach people to type meaningless reasons.
 */
export const NON_CLINICAL_FIELDS = ['cost', 'status'] as const

export interface SignableTreatment {
  signedAt?: Date | null
  status?: string | null
}

export function isSigned(treatment: SignableTreatment): boolean {
  return !!treatment.signedAt
}

export type FieldChange = { from: unknown; to: unknown }
export type ChangeSet = Record<string, FieldChange>

/**
 * Which clinical fields a proposed update would actually change.
 *
 * Only fields present in the request are considered, and a value equal to what
 * is already stored is not a change — resubmitting a form unchanged must not
 * manufacture an amendment record.
 */
export function diffClinicalFields(
  existing: Record<string, unknown>,
  update: Record<string, unknown>
): ChangeSet {
  const changes: ChangeSet = {}

  for (const field of CLINICAL_NOTE_FIELDS) {
    if (!(field in update)) continue

    const before = normalise(existing[field])
    const after = normalise(update[field])
    if (before !== after) {
      changes[field] = { from: existing[field] ?? null, to: update[field] ?? null }
    }
  }

  return changes
}

/**
 * Compare by value, not by reference or type.
 *
 * Dates arrive as ISO strings from the request and as `Date` from the
 * database; null and '' both mean "not recorded" in these columns, and a note
 * whose empty field is resubmitted as null has not been amended.
 */
function normalise(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const asString = String(value)
  // An ISO-ish date string and a Date for the same instant must compare equal.
  const asDate = new Date(asString)
  if (!Number.isNaN(asDate.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(asString)) {
    return asDate.toISOString()
  }
  return asString
}

export const MIN_REASON_LENGTH = 10

/**
 * Why an amendment reason has a floor: "fix", "typo" and "." are what get
 * typed when the field is merely required, and none of them tells the next
 * reader what was wrong.
 */
export function isUsableReason(reason: unknown): reason is string {
  return typeof reason === 'string' && reason.trim().length >= MIN_REASON_LENGTH
}
