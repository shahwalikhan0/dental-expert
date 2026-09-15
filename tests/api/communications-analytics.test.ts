// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = {
    requireAuthAndRole: vi.fn(),
  }
  // Routes gate on capabilities now (lib/rbac). Rather than stub the check
  // away, run the real matrix against whatever role the test put on
  // requireAuthAndRole — so a "returns 403 for X" case exercises the actual
  // rules instead of a mock that always says yes.
  const decide = async (perms: string[]) => {
    const res = await helpers.requireAuthAndRole()
    if (!res || res.error) return res
    // Fixtures shallow-spread their overrides, so a test that sets
    // `session.user.role` leaves the default `user.role` behind (and vice
    // versa). Reading just one of them would silently use the stale default,
    // so require the capability for every role the fixture names.
    const roles = [res.user?.role, res.session?.user?.role].filter(Boolean)
    if (roles.length === 0) return res
    if (!roles.every((r: string) => perms.every((p) => can(r, p)))) {
      return {
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return res
  }
  helpers.requirePermission = vi.fn((p: string) => decide([p]))
  helpers.requireAllPermissions = vi.fn((p: string[]) => decide(p))
  return helpers
})

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { GET as analyticsGET } from '@/app/api/communications/analytics/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockAuth(overrides = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    hospitalId: 'h1',
  }
  vi.mocked(requireAuthAndRole).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function mockAuthError() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  } as any)
}

function makeReq(path: string): Request {
  return new Request(`http://localhost${path}`)
}

/**
 * Set up the analytics mocks.
 *
 * SMS and email are one table now (`MessageLog`, discriminated by `channel`),
 * so these are sequenced rather than mocked per-model. The route's call order
 * is fixed and worth writing down, because that is what the `Once` chains below
 * depend on:
 *
 *   count:     SMS total, email total, emails opened
 *   groupBy:   SMS by status, SMS by day, email by status, email by day,
 *              top SMS templates, top email templates
 *   aggregate: SMS cost
 */
function mockAllAnalytics() {
  vi.mocked(prisma.messageLog.count)
    .mockResolvedValueOnce(100 as never) // SMS total
    .mockResolvedValueOnce(80 as never) // email total
    .mockResolvedValueOnce(30 as never) // emails opened

  vi.mocked(prisma.messageLog.groupBy)
    .mockResolvedValueOnce([
      { status: 'DELIVERED', _count: 70 },
      { status: 'SENT', _count: 10 },
      { status: 'FAILED', _count: 5 },
      { status: 'PENDING', _count: 10 },
      { status: 'QUEUED', _count: 5 },
    ] as never)
    .mockResolvedValueOnce([
      { createdAt: new Date('2026-02-15'), _count: 30 },
      { createdAt: new Date('2026-02-16'), _count: 25 },
    ] as never)
    .mockResolvedValueOnce([
      { status: 'SENT', _count: 50 },
      { status: 'DELIVERED', _count: 20 },
      { status: 'FAILED', _count: 10 },
    ] as never)
    .mockResolvedValueOnce([{ createdAt: new Date('2026-02-15'), _count: 40 }] as never)
    .mockResolvedValueOnce([{ templateId: 't1', _count: 25 }] as never)
    .mockResolvedValueOnce([{ templateId: 't2', _count: 15 }] as never)

  vi.mocked(prisma.messageLog.aggregate).mockResolvedValue({
    _sum: { cost: { toNumber: () => 250.5 } },
  } as never)

  // Templates
  vi.mocked(prisma.communicationTemplate.findMany).mockResolvedValue([
    { id: 't1', name: 'Appointment Reminder', category: 'APPOINTMENT' },
    { id: 't2', name: 'Welcome Email', category: 'GENERAL' },
  ] as never)
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/communications/analytics
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/communications/analytics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await analyticsGET(makeReq('/api/communications/analytics'))
    expect(res.status).toBe(401)
  })

  it('returns full analytics data with default 30d period', async () => {
    mockAuth()
    mockAllAnalytics()

    const res = await analyticsGET(makeReq('/api/communications/analytics'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.period).toBe('30d')

    // SMS stats
    expect(body.sms.total).toBe(100)
    expect(body.sms.delivered).toBe(70)
    expect(body.sms.sent).toBe(10)
    expect(body.sms.failed).toBe(5)
    expect(body.sms.totalCost).toBe(250.5)
    expect(body.sms.deliveryRate).toBeGreaterThan(0)

    // Email stats
    expect(body.email.total).toBe(80)
    expect(body.email.sent).toBe(70) // SENT + DELIVERED
    expect(body.email.failed).toBe(10)
    expect(body.email.opened).toBe(30)
    expect(body.email.openRate).toBeGreaterThan(0)
    // No click rate: EmailLog.clickedAt existed and was always null, because
    // nothing rewrote links to route through a redirector. The page showed
    // "0 clicked of 412", which reads as a campaign nobody engaged with.
    expect(body.email).not.toHaveProperty('clicked')

    // Campaigns were reported here from `BulkCommunication`, a table nothing
    // ever wrote to — so "Recent Campaigns" never had a row. Dropped with the
    // table.
    expect(body).not.toHaveProperty('campaigns')
  })

  it('respects period parameter', async () => {
    mockAuth()
    mockAllAnalytics()

    await analyticsGET(makeReq('/api/communications/analytics?period=7d'))

    // Verify the date filter was applied
    expect(prisma.messageLog.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      })
    )
  })

  it('handles "all" period with no date filter', async () => {
    mockAuth()
    mockAllAnalytics()

    await analyticsGET(makeReq('/api/communications/analytics?period=all'))

    expect(prisma.messageLog.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: undefined,
        }),
      })
    )
  })

  it('returns dailyTrend combining SMS and email data', async () => {
    mockAuth()
    mockAllAnalytics()

    const res = await analyticsGET(makeReq('/api/communications/analytics'))
    const body = await res.json()

    expect(body.dailyTrend).toBeDefined()
    expect(Array.isArray(body.dailyTrend)).toBe(true)
    if (body.dailyTrend.length > 0) {
      expect(body.dailyTrend[0]).toHaveProperty('date')
      expect(body.dailyTrend[0]).toHaveProperty('sms')
      expect(body.dailyTrend[0]).toHaveProperty('email')
    }
  })

  it('returns template performance data', async () => {
    mockAuth()
    mockAllAnalytics()

    const res = await analyticsGET(makeReq('/api/communications/analytics'))
    const body = await res.json()

    expect(body.topTemplates).toBeDefined()
    expect(body.topTemplates.sms).toBeDefined()
    expect(body.topTemplates.email).toBeDefined()
  })

  it('handles zero data gracefully', async () => {
    mockAuth()
    vi.mocked(prisma.messageLog.count).mockResolvedValue(0 as never)
    vi.mocked(prisma.messageLog.groupBy).mockResolvedValue([] as never)
    vi.mocked(prisma.messageLog.aggregate).mockResolvedValue({ _sum: { cost: null } } as never)
    vi.mocked(prisma.communicationTemplate.findMany).mockResolvedValue([])

    const res = await analyticsGET(makeReq('/api/communications/analytics'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sms.total).toBe(0)
    expect(body.sms.deliveryRate).toBe(0)
    expect(body.sms.totalCost).toBe(0)
    expect(body.email.total).toBe(0)
    expect(body.email.openRate).toBe(0)
  })
})
