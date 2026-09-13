/**
 * The audit trail — spec §10.
 *
 * Two properties matter more than the rest, and both are here:
 *
 *  - **a failed audit write never breaks the thing being audited.** Refusing a
 *    login because the audit table was unreachable turns a logging problem into
 *    an outage.
 *  - **secrets never reach the log.** Settings hold SMS API keys, SMTP
 *    passwords and payment-gateway secrets, and an audit entry is a plaintext
 *    column readable by anyone holding `audit:read`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import {
  AUDIT_ACTIONS,
  REDACTED,
  diffValues,
  isSecretName,
  recordAudit,
  redactValues,
  requestContext,
} from '@/lib/audit'
import { prisma } from '@/lib/prisma'

describe('isSecretName', () => {
  it('recognises the names secrets actually go by in this codebase', () => {
    for (const name of [
      'password',
      'smtp_password',
      'email.smtp.password',
      'sms.apiKey',
      'apiKey',
      'authKey',
      'razorpayKeySecret',
      'phonepeSaltKey',
      'paytmMerchantKey',
      'accessToken',
      'refresh_token',
      'privateKey',
      'credentials',
    ]) {
      expect(isSecretName(name), name).toBe(true)
    }
  })

  it('leaves ordinary settings alone', () => {
    for (const name of [
      'slotDuration',
      'taxRate',
      'discountApprovalThreshold',
      'doubleBookingPolicy',
      'invoicePrefix',
      'isEnabled',
      'provider',
    ]) {
      expect(isSecretName(name), name).toBe(false)
    }
  })

  // Broad on purpose: a false positive costs one redacted line, a false
  // negative writes a live API key into a table managers can read.
  it('is case-insensitive and tolerates separators', () => {
    expect(isSecretName('API_KEY')).toBe(true)
    expect(isSecretName('api-key')).toBe(true)
    expect(isSecretName('AuthKey')).toBe(true)
  })
})

describe('redactValues', () => {
  it('masks the value but keeps the key, so the change is still visible', () => {
    expect(redactValues({ 'sms.apiKey': 'live-key-123', 'sms.enabled': 'true' })).toEqual({
      'sms.apiKey': REDACTED,
      'sms.enabled': 'true',
    })
  })

  it('never lets the original through', () => {
    const out = redactValues({ razorpayKeySecret: 'rzp_secret_abc' })
    expect(JSON.stringify(out)).not.toContain('rzp_secret_abc')
  })
})

describe('diffValues', () => {
  it('reports only what actually changed', () => {
    const d = diffValues(
      { slotDuration: '30', bufferTime: '10' },
      { slotDuration: '45', bufferTime: '10' }
    )
    expect(d.changed).toEqual(['slotDuration'])
    expect(d.before).toEqual({ slotDuration: '30' })
    expect(d.after).toEqual({ slotDuration: '45' })
  })

  // Settings arrive as form values and are stored as text, so 30 and '30' are
  // the same setting — comparing them raw would record a change on every save.
  it('compares by value, not by type', () => {
    expect(diffValues({ slotDuration: 30 }, { slotDuration: '30' }).changed).toEqual([])
  })

  it('treats null and undefined and empty string as the same absence', () => {
    expect(diffValues({ a: null }, { a: '' }).changed).toEqual([])
    expect(diffValues({}, { a: '' }).changed).toEqual([])
  })

  it('records a setting being introduced', () => {
    const d = diffValues({}, { taxRate: '16' })
    expect(d.changed).toEqual(['taxRate'])
    expect(d.before).toEqual({ taxRate: null })
  })

  it('redacts both sides of a secret that changed', () => {
    const d = diffValues({ 'sms.apiKey': 'old-key' }, { 'sms.apiKey': 'new-key' })
    expect(d.changed).toEqual(['sms.apiKey'])
    expect(d.before).toEqual({ 'sms.apiKey': REDACTED })
    expect(d.after).toEqual({ 'sms.apiKey': REDACTED })
    expect(JSON.stringify(d)).not.toContain('old-key')
    expect(JSON.stringify(d)).not.toContain('new-key')
  })

  it('ignores keys the caller did not submit', () => {
    expect(diffValues({ untouched: 'x' }, { changed: 'y' }).changed).toEqual(['changed'])
  })
})

describe('recordAudit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes the entry', async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'a1' } as never)

    await recordAudit({
      hospitalId: 'h1',
      userId: 'u1',
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      entityType: 'User',
      entityId: 'u1',
      ipAddress: '203.0.113.7',
    })

    expect(vi.mocked(prisma.auditLog.create).mock.calls[0][0].data).toMatchObject({
      hospitalId: 'h1',
      userId: 'u1',
      action: 'login.success',
      ipAddress: '203.0.113.7',
    })
  })

  /**
   * The property that matters most. The operation being audited has already
   * happened; the entry records it rather than gating it.
   */
  it('does not throw when the audit table is unreachable', async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error('connection refused'))

    await expect(
      recordAudit({
        hospitalId: 'h1',
        action: AUDIT_ACTIONS.LOGIN_SUCCESS,
        entityType: 'User',
        entityId: 'u1',
      })
    ).resolves.toBeUndefined()
  })

  it('redacts secrets on the way in, even if the caller did not', async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'a1' } as never)

    await recordAudit({
      hospitalId: 'h1',
      action: AUDIT_ACTIONS.PAYMENT_GATEWAY_UPDATED,
      entityType: 'PaymentGatewayConfig',
      entityId: 'h1',
      newValues: { provider: 'RAZORPAY', razorpayKeySecret: 'rzp_live_secret' },
    })

    const written = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data
    expect(written.newValues).toContain('RAZORPAY')
    expect(written.newValues).not.toContain('rzp_live_secret')
  })

  it('stores values as JSON text, since the column is text', async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'a1' } as never)

    await recordAudit({
      hospitalId: 'h1',
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: 'Setting',
      entityId: 'taxRate',
      oldValues: { taxRate: '0' },
      newValues: { taxRate: '16' },
    })

    const written = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data
    expect(JSON.parse(written.oldValues as string)).toEqual({ taxRate: '0' })
    expect(JSON.parse(written.newValues as string)).toEqual({ taxRate: '16' })
  })

  it('leaves absent values null rather than writing "null" as text', async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'a1' } as never)

    await recordAudit({
      hospitalId: 'h1',
      action: AUDIT_ACTIONS.LOGIN_FAILED_PASSWORD,
      entityType: 'User',
      entityId: 'u1',
    })

    const written = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data
    expect(written.oldValues).toBeNull()
    expect(written.newValues).toBeNull()
  })
})

describe('requestContext', () => {
  it('takes the client address from the front of x-forwarded-for', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.7, 70.41.3.18',
      'user-agent': 'Mozilla/5.0',
    })
    expect(requestContext(headers)).toEqual({
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    })
  })

  it('falls back to x-real-ip', () => {
    expect(requestContext(new Headers({ 'x-real-ip': '198.51.100.4' })).ipAddress).toBe(
      '198.51.100.4'
    )
  })

  it('copes with no headers at all', () => {
    expect(requestContext(null)).toEqual({ ipAddress: null, userAgent: null })
    expect(requestContext(new Headers())).toEqual({ ipAddress: null, userAgent: null })
  })
})
