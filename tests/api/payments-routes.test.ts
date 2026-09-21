// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = {
    requireAuthAndRole: vi.fn(),
    getAuthenticatedHospital: vi.fn(),
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

import { GET as paymentsGET } from '@/app/api/payments/route'

import { requireAuthAndRole, getAuthenticatedHospital, requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// ── Auth helpers ─────────────────────────────────────────────────────────────

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    hospitalId: 'h1',
  }
  vi.mocked(requireAuthAndRole).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function mockHospitalAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    hospitalId: 'h1',
  }
  vi.mocked(getAuthenticatedHospital).mockResolvedValue({ ...defaults, ...overrides } as any)
  vi.mocked(requirePermission).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function mockAuthError() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  } as any)
}

function mockHospitalAuthError() {
  const unauthorized = {
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  }
  vi.mocked(getAuthenticatedHospital).mockResolvedValue(unauthorized as any)
  vi.mocked(requirePermission).mockResolvedValue(unauthorized as any)
}

function makeReq(path: string, method = 'GET', body?: any): NextRequest {
  const url = `http://localhost${path}`
  const init: any = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(url, init)
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/payments
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/payments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await paymentsGET(makeReq('/api/payments'))
    expect(res.status).toBe(401)
  })

  it('returns payments with pagination and summary', async () => {
    mockAuth()
    const mockPayments = [
      {
        id: 'pay1',
        paymentNo: 'PAY001',
        amount: 5000,
        status: 'COMPLETED',
        invoice: {
          id: 'inv1',
          invoiceNo: 'INV001',
          totalAmount: 10000,
          patient: {
            id: 'p1',
            patientId: 'PT001',
            firstName: 'John',
            lastName: 'Doe',
            phone: '9876543210',
          },
        },
      },
    ]
    vi.mocked(prisma.payment.findMany).mockResolvedValue(mockPayments as any)
    vi.mocked(prisma.payment.count).mockResolvedValue(1)
    vi.mocked(prisma.payment.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 50000 } } as any)
      .mockResolvedValueOnce({ _sum: { refundAmount: 2000 } } as any)

    const res = await paymentsGET(makeReq('/api/payments'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.payments).toHaveLength(1)
    expect(body.summary.totalReceived).toBe(50000)
    expect(body.summary.totalRefunded).toBe(2000)
    expect(body.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    })
  })

  it('applies search filter', async () => {
    mockAuth()
    vi.mocked(prisma.payment.findMany).mockResolvedValue([])
    vi.mocked(prisma.payment.count).mockResolvedValue(0)
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as any)

    await paymentsGET(makeReq('/api/payments?search=PAY001'))

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ paymentNo: { contains: 'PAY001', mode: 'insensitive' } }]),
        }),
      })
    )
  })

  it('applies status and payment method filters', async () => {
    mockAuth()
    vi.mocked(prisma.payment.findMany).mockResolvedValue([])
    vi.mocked(prisma.payment.count).mockResolvedValue(0)
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as any)

    await paymentsGET(makeReq('/api/payments?status=COMPLETED&paymentMethod=RAZORPAY'))

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'COMPLETED',
          paymentMethod: 'RAZORPAY',
        }),
      })
    )
  })

  it('applies date range filters', async () => {
    mockAuth()
    vi.mocked(prisma.payment.findMany).mockResolvedValue([])
    vi.mocked(prisma.payment.count).mockResolvedValue(0)
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as any)

    await paymentsGET(makeReq('/api/payments?dateFrom=2026-01-01&dateTo=2026-01-31'))

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentDate: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      })
    )
  })

  it('applies pagination correctly', async () => {
    mockAuth()
    vi.mocked(prisma.payment.findMany).mockResolvedValue([])
    vi.mocked(prisma.payment.count).mockResolvedValue(100)
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as any)

    const res = await paymentsGET(makeReq('/api/payments?page=3&limit=20'))
    const body = await res.json()

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
      })
    )
    expect(body.pagination.totalPages).toBe(5)
  })

  it('handles null summary amounts', async () => {
    mockAuth()
    vi.mocked(prisma.payment.findMany).mockResolvedValue([])
    vi.mocked(prisma.payment.count).mockResolvedValue(0)
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({
      _sum: { amount: null, refundAmount: null },
    } as any)

    const res = await paymentsGET(makeReq('/api/payments'))
    const body = await res.json()

    expect(body.summary.totalReceived).toBe(0)
    expect(body.summary.totalRefunded).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /api/payments/create-order
// ═════════════════════════════════════════════════════════════════════════════
