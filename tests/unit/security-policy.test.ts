/**
 * The security settings, now that something reads them.
 *
 * Settings → Security offered twelve controls and the application consulted
 * none of them, so a clinic could require two-factor authentication and be
 * protected by a password with no minimum length and unlimited guesses at it.
 * These tests are the thing that stops that happening again: each one asserts
 * that a configured value changes what the application does.
 */
import { describe, it, expect, vi } from 'vitest'

import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  PASSWORD_RULES,
  passwordHasExpired,
  validatePassword,
} from '@/lib/password-policy'
import { decideIp, ipMatches, parseIpRules } from '@/lib/ip-rules'
import { DEFAULT_SECURITY, securityFrom } from '@/lib/security-settings'
import { isScoped, mayBeScoped, ownPatientsFilter, patientScopeFilter } from '@/lib/patient-scope'
import { lockoutState, minutesRemaining } from '@/lib/lockout'
import { AUDIT_ACTIONS } from '@/lib/audit'

describe('password rule', () => {
  it('is 8 to 32 characters', () => {
    expect(MINIMUM_PASSWORD_LENGTH).toBe(8)
    expect(MAXIMUM_PASSWORD_LENGTH).toBe(32)
  })

  it('accepts any password of an allowed length, whatever it is made of', () => {
    // No capital, number or symbol requirements.
    expect(validatePassword('alllowercase')).toBeNull()
    expect(validatePassword('12345678')).toBeNull()
    expect(validatePassword('a'.repeat(32))).toBeNull()
  })

  it('refuses a password shorter than 8 characters', () => {
    expect(validatePassword('abcdefg')).toMatch(/at least 8/)
  })

  it('refuses a password longer than 32 characters', () => {
    expect(validatePassword('a'.repeat(33))).toMatch(/32/)
  })

  it('refuses an empty or missing password', () => {
    expect(validatePassword('')).toMatch(/required/)
    expect(validatePassword(undefined)).toMatch(/required/)
  })

  it('refuses a password bcrypt would truncate', () => {
    // 20 emoji is under 32 characters and over bcrypt's 72 bytes, and everything
    // past the limit would be silently ignored at hashing and at checking.
    expect(validatePassword('😀'.repeat(20))).not.toBeNull()
  })

  it('states the rule before anybody types', () => {
    expect(PASSWORD_RULES).toEqual(['Between 8 and 32 characters'])
  })

  it('never expires a password when the expiry is off', () => {
    const longAgo = new Date('2020-01-01')
    expect(passwordHasExpired(longAgo, 0)).toBe(false)
  })

  it('expires one older than the configured number of days', () => {
    const now = new Date('2026-09-20T12:00:00Z')
    const old = new Date('2026-06-01T12:00:00Z')
    expect(passwordHasExpired(old, 90, now)).toBe(true)
    expect(passwordHasExpired(old, 365, now)).toBe(false)
  })

  it('does not expire a password with no recorded change date', () => {
    // The column was backfilled when it was added; a null means a row written
    // by something that predates the backfill, and locking somebody out over a
    // missing timestamp is the wrong way round.
    expect(passwordHasExpired(null, 30)).toBe(false)
  })
})

describe('address rules', () => {
  it('splits a field pasted with newlines, commas or spaces', () => {
    expect(parseIpRules('10.0.0.1, 10.0.0.2\n10.0.0.3')).toEqual([
      '10.0.0.1',
      '10.0.0.2',
      '10.0.0.3',
    ])
  })

  it('matches a bare address exactly', () => {
    expect(ipMatches('10.0.0.1', '10.0.0.1')).toBe(true)
    expect(ipMatches('10.0.0.2', '10.0.0.1')).toBe(false)
  })

  it('matches a CIDR range', () => {
    expect(ipMatches('10.0.0.57', '10.0.0.0/24')).toBe(true)
    expect(ipMatches('10.0.1.57', '10.0.0.0/24')).toBe(false)
  })

  it('reads /0 as anywhere', () => {
    // `>>> 32` is `>>> 0` in JavaScript, so the obvious implementation makes
    // "anywhere" match nothing at all.
    expect(ipMatches('203.0.113.9', '0.0.0.0/0')).toBe(true)
  })

  it('allows everywhere when the allow list is empty', () => {
    expect(decideIp('203.0.113.9', { allowed: [], blocked: [] })).toEqual({
      allowed: true,
      reason: null,
    })
  })

  it('refuses an address outside a non-empty allow list', () => {
    expect(decideIp('203.0.113.9', { allowed: ['10.0.0.0/8'], blocked: [] })).toMatchObject({
      allowed: false,
      reason: 'not_allowed',
    })
  })

  it('lets the block list win over the allow list', () => {
    const decision = decideIp('10.0.0.5', { allowed: ['10.0.0.0/8'], blocked: ['10.0.0.5'] })
    expect(decision).toMatchObject({ allowed: false, reason: 'blocked' })
  })

  it('does not lock out a deployment that reports no address', () => {
    // No reverse proxy in front means nothing to match, and refusing there
    // would lock every clinic out of its own application.
    expect(decideIp(null, { allowed: ['10.0.0.0/8'], blocked: [] }).allowed).toBe(true)
  })
})

describe('reading the stored settings', () => {
  it('fills in everything unset from the defaults', () => {
    const settings = securityFrom([{ key: 'maxLoginAttempts', value: '3' }])
    expect(settings.maxLoginAttempts).toBe(3)
    expect(settings.sessionTimeoutMinutes).toBe(DEFAULT_SECURITY.sessionTimeoutMinutes)
  })

  it('reads values written bare as well as JSON-encoded', () => {
    // A settings table that only understands its own latest encoding loses
    // configuration on upgrade.
    expect(
      securityFrom([{ key: 'restrictToOwnPatients', value: 'true' }]).restrictToOwnPatients
    ).toBe(true)
    expect(securityFrom([{ key: 'allowedIPs', value: '"10.0.0.1"' }]).allowedIPs).toBe('10.0.0.1')
  })

  it('clamps a stored value that would break sign-in', () => {
    // These rows outlive any one version of the route that validates them, and
    // zero attempts would lock a clinic out on its first keystroke.
    expect(securityFrom([{ key: 'maxLoginAttempts', value: '0' }]).maxLoginAttempts).toBe(1)
  })

  it('defaults the session to what the application already did', () => {
    // The screen displayed sixty minutes for an application issuing eight-hour
    // sessions. Adopting the screen's number as the enforced default would
    // have signed every clinic out seven hours early.
    expect(DEFAULT_SECURITY.sessionTimeoutMinutes).toBe(480)
  })

  it('leaves password expiry off by default', () => {
    expect(DEFAULT_SECURITY.passwordExpiryDays).toBe(0)
  })
})

describe('own patients only', () => {
  const dentist = { role: 'DOCTOR', clinicalRole: null }

  it('does nothing while the setting is off', () => {
    expect(isScoped(dentist, false)).toBe(false)
    expect(patientScopeFilter({ userId: 'u1', staffId: 's1', ...dentist }, false)).toBeNull()
  })

  it('restricts a dentist when it is on', () => {
    expect(isScoped(dentist, true)).toBe(true)
  })

  it('leaves the front desk, accounts and management alone', () => {
    // Booking, billing and oversight cannot be done on a partial register.
    for (const role of ['RECEPTIONIST', 'ACCOUNTANT', 'CLINIC_MANAGER', 'ADMIN']) {
      expect(isScoped({ role, clinicalRole: null }, true)).toBe(false)
    }
  })

  it('does not restrict the owner who also treats', () => {
    // Their other role already carries the whole register; taking it away
    // because of a second role would be a demotion nobody asked for.
    expect(isScoped({ role: 'ADMIN', clinicalRole: 'DOCTOR' }, true)).toBe(false)
  })

  it('does not restrict dental assistants', () => {
    // Nothing in the schema links an assistant to an appointment, so the only
    // possible link is a chart entry they cannot record without first opening
    // a record they would not be allowed to open.
    expect(isScoped({ role: 'DENTAL_ASSISTANT', clinicalRole: null }, true)).toBe(false)
  })

  it('only reads the setting for roles it could apply to', () => {
    expect(mayBeScoped({ role: 'RECEPTIONIST', clinicalRole: null })).toBe(false)
    expect(mayBeScoped(dentist)).toBe(true)
  })

  it('counts an appointment, a treatment, a chart entry or a perio exam', () => {
    const filter = ownPatientsFilter({ userId: 'u1', staffId: 's1' })
    expect(filter.OR).toHaveLength(4)
    // The appointment is what makes this usable: tomorrow's patient is in the
    // list this afternoon, which is when the history is wanted.
    expect(filter.OR?.[0]).toEqual({ appointments: { some: { doctorId: 's1' } } })
  })

  it('falls back to authorship for a dentist with no staff row', () => {
    const filter = ownPatientsFilter({ userId: 'u1', staffId: null })
    expect(filter.OR).toHaveLength(2)
  })
})

describe('account lockout', () => {
  const policy = { maxLoginAttempts: 3, lockoutDurationMinutes: 30 }
  const now = new Date('2026-09-20T12:00:00Z')

  function db(failures: Date[], lastSuccess: Date | null = null) {
    return {
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(lastSuccess ? { createdAt: lastSuccess } : null),
        findMany: vi.fn().mockResolvedValue(failures.map((createdAt) => ({ createdAt }))),
      },
    } as never
  }

  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

  it('does not lock below the configured number of attempts', async () => {
    const state = await lockoutState(db([ago(5), ago(4)]), {
      hospitalId: 'h1',
      userId: 'u1',
      policy,
      now,
    })
    expect(state.locked).toBe(false)
    expect(state.attempts).toBe(2)
  })

  it('locks on the configured attempt', async () => {
    const state = await lockoutState(db([ago(5), ago(4), ago(3)]), {
      hospitalId: 'h1',
      userId: 'u1',
      policy,
      now,
    })
    expect(state.locked).toBe(true)
    // The third failure was three minutes ago, so the lock has 27 of its 30
    // minutes left.
    expect(minutesRemaining(state.until!, now)).toBe(27)
  })

  it('measures the lock from the attempt that tripped it, not the latest', async () => {
    // Otherwise every further try extends the lock, including the real
    // owner's, turning thirty minutes into indefinitely.
    const state = await lockoutState(db([ago(29), ago(28), ago(27), ago(1)]), {
      hospitalId: 'h1',
      userId: 'u1',
      policy,
      now,
    })
    // The third failure was 27 minutes ago, so three minutes remain. Measured
    // from the most recent attempt — one minute ago — it would be 29, and the
    // next try would push it out again.
    expect(minutesRemaining(state.until!, now)).toBe(3)
  })

  it('opens again once the tripping attempt ages past the window', async () => {
    const state = await lockoutState(db([ago(31), ago(31), ago(31)]), {
      hospitalId: 'h1',
      userId: 'u1',
      policy,
      now,
    })
    expect(state.locked).toBe(false)
  })

  it('asks the log for failures, by the action the trail records', async () => {
    const client = db([])
    await lockoutState(client, { hospitalId: 'h1', userId: 'u1', policy, now })
    expect(
      (client as never as { auditLog: { findMany: ReturnType<typeof vi.fn> } }).auditLog.findMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ action: AUDIT_ACTIONS.LOGIN_FAILED_PASSWORD }),
      })
    )
  })
})
