/**
 * Inviting somebody to work at the clinic.
 *
 * There is no invitation table. An invitation is a `User` row with no password:
 * same clinic, same email, same uniqueness rule, and the same row the person
 * goes on using once they accept. Two tables holding one identity is how the
 * old shape let an address be invited to a clinic where it already had an
 * account — the check for that existed on one path and not the other.
 *
 * What makes a row an invitation is its token. Accepting clears the token and
 * sets a password, so a lookup by token can never reach a claimed account, and
 * `password IS NULL` can never be true for somebody who can sign in.
 */

/** How long an invitation link works for. */
export const INVITE_TTL_DAYS = 7

export type InvitationStatus = 'PENDING' | 'EXPIRED'

export interface InvitationRow {
  password: string | null
  inviteToken: string | null
  inviteExpiresAt: Date | null
}

/** When an invitation sent now stops working. */
export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/** Is this row an invitation rather than an account? */
export function isInvitation(row: InvitationRow): boolean {
  return row.password === null && row.inviteToken !== null
}

/**
 * Where an invitation stands, or null if the row is a real account.
 *
 * Derived rather than stored. The old `status` column had to be written by
 * whoever noticed — and nothing noticed an expiry until somebody tried to use
 * the link, so an invitation that had lapsed a month ago still read PENDING on
 * the screen.
 */
export function invitationStatus(
  row: InvitationRow,
  at: Date = new Date()
): InvitationStatus | null {
  if (!isInvitation(row)) return null
  return row.inviteExpiresAt && row.inviteExpiresAt > at ? 'PENDING' : 'EXPIRED'
}

/**
 * The Prisma filter selecting a clinic's outstanding invitations.
 *
 * Cancelling one deletes the row: an invitation nobody accepted leaves nothing
 * behind worth keeping, and the audit trail records that it was sent and
 * withdrawn.
 */
export const INVITATION_FILTER = {
  password: null,
  inviteToken: { not: null },
} as const

/** A name to address the invitation to, when whoever sent it left it blank. */
export function inviteeName(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim()
  return trimmed || email.split('@')[0]
}
