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

/**
 * A date of birth for somebody who knows their age and not their birthday.
 *
 * A front desk is often told "34" and nothing more. The age alone has nowhere
 * to go — there is no column for it — so the registration form used to accept
 * it and drop it. This turns it into the date it implies: today's date, that
 * many years ago, as `YYYY-MM-DD`. It is a year's accuracy, not a day's, and
 * the form says so beside it.
 */
export function birthDateForAge(age: number, today: Date = new Date()): string | null {
  if (!Number.isInteger(age) || age < 0 || age > 150) return null
  const year = today.getFullYear() - age
  const month = String(today.getMonth() + 1).padStart(2, '0')
  // 29 February has no counterpart in most years; the 28th is the same age.
  const day =
    today.getMonth() === 1 && today.getDate() === 29
      ? '28'
      : String(today.getDate()).padStart(2, '0')
  return `${String(year).padStart(4, '0')}-${month}-${day}`
}
