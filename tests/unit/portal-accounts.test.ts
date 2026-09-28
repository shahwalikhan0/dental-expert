/**
 * The bits of portal account handling that are arithmetic rather than I/O.
 */
import { describe, it, expect } from 'vitest'
import { generateTemporaryPassword, portalLockout } from '@/lib/portal/accounts'

describe('generateTemporaryPassword', () => {
  it('avoids characters somebody would misread down a telephone', () => {
    // 0/O and 1/l/I. The desk reads this out, and a patient who cannot sign in
    // because of an ambiguous glyph telephones back.
    const forbidden = /[0O1lI]/
    for (let i = 0; i < 200; i++) {
      expect(generateTemporaryPassword()).not.toMatch(forbidden)
    }
  })

  it('is long enough to be worth generating', () => {
    expect(generateTemporaryPassword()).toHaveLength(12)
  })

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, generateTemporaryPassword))
    expect(seen.size).toBe(200)
  })
})

describe('portalLockout', () => {
  const now = new Date('2026-09-27T10:00:00Z')

  it('is open when nothing has gone wrong', () => {
    expect(portalLockout({ failedAttempts: 0, lockedUntil: null }, now)).toEqual({
      locked: false,
      until: null,
    })
  })

  it('is open while the count is below the limit', () => {
    expect(portalLockout({ failedAttempts: 3, lockedUntil: null }, now)).toEqual({
      locked: false,
      until: null,
    })
  })

  it('is locked while the lock is in the future', () => {
    const until = new Date('2026-09-27T10:30:00Z')
    expect(portalLockout({ failedAttempts: 0, lockedUntil: until }, now)).toEqual({
      locked: true,
      until,
    })
  })

  /** The lock lifts by itself. Nobody has to run anything to open it. */
  it('is open again once the lock has passed', () => {
    expect(
      portalLockout({ failedAttempts: 5, lockedUntil: new Date('2026-09-27T09:59:59Z') }, now)
    ).toEqual({ locked: false, until: null })
  })
})
