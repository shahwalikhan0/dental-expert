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
 * So the policy lives here, it is read from the clinic's own settings, and
 * every path that sets a password checks it. One function, one message, one
 * list of rules — and the rules are the ones the screen says they are.
 */

/**
 * The clinic's password rules.
 *
 * Deliberately a plain value rather than a class: the caller reads it once from
 * `lib/security-settings.ts` and passes it in, so this file can be tested
 * without a database and a route cannot accidentally check against defaults
 * when the clinic has configured something stricter.
 */
export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumbers: boolean
  requireSpecialChars: boolean
}

/**
 * The floor, below which no clinic may configure.
 *
 * Eight characters. A clinic that wants six is a clinic that has misunderstood
 * what it is protecting: these accounts open medical records, and the settings
 * form should not be able to make the platform less safe than the platform is
 * prepared to be. The upper bound is the clinic's business, the lower bound is
 * ours.
 */
export const MINIMUM_PASSWORD_LENGTH = 8

/** No practical limit, but bcrypt silently truncates past 72 bytes. */
export const MAXIMUM_PASSWORD_LENGTH = 72

/**
 * Anything that is not a letter, a digit or whitespace.
 *
 * Defined as a complement rather than a list of symbols. A list always
 * excludes somebody's keyboard — the previous attempts at this elsewhere in
 * the codebase named `!@#$%^&*` and nothing else, which rejects `£`, `€` and
 * every character a non-Latin keyboard produces.
 */
const SPECIAL = /[^\p{L}\p{N}\s]/u

export function hasUppercase(password: string): boolean {
  return /\p{Lu}/u.test(password)
}

export function hasLowercase(password: string): boolean {
  return /\p{Ll}/u.test(password)
}

export function hasNumber(password: string): boolean {
  return /\p{N}/u.test(password)
}

export function hasSpecial(password: string): boolean {
  return SPECIAL.test(password)
}

/**
 * Every rule this policy imposes, written the way a person would say it.
 *
 * Shown beside the field *before* anybody types, not only in the error
 * afterwards. A rule you are told about after failing it is a rule the
 * interface kept to itself.
 */
export function describePolicy(policy: PasswordPolicy): string[] {
  const rules = [`At least ${policy.minLength} characters`]
  if (policy.requireUppercase) rules.push('One capital letter')
  if (policy.requireLowercase) rules.push('One small letter')
  if (policy.requireNumbers) rules.push('One number')
  if (policy.requireSpecialChars) rules.push('One symbol, such as ! or @')
  return rules
}

/**
 * Why this password is not acceptable, or null if it is.
 *
 * Returns one reason rather than a list. A form that reports every unmet rule
 * at once reads as a wall of refusal; the rules are all on screen anyway, so
 * naming the first unmet one is enough to act on.
 */
export function validatePassword(password: unknown, policy: PasswordPolicy): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'A password is required'
  }

  const minLength = Math.max(policy.minLength, MINIMUM_PASSWORD_LENGTH)

  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters`
  }

  // Counted in bytes, because that is what bcrypt truncates on. A password of
  // 70 emoji is well under 72 characters and well over 72 bytes, and the part
  // past the limit would be silently ignored at both hashing and checking —
  // which is not a failure anyone would notice until it mattered.
  if (new TextEncoder().encode(password).length > MAXIMUM_PASSWORD_LENGTH) {
    return `Password must be ${MAXIMUM_PASSWORD_LENGTH} bytes or fewer`
  }

  if (policy.requireUppercase && !hasUppercase(password)) {
    return 'Password must contain a capital letter'
  }

  if (policy.requireLowercase && !hasLowercase(password)) {
    return 'Password must contain a small letter'
  }

  if (policy.requireNumbers && !hasNumber(password)) {
    return 'Password must contain a number'
  }

  if (policy.requireSpecialChars && !hasSpecial(password)) {
    return 'Password must contain a symbol, such as ! or @'
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
