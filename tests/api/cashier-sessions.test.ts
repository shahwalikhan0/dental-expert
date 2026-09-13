/**
 * FR-015 — daily cashier reconciliation, over the API.
 *
 * The separation is the point: reception opens the till and takes the money,
 * but cannot be the one who signs off on what is in it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = { requireAuthAndRole: vi.fn() }
  const decide = async (perms: string[]) => {
    const res = await helpers.requireAuthAndRole()
    if (!res || res.error) return res
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

import { GET, POST } from '@/app/api/cashier-sessions/route'
import { POST as CLOSE } from '@/app/api/cashier-sessions/[id]/close/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function signedInAs(role: string, userId = 'u1') {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: userId, role },
  } as any)
}

function req(path: string, method = 'GET', body?: unknown) {
  const init: any = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(`http://localhost${path}`, init)
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.payment.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.refund.groupBy).mockResolvedValue([] as never)
})

describe('POST /api/cashier-sessions — opening the till', () => {
  it('lets reception open a till with a float', async () => {
    signedInAs('RECEPTIONIST')
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.cashierSession.create).mockResolvedValue({
      id: 's1',
      sessionNo: 'CS-202609-0001',
      openingFloat: 5000,
    } as never)

    const res = await POST(req('/api/cashier-sessions', 'POST', { openingFloat: 5000 }))
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.cashierSession.create).mock.calls[0][0].data).toMatchObject({
      hospitalId: 'h1',
      openingFloat: 5000,
      openedById: 'u1',
    })
  })

  // A second till would split the day's takings across two reconciliations and
  // leave neither able to balance.
  it('refuses a second till while one is open', async () => {
    signedInAs('RECEPTIONIST')
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue({
      id: 's1',
      sessionNo: 'CS-202609-0001',
    } as never)

    const res = await POST(req('/api/cashier-sessions', 'POST', {}))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('CS-202609-0001'),
    })
    expect(prisma.cashierSession.create).not.toHaveBeenCalled()
  })

  it('defaults the float to zero', async () => {
    signedInAs('RECEPTIONIST')
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.cashierSession.create).mockResolvedValue({
      id: 's1',
      openingFloat: 0,
    } as never)

    await POST(req('/api/cashier-sessions', 'POST', {}))
    expect(vi.mocked(prisma.cashierSession.create).mock.calls[0][0].data).toMatchObject({
      openingFloat: 0,
    })
  })

  it('rejects a negative float', async () => {
    signedInAs('RECEPTIONIST')
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(null as never)
    expect((await POST(req('/api/cashier-sessions', 'POST', { openingFloat: -1 }))).status).toBe(
      400
    )
  })

  it('is refused to a role with no billing access', async () => {
    signedInAs('LAB_TECH')
    expect((await POST(req('/api/cashier-sessions', 'POST', {}))).status).toBe(403)
  })
})

describe('GET /api/cashier-sessions', () => {
  it('scopes the list to the clinic', async () => {
    signedInAs('ACCOUNTANT')
    vi.mocked(prisma.cashierSession.findMany).mockResolvedValue([] as never)

    await GET(req('/api/cashier-sessions'))
    expect(
      (vi.mocked(prisma.cashierSession.findMany).mock.calls[0][0]!.where as any).hospitalId
    ).toBe('h1')
  })

  it('filters to open sessions when asked', async () => {
    signedInAs('ACCOUNTANT')
    vi.mocked(prisma.cashierSession.findMany).mockResolvedValue([] as never)

    await GET(req('/api/cashier-sessions?status=OPEN'))
    expect((vi.mocked(prisma.cashierSession.findMany).mock.calls[0][0]!.where as any).status).toBe(
      'OPEN'
    )
  })

  it('ignores a status it does not recognise rather than filtering on it', async () => {
    signedInAs('ACCOUNTANT')
    vi.mocked(prisma.cashierSession.findMany).mockResolvedValue([] as never)

    await GET(req('/api/cashier-sessions?status=HAUNTED'))
    expect(
      (vi.mocked(prisma.cashierSession.findMany).mock.calls[0][0]!.where as any).status
    ).toBeUndefined()
  })
})

describe('POST /api/cashier-sessions/[id]/close — the variance record', () => {
  const OPEN = { id: 's1', sessionNo: 'CS-202609-0001', status: 'OPEN', openingFloat: 5000 }

  function closingAs(role: string) {
    signedInAs(role, 'manager-1')
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(OPEN as never)
    vi.mocked(prisma.cashierSession.update).mockResolvedValue({
      ...OPEN,
      status: 'CLOSED',
    } as never)
    vi.mocked(prisma.cashierSessionCount.createMany).mockResolvedValue({ count: 8 } as never)
  }

  // The heart of FR-015: money taken, money paid back out, and what was
  // actually found in the drawer.
  it('records the variance per payment method', async () => {
    closingAs('CLINIC_MANAGER')
    vi.mocked(prisma.payment.groupBy).mockResolvedValue([
      { paymentMethod: 'CASH', _sum: { amount: 12000 } },
      { paymentMethod: 'CARD', _sum: { amount: 8000 } },
    ] as never)
    vi.mocked(prisma.refund.groupBy).mockResolvedValue([
      { refundMethod: 'CASH', _sum: { amount: 2000 } },
    ] as never)

    const res = await CLOSE(
      req('/api/cashier-sessions/s1/close', 'POST', {
        counts: [
          { paymentMethod: 'CASH', countedAmount: 14800 }, // expected 5000+12000−2000 = 15000
          { paymentMethod: 'CARD', countedAmount: 8000 },
        ],
      }),
      params('s1')
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    const cash = body.data.totals.find((t: any) => t.paymentMethod === 'CASH')
    expect(cash).toMatchObject({ expected: 15000, countedAmount: 14800, varianceAmount: -200 })
    expect(body.data.totalVariance).toBe(-200)
  })

  it('stamps the expected figures rather than leaving them to be recomputed', async () => {
    closingAs('ACCOUNTANT')
    vi.mocked(prisma.payment.groupBy).mockResolvedValue([
      { paymentMethod: 'CASH', _sum: { amount: 1000 } },
    ] as never)

    await CLOSE(
      req('/api/cashier-sessions/s1/close', 'POST', {
        counts: [{ paymentMethod: 'CASH', countedAmount: 6000 }],
      }),
      params('s1')
    )

    const rows = vi.mocked(prisma.cashierSessionCount.createMany).mock.calls[0][0].data as any[]
    expect(rows).toHaveLength(8) // one per payment method
    expect(rows.find((r) => r.paymentMethod === 'CASH')).toMatchObject({
      expectedAmount: 6000,
      countedAmount: 6000,
      varianceAmount: 0,
    })
  })

  it('marks the session closed and names who closed it', async () => {
    closingAs('ADMIN')

    await CLOSE(
      req('/api/cashier-sessions/s1/close', 'POST', { counts: [], closingNotes: 'all square' }),
      params('s1')
    )

    expect(vi.mocked(prisma.cashierSession.update).mock.calls[0][0].data).toMatchObject({
      status: 'CLOSED',
      closedById: 'manager-1',
      closingNotes: 'all square',
    })
  })

  // Reception takes the money; someone else counts it.
  it('is refused to reception', async () => {
    signedInAs('RECEPTIONIST')
    const res = await CLOSE(
      req('/api/cashier-sessions/s1/close', 'POST', { counts: [] }),
      params('s1')
    )
    expect(res.status).toBe(403)
    expect(prisma.cashierSession.update).not.toHaveBeenCalled()
  })

  // Closing twice would overwrite the first reconciliation — the one record
  // FR-015 exists to keep.
  it('refuses to close a session twice', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue({
      ...OPEN,
      status: 'CLOSED',
    } as never)

    const res = await CLOSE(
      req('/api/cashier-sessions/s1/close', 'POST', { counts: [] }),
      params('s1')
    )
    expect(res.status).toBe(409)
    expect(prisma.cashierSession.update).not.toHaveBeenCalled()
  })

  it('404s for a session belonging to another clinic', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(null as never)

    expect(
      (await CLOSE(req('/api/cashier-sessions/s9/close', 'POST', { counts: [] }), params('s9')))
        .status
    ).toBe(404)
  })

  it('rejects the same method counted twice', async () => {
    closingAs('ADMIN')

    const res = await CLOSE(
      req('/api/cashier-sessions/s1/close', 'POST', {
        counts: [
          { paymentMethod: 'CASH', countedAmount: 100 },
          { paymentMethod: 'CASH', countedAmount: 200 },
        ],
      }),
      params('s1')
    )
    expect(res.status).toBe(400)
    expect(prisma.cashierSession.update).not.toHaveBeenCalled()
  })

  it('rejects a payment method that does not exist', async () => {
    closingAs('ADMIN')
    const res = await CLOSE(
      req('/api/cashier-sessions/s1/close', 'POST', {
        counts: [{ paymentMethod: 'CRYPTO', countedAmount: 1 }],
      }),
      params('s1')
    )
    expect(res.status).toBe(400)
  })
})
