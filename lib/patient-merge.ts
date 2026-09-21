import { normalizeList } from './medical-history'

/**
 * Merging two patient records that turned out to be one person.
 *
 * The front desk creates this duplicate constantly — somebody returns with a
 * new phone number, or the same name is typed twice on a Monday morning — and
 * until now the application could warn about it at registration
 * (`lib/duplicate-patients.ts`) and do nothing at all about it afterwards. A
 * clinic was left with two half-histories for one mouth, which is worse than
 * either of them alone: the dentist reading one does not know the other exists.
 *
 * Two decisions worth stating.
 *
 * **Nothing clinical is thrown away.** Every appointment, treatment, invoice,
 * prescription, chart entry, document and lab order moves across. The medical
 * histories are unioned rather than overwritten, because an allergy recorded on
 * only one of the two records is still an allergy — losing it to a tidy-up is
 * the one outcome this must never produce.
 *
 * **The loser is deactivated, not deleted.** Its patient ID is written on
 * paper the clinic has already handed out, and somebody looking it up next
 * month should be told where the record went.
 */

/** The field-by-field decisions, so a caller can describe what will happen. */
export interface MergePlan {
  /** Fields that were blank on the surviving record and are filled from the other. */
  filled: string[]
  /** Counts of what moves, by kind, for the confirmation the desk is shown. */
  moved: Record<string, number>
}

/** Scalar fields worth rescuing from the record being retired. */
const FILLABLE = [
  'dateOfBirth',
  'gender',
  'bloodGroup',
  'alternatePhone',
  'email',
  'address',
  'city',
  'state',
  'postalCode',
  'cnic',
  'occupation',
  'referredBy',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
] as const

/**
 * Which of the surviving record's blanks the retired one can fill.
 *
 * Only blanks. A value on the surviving record always wins, because the desk
 * chose which record survives and that choice should not be quietly undone
 * field by field — the merge is meant to add what is missing, not to overwrite
 * what somebody has already confirmed.
 */
export function fillableFrom(
  keep: Record<string, unknown>,
  retire: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  for (const field of FILLABLE) {
    const current = keep[field]
    const candidate = retire[field]
    const blank = current === null || current === undefined || current === ''
    const has = candidate !== null && candidate !== undefined && candidate !== ''
    if (blank && has) patch[field] = candidate
  }

  return patch
}

/**
 * One medical history out of two.
 *
 * The lists are unioned: an allergy known to one record and not the other is
 * still an allergy. `normalizeList` drops the case-insensitive duplicates that
 * a union of two hand-typed lists always produces.
 *
 * The scalars take the surviving record's answer unless it has none. Pregnancy
 * is the exception in one direction only — if either record says so, the merged
 * record says so, because the cost of dropping it is a radiograph nobody should
 * have taken.
 */
export function mergeMedicalHistory(
  keep: {
    allergies?: string[] | null
    conditions?: string[] | null
    currentMedications?: string[] | null
    isPregnant?: boolean | null
    pregnancyWeeks?: number | null
  } | null,
  retire: {
    allergies?: string[] | null
    conditions?: string[] | null
    currentMedications?: string[] | null
    isPregnant?: boolean | null
    pregnancyWeeks?: number | null
  } | null
) {
  return {
    allergies: normalizeList([...(keep?.allergies ?? []), ...(retire?.allergies ?? [])]),
    conditions: normalizeList([...(keep?.conditions ?? []), ...(retire?.conditions ?? [])]),
    currentMedications: normalizeList([
      ...(keep?.currentMedications ?? []),
      ...(retire?.currentMedications ?? []),
    ]),
    isPregnant: Boolean(keep?.isPregnant || retire?.isPregnant),
    pregnancyWeeks: keep?.pregnancyWeeks ?? retire?.pregnancyWeeks ?? null,
  }
}

/**
 * Can these two be merged at all?
 *
 * Returns the reason if not, so the caller can say it rather than returning a
 * bare refusal.
 */
export function mergeRefusal(
  keep: { id: string; hospitalId: string; mergedIntoId: string | null } | null,
  retire: { id: string; hospitalId: string; mergedIntoId: string | null } | null
): string | null {
  if (!keep || !retire) return 'One of those patient records could not be found'
  if (keep.id === retire.id) return 'A record cannot be merged into itself'
  if (keep.hospitalId !== retire.hospitalId) return 'Those records belong to different clinics'
  if (retire.mergedIntoId) return 'That record has already been merged into another'
  // Merging into a record that is itself a merged-away duplicate would leave a
  // chain the desk has to follow. Merge into the one that survived instead.
  if (keep.mergedIntoId) {
    return 'The record you are merging into has itself been merged into another'
  }
  return null
}
