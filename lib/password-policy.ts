/**
 * What makes a password acceptable.
 *
 * Settings → Security has offered six password controls since the day this
 * application shipped — a minimum length, four complexity switches and an
 * expiry — and every one of them wrote a `Setting` row that nothing ever read.
 * A clinic could set a twelve-character minimum with symbols required, see it
 * save, and then create a staff account with the password `a`. The five places
 * that hash a password did not agree with each other either: signup demanded
 * eight characters, an invitation demanded eight, the staff screen demanded
 * six, and the import path generated its own.
 *
 * So the rule lives here and every path that sets a password checks it. One
 * function, one message, one rule — and it is the one the screen says it is.
 */

/**
 * The password rule: a length, and nothing else.
 *
 * Between 8 and 32 characters, the same everywhere a password is set — signup,
 * an invitation, the staff screen, a reset, the portal. There are no
 * capital-letter, number or symbol requirements, no "must differ from the
 * current one" check, and no clinic can add any:
 * composition rules push people towards `Password1!` and a sticky note, which
 * NIST SP 800-63B stopped recommending for that reason. Length is the part
 * that actually makes a password hard to guess.
 */
export const MINIMUM_PASSWORD_LENGTH = 8

export const MAXIMUM_PASSWORD_LENGTH = 32

/**
 * The rule, written the way a person would say it.
 *
 * Shown beside the field *before* anybody types, not only in the error
 * afterwards. A rule you are told about after failing it is a rule the
 * interface kept to itself.
 */
export const PASSWORD_RULES = [
  `Between ${MINIMUM_PASSWORD_LENGTH} and ${MAXIMUM_PASSWORD_LENGTH} characters`,
]

/** Why this password is not acceptable, or null if it is. */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'A password is required'
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`
  }

  if (password.length > MAXIMUM_PASSWORD_LENGTH) {
    return `Password must be ${MAXIMUM_PASSWORD_LENGTH} characters or fewer`
  }

  return null
}

/**
 * Whether a password set on this date has expired.
 *
 * `expiryDays` of 0 means never, which is the default. Scheduled rotation is
 * offered because clinics are asked for it by their own insurers and auditors,
 * not because it helps: NIST SP 800-63B stopped recommending it, on the
 * evidence that people respond to forced rotation by incrementing a digit. It
 * is off unless a clinic turns it on.
 *
 * A null `changedAt` is treated as not expired. The column was backfilled when
 * it was added, so null means a row written by something that predates the
 * backfill — and locking somebody out over a missing timestamp is the wrong
 * way round.
 */
export function passwordHasExpired(
  changedAt: Date | null | undefined,
  expiryDays: number,
  now: Date = new Date()
): boolean {
  if (!expiryDays || expiryDays <= 0) return false
  if (!changedAt) return false

  const age = now.getTime() - changedAt.getTime()
  return age > expiryDays * 24 * 60 * 60 * 1000
}
