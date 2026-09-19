import { LabWorkType } from '@prisma/client'

/**
 * The kinds of work a dental laboratory is asked for — one list, in one
 * spelling.
 *
 * There were three spellings of this list in the application and they did not
 * agree. `LabOrder.workType` is a Prisma enum, so the only value the column
 * accepts is UPPER_SNAKE; the lab screen's filter used that; the new-order form
 * offered lower case. The consequences were not subtle:
 *
 *  - **No lab case could be raised through the interface.** The form posted
 *    `crown`, the enum rejected it, and the route answered 500. Every case in
 *    the database had been put there by the seed.
 *  - The filter on the lab screen passed its value under a name the route did
 *    not read, so it returned the unfiltered list either way.
 *
 * Both screens now take their options from here, and anything arriving from
 * outside is normalised before it reaches the column.
 */

export const WORK_TYPES: { value: LabWorkType; label: string }[] = [
  { value: 'CROWN', label: 'Crown' },
  { value: 'BRIDGE', label: 'Bridge' },
  { value: 'DENTURE', label: 'Denture' },
  { value: 'PARTIAL_DENTURE', label: 'Partial denture' },
  { value: 'IMPLANT_CROWN', label: 'Implant crown' },
  { value: 'VENEER', label: 'Veneer' },
  { value: 'INLAY_ONLAY', label: 'Inlay / onlay' },
  { value: 'NIGHT_GUARD', label: 'Night guard' },
  { value: 'RETAINER', label: 'Retainer' },
  { value: 'ALIGNER', label: 'Aligner' },
  { value: 'MODEL', label: 'Model' },
  { value: 'OTHER', label: 'Other' },
]

const BY_VALUE = new Map(WORK_TYPES.map((type) => [type.value, type]))

/**
 * The enum value for whatever spelling arrived, or null.
 *
 * Accepts `crown`, `CROWN`, `Inlay/Onlay`, `inlay_onlay` and `inlay-onlay` as
 * the same thing. Returns null rather than guessing when it cannot tell, so the
 * caller answers 400 instead of letting Prisma throw a validation error that
 * surfaces as a 500.
 */
export function normaliseWorkType(value: unknown): LabWorkType | null {
  if (typeof value !== 'string') return null

  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_')
  return BY_VALUE.has(key as LabWorkType) ? (key as LabWorkType) : null
}

/** How a work type is written on screen. */
export function workTypeLabel(value: string): string {
  const normalised = normaliseWorkType(value)
  if (normalised) return BY_VALUE.get(normalised)!.label

  // An unrecognised value is shown rather than hidden — it is in the record.
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
