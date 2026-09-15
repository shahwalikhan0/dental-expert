/**
 * How old somebody is, from their date of birth.
 *
 * `Patient.age` used to be a column, written once at registration and never
 * again — so it was wrong for most of the year after it was recorded, and a
 * patient registered at 34 stayed 34 forever. The analytics report already
 * ignored it and computed age from `dateOfBirth`, which is the tell: two
 * places in the application disagreed about how old a patient was.
 */

/** Whole years between a date of birth and a moment, or null if unknown. */
export function ageInYears(
  dateOfBirth: Date | string | null | undefined,
  at: Date = new Date()
): number | null {
  if (!dateOfBirth) return null

  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null

  let years = at.getUTCFullYear() - dob.getUTCFullYear()

  // Not had this year's birthday yet.
  const month = at.getUTCMonth() - dob.getUTCMonth()
  if (month < 0 || (month === 0 && at.getUTCDate() < dob.getUTCDate())) years--

  // A date of birth in the future is a typo, not a negative age.
  return years >= 0 ? years : null
}
