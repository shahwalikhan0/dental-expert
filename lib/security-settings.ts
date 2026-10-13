/**
 * Settings → Security, as the application actually behaves.
 *
 * The screen offered twelve controls — password rules, an expiry, a session
 * timeout, a lockout, two-factor authentication, and address allow/block lists
 * — and wrote all twelve to the `Setting` table. Nothing anywhere read a single
 * one of them. A clinic could switch on "Require two-factor authentication",
 * watch it save, and be protected by a password with no minimum length and an
 * unlimited number of guesses at it.
 *
 * That is worse than not offering the screen. A control that does nothing is
 * not a missing feature, it is a false statement about where a clinic's patient
 * records stand, made by us, in writing, on a settings page.
 *
 * Every remaining control is now read from here and enforced. Two-factor
 * authentication is gone rather than implemented: a switch is not the feature —
 * enrolment, an authenticator secret, recovery codes and a second step at
 * sign-in are — and half of it is the same lie in a smaller font.
 *
 * ## The defaults, and why they are these numbers
 *
 * A default here is not a recommendation, it is what happens to every clinic
 * that never opens this page. So each one is either what the application
 * already did, or a floor nobody could object to:
 *
 *  - **Password rules are not here.** A password is 8 to 32 characters with no
 *    composition requirements, fixed for every clinic — see
 *    `lib/password-policy.ts`. The minimum-length field and the four
 *    capital/small/number/symbol switches were removed.
 *  - **Session timeout is eight hours**, which is what the JWT has always been
 *    issued with. The screen displayed sixty minutes; adopting that as the
 *    enforced default would have signed every clinic out seven hours early as
 *    a side effect of a bug fix nobody asked to change their day.
 *  - **Password expiry is off.** The screen displayed ninety days. Scheduled
 *    rotation is offered because auditors ask for it, not because it helps —
 *    NIST SP 800-63B withdrew the recommendation — and switching it on for
 *    every existing clinic by default would have been a decision taken on
 *    their behalf, in the direction of more work and no more safety.
 */
import type { PrismaClient, Prisma } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** The category these rows carry in the `Setting` table. */
export const SECURITY_CATEGORY = 'security'

export interface SecuritySettings {
  /** Days before a password must be changed. 0 — the default — is never. */
  passwordExpiryDays: number
  /** How long a sign-in lasts. */
  sessionTimeoutMinutes: number
  /** Wrong passwords tolerated inside the lockout window. */
  maxLoginAttempts: number
  lockoutDurationMinutes: number
  /** Addresses that may sign in. Empty means anywhere. */
  allowedIPs: string
  /** Addresses that may not, whatever the list above says. */
  blockedIPs: string
  /**
   * Whether a clinician sees only the patients they are involved with.
   *
   * Specification §10 asks for per-user data scoping and it had never been
   * built: every role holding `patients:read` saw the whole register. See
   * `lib/patient-scope.ts` for what "involved with" resolves to.
   */
  restrictToOwnPatients: boolean
}

export const DEFAULT_SECURITY: SecuritySettings = {
  passwordExpiryDays: 0,
  sessionTimeoutMinutes: 8 * 60,
  maxLoginAttempts: 5,
  lockoutDurationMinutes: 30,
  allowedIPs: '',
  blockedIPs: '',
  restrictToOwnPatients: false,
}

export const SECURITY_KEYS = Object.keys(DEFAULT_SECURITY) as (keyof SecuritySettings)[]

/**
 * Read one stored value back.
 *
 * Rows in this table are JSON-encoded on write, so a number arrives as `"30"`
 * and a boolean as `"true"`. Rows written by anything else — an import, a hand
 * edit, an older version of the settings route — arrive bare. Both are
 * accepted, because a settings table that only understands its own most recent
 * encoding is a settings table that loses configuration on upgrade.
 */
function decode(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), min), max)
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Turn stored rows into settings, filling in anything absent or unreadable.
 *
 * Bounds are applied here rather than trusted from the table. The POST route
 * validates what it writes, but these rows outlive any one version of that
 * route, and a `maxLoginAttempts` of 0 read back literally would lock out a
 * clinic on its first keystroke.
 */
export function securityFrom(rows: { key: string; value: string }[]): SecuritySettings {
  const stored = new Map(rows.map((row) => [row.key, decode(row.value)]))
  const get = (key: keyof SecuritySettings) => stored.get(key)

  return {
    passwordExpiryDays: asNumber(
      get('passwordExpiryDays'),
      DEFAULT_SECURITY.passwordExpiryDays,
      0,
      365
    ),
    sessionTimeoutMinutes: asNumber(
      get('sessionTimeoutMinutes'),
      DEFAULT_SECURITY.sessionTimeoutMinutes,
      5,
      24 * 60
    ),
    maxLoginAttempts: asNumber(get('maxLoginAttempts'), DEFAULT_SECURITY.maxLoginAttempts, 1, 20),
    lockoutDurationMinutes: asNumber(
      get('lockoutDurationMinutes'),
      DEFAULT_SECURITY.lockoutDurationMinutes,
      1,
      24 * 60
    ),
    allowedIPs: asString(get('allowedIPs'), DEFAULT_SECURITY.allowedIPs),
    blockedIPs: asString(get('blockedIPs'), DEFAULT_SECURITY.blockedIPs),
    restrictToOwnPatients: asBoolean(
      get('restrictToOwnPatients'),
      DEFAULT_SECURITY.restrictToOwnPatients
    ),
  }
}

/**
 * This clinic's security settings.
 *
 * One indexed query. Read at sign-in — not on
 * every request, which is why the session carries its own timeout rather than
 * looking it up again.
 */
export async function readSecuritySettings(db: Db, hospitalId: string): Promise<SecuritySettings> {
  const rows = await db.setting.findMany({
    where: { hospitalId, key: { in: SECURITY_KEYS } },
    select: { key: true, value: true },
  })

  return securityFrom(rows)
}
