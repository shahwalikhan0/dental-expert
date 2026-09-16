/**
 * What makes a user row an invitation.
 *
 * There is no invitation table: an invitation is a `User` with no password and
 * an unused token. Two tables holding the same identity is how the old shape
 * let an address be invited to a clinic where it already had an account — the
 * check for that lived in application code on one path and was missing on the
 * other, while the database enforced uniqueness on only one of the two.
 */
import { describe, it, expect } from 'vitest'
import {
  INVITATION_FILTER,
  INVITE_TTL_DAYS,
  invitationStatus,
  inviteExpiry,
  inviteeName,
  isInvitation,
} from '@/lib/invitations'

const NOW = new Date('2026-09-16T12:00:00Z')
const LATER = new Date('2026-09-20T12:00:00Z')
const EARLIER = new Date('2026-09-01T12:00:00Z')

const invitation = { password: null, inviteToken: 'tok', inviteExpiresAt: LATER }
const account = { password: 'hashed', inviteToken: null, inviteExpiresAt: null }

describe('isInvitation', () => {
  it('is an invitation when there is no password and a token', () => {
    expect(isInvitation(invitation)).toBe(true)
  })

  it('is not an invitation once a password is set', () => {
    expect(isInvitation(account)).toBe(false)
  })

  // Accepting sets the password and clears the token in one statement, so
  // neither half on its own should be taken as the answer.
  it('is not an invitation when only one half is missing', () => {
    expect(isInvitation({ password: null, inviteToken: null, inviteExpiresAt: null })).toBe(false)
    expect(isInvitation({ password: 'hashed', inviteToken: 'tok', inviteExpiresAt: LATER })).toBe(
      false
    )
  })
})

describe('invitationStatus', () => {
  it('is pending while the link still works', () => {
    expect(invitationStatus(invitation, NOW)).toBe('PENDING')
  })

  it('is expired once the link has lapsed', () => {
    expect(invitationStatus({ ...invitation, inviteExpiresAt: EARLIER }, NOW)).toBe('EXPIRED')
  })

  it('is expired when there is no expiry at all', () => {
    expect(invitationStatus({ ...invitation, inviteExpiresAt: null }, NOW)).toBe('EXPIRED')
  })

  // The old column said PENDING until somebody clicked the link, so an
  // invitation that lapsed a month ago read as outstanding for a month.
  it('needs nothing to have written it', () => {
    const justLapsed = { ...invitation, inviteExpiresAt: new Date(NOW.getTime() - 1) }
    expect(invitationStatus(justLapsed, NOW)).toBe('EXPIRED')
  })

  it('is null for somebody who actually works here', () => {
    expect(invitationStatus(account, NOW)).toBeNull()
  })
})

describe('inviteExpiry', () => {
  it('is seven days out', () => {
    expect(inviteExpiry(NOW).toISOString()).toBe('2026-09-23T12:00:00.000Z')
    expect(INVITE_TTL_DAYS).toBe(7)
  })
})

describe('INVITATION_FILTER', () => {
  it('selects rows that cannot be signed in to', () => {
    expect(INVITATION_FILTER).toEqual({ password: null, inviteToken: { not: null } })
  })
})

describe('inviteeName', () => {
  it('uses the name when there is one', () => {
    expect(inviteeName('Sana Khalid', 'sana@example.com')).toBe('Sana Khalid')
  })

  it('falls back to the address rather than greeting nobody', () => {
    expect(inviteeName(null, 'sana@example.com')).toBe('sana')
    expect(inviteeName('   ', 'sana@example.com')).toBe('sana')
  })
})
