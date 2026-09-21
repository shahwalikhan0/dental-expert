/**
 * Getting back in after forgetting a password.
 *
 * `/forgot-password` was listed as a public route in `middleware.ts` and in
 * `lib/auth.config.ts` and no such page existed, so the link went nowhere. The
 * only route back in was an administrator changing somebody's password for
 * them — a support call for the commonest thing that happens to a password.
 *
 * Three decisions worth stating, because each is the sort of thing that looks
 * like an oversight from the outside.
 *
 * **The request never says whether the address exists.** Asking for a reset
 * always answers the same way. An endpoint that says "no such account" is an
 * endpoint that tells anybody who asks which of a clinic's staff have accounts,
 * and this one is unauthenticated.
 *
 * **One email may hold accounts at several clinics.** `User.email` is unique
 * *within* a clinic, not across the platform — see the note on that column —
 * because a dentist may work Tuesdays at one practice and Thursdays at another.
 * So a reset request can match more than one account, and each gets its own
 * token and its own link, named by clinic. Anything else would silently reset
 * the wrong one.
 *
 * **A reset does not sign anybody in.** It sets the password and clears the
 * token; the person then signs in normally. A link that logged you in would be
 * a session handed out to whoever reads the mailbox.
 */

/** How long a reset link works for. */
export const RESET_TTL_MINUTES = 60

export interface ResetRow {
  resetToken: string | null
  resetExpiresAt: Date | null
  password: string | null
  isActive: boolean
}

/** When a reset issued now stops working. */
export function resetExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + RESET_TTL_MINUTES * 60 * 1000)
}

/**
 * Why this token cannot be used, or null if it can.
 *
 * An invitation that has not been accepted holds no password, and resetting one
 * is not a reset — it is accepting an invitation by the wrong door, and it
 * would leave `inviteToken` set on a row that now has a password. Those people
 * are sent to their invitation instead.
 */
export function resetRefusal(row: ResetRow | null, at: Date = new Date()): string | null {
  if (!row) return 'That reset link is not valid. Ask for a new one.'
  if (!row.resetToken) return 'That reset link has already been used. Ask for a new one.'
  if (!row.resetExpiresAt || row.resetExpiresAt <= at) {
    return 'That reset link has expired. Ask for a new one.'
  }
  if (row.password === null) {
    return 'This account has not been set up yet. Use the invitation email instead.'
  }
  if (!row.isActive) return 'That account is no longer active. Ask your administrator.'
  return null
}
