import type { BloodGroup, Gender } from '@prisma/client'

/**
 * How the database's own words are written on screen.
 *
 * The patient list and the patient record both showed `A_POSITIVE` for a blood
 * group and `FEMALE` as a shouty badge — the column values, rendered straight
 * out. The mapping existed the whole time, duplicated in the two patient
 * *forms* (`{ value: 'A_POSITIVE', label: 'A+' }`) and used by neither the list
 * nor the record.
 *
 * One list, one direction. A screen that shows an enum reads it from here; a
 * form that offers the choices reads the options from here too, so the two can
 * no longer disagree about what `AB_NEGATIVE` is called.
 */

export const BLOOD_GROUP_LABELS: Record<BloodGroup, string> = {
  A_POSITIVE: 'A+',
  A_NEGATIVE: 'A−',
  B_POSITIVE: 'B+',
  B_NEGATIVE: 'B−',
  AB_POSITIVE: 'AB+',
  AB_NEGATIVE: 'AB−',
  O_POSITIVE: 'O+',
  O_NEGATIVE: 'O−',
}

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
}

/** The options a form offers, in the order they are offered. */
export const BLOOD_GROUP_OPTIONS = (Object.keys(BLOOD_GROUP_LABELS) as BloodGroup[]).map(
  (value) => ({ value, label: BLOOD_GROUP_LABELS[value] })
)

export const GENDER_OPTIONS = (Object.keys(GENDER_LABELS) as Gender[]).map((value) => ({
  value,
  label: GENDER_LABELS[value],
}))

/**
 * A fallback for the enums that have no hand-written list.
 *
 * `IN_PROGRESS` becomes "In progress" — sentence case, not Title Case, because
 * these appear inside sentences and in badges next to ordinary prose. An
 * unrecognised value is title-cased rather than hidden: it is in the record,
 * and refusing to show it does not make it go away.
 */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—'
  const words = value.toLowerCase().split('_').filter(Boolean)
  if (words.length === 0) return '—'
  return (
    words[0].charAt(0).toUpperCase() +
    words[0].slice(1) +
    (words.length > 1 ? ' ' + words.slice(1).join(' ') : '')
  )
}

export function bloodGroupLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return BLOOD_GROUP_LABELS[value as BloodGroup] ?? humanise(value)
}

export function genderLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return GENDER_LABELS[value as Gender] ?? humanise(value)
}
