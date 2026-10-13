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

import { GET as dashboardGET } from '@/app/api/dashboard/stats/route'
import { GET as searchGET } from '@/app/api/search/route'

import { requireAuthAndRole, getAuthenticatedHospital } from '@/lib/api-helpers'
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
}

function mockAuthError() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  } as any)
}

function mockHospitalAuthError() {
  vi.mocked(getAuthenticatedHospital).mockResolvedValue({
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  } as any)
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
// 1. GET /api/dashboard/stats
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/stats', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await dashboardGET(makeReq('/api/dashboard/stats'))
    expect(res.status).toBe(401)
  })

  // Money on the dashboard is cash collected (payments less refunds, through
  // lib/collections.ts) and outstanding is the balance on owed invoices
  // (lib/invoiced.ts) — the same figures as Billing and Reports.
  it('returns dashboard statistics', async () => {
    mockAuth()

    vi.mocked(prisma.patient.count)
      .mockResolvedValueOnce(250) // total patients
      .mockResolvedValueOnce(12) // new this month
      .mockResolvedValueOnce(10) // prev month patients
    vi.mocked(prisma.appointment.count)
      .mockResolvedValueOnce(8) // today
      .mockResolvedValueOnce(120) // this month
      .mockResolvedValueOnce(15) // pending
      .mockResolvedValueOnce(5) // completed today
      .mockResolvedValueOnce(100) // prev month appointments
    // collectionTotals, in the order the route asks: this month, today,
    // last month, all time.
    vi.mocked(prisma.payment.groupBy)
      .mockResolvedValueOnce([{ paymentMethod: 'CASH', _sum: { amount: 45000 }, _count: 9 }] as any)
      .mockResolvedValueOnce([{ paymentMethod: 'CASH', _sum: { amount: 8500 }, _count: 2 }] as any)
      .mockResolvedValueOnce([{ paymentMethod: 'CASH', _sum: { amount: 40000 }, _count: 8 }] as any)
      .mockResolvedValueOnce([
        { paymentMethod: 'CASH', _sum: { amount: 950000 }, _count: 200 },
      ] as any)
    vi.mocked(prisma.refund.groupBy).mockResolvedValue([])
    vi.mocked(prisma.invoice.aggregate).mockResolvedValueOnce({
      _sum: { balanceAmount: 12000 },
      _count: 3,
    } as any) // outstanding
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ key: '2026-02-14', revenue: 1200 }]) // last 7 days
      .mockResolvedValueOnce([{ key: '2026-01', revenue: 40000 }]) // last 6 months
      .mockResolvedValueOnce([]) // low stock
    vi.mocked(prisma.treatment.groupBy).mockResolvedValue([
      { procedureId: 'p1', _count: { _all: 15 } },
    ] as any)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: 'inv1',
        issuedAt: new Date(),
        createdAt: new Date(),
        discountAmount: 0,
        items: [
          {
            id: 'it1',
            amount: 7500,
            treatment: {
              id: 't1',
              procedure: { id: 'p1', code: 'RCT', name: 'Root Canal', category: 'Endo' },
              doctor: null,
            },
          },
        ],
      },
    ] as any)
    vi.mocked(prisma.procedure.findMany).mockResolvedValue([
      { id: 'p1', name: 'Root Canal' },
    ] as any)
    vi.mocked(prisma.appointment.groupBy).mockResolvedValue([
      { status: 'COMPLETED', _count: { status: 80 } },
      { status: 'CANCELLED', _count: { status: 10 } },
    ] as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      {
        id: 'a1',
        scheduledDate: new Date(),
        appointmentType: 'CHECKUP',
        status: 'SCHEDULED',
        patient: { firstName: 'John', lastName: 'Doe' },
        doctor: { firstName: 'Dr', lastName: 'Smith' },
      },
    ] as any)

    const res = await dashboardGET(makeReq('/api/dashboard/stats'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.overview).toBeDefined()
    expect(body.data.overview.totalPatients).toBe(250)
    expect(body.data.overview.thisMonthRevenue).toBe(45000)
    expect(body.data.overview.pendingPayments).toBe(12000)
    expect(body.data.overview.totalRevenue).toBe(950000)
    expect(body.data.overview.revenueGrowth).toBe(12.5)
    expect(body.data.charts).toBeDefined()
    expect(body.data.charts.appointmentsByStatus).toHaveLength(2)
    expect(body.data.charts.last7DaysRevenue).toHaveLength(7)
    expect(body.data.charts.last6MonthsRevenue).toHaveLength(6)
    expect(body.data.charts.topProcedures).toEqual([
      { name: 'Root Canal', count: 15, revenue: 7500 },
    ])
    expect(body.data.recentActivity).toBeDefined()
    expect(body.data.recentActivity.upcomingAppointments).toHaveLength(1)
    expect(body.data.recentActivity.upcomingAppointments[0].patientName).toBe('John Doe')
  })

  it('handles zero previous month values for growth', async () => {
    mockAuth()
    vi.mocked(prisma.patient.count)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0) // prev month = 0
    vi.mocked(prisma.appointment.count).mockResolvedValue(0)
    vi.mocked(prisma.payment.groupBy).mockResolvedValue([])
    vi.mocked(prisma.refund.groupBy).mockResolvedValue([])
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { balanceAmount: null },
      _count: 0,
    } as any)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
    vi.mocked(prisma.treatment.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([])
    vi.mocked(prisma.appointment.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([])

    const res = await dashboardGET(makeReq('/api/dashboard/stats'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.overview.patientGrowth).toBe(0) // 0 when prev month is 0
    expect(body.data.overview.revenueGrowth).toBe(0)
  })

  // Bug report 12 Oct, finding 41.
  it('leaves revenue and money owed out for a role without billing access', async () => {
    mockAuth({ user: { id: 'u5', role: 'DENTAL_ASSISTANT' } })
    vi.mocked(prisma.patient.count).mockResolvedValue(10)
    vi.mocked(prisma.appointment.count).mockResolvedValue(3)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([])
    vi.mocked(prisma.treatment.groupBy).mockResolvedValue([
      { procedureId: 'p1', _count: { _all: 2 } },
    ] as any)
    vi.mocked(prisma.procedure.findMany).mockResolvedValue([{ id: 'p1', name: 'Filling' }] as any)
    vi.mocked(prisma.appointment.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([])

    const res = await dashboardGET(makeReq('/api/dashboard/stats'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.showsMoney).toBe(false)
    expect(body.data.overview.totalPatients).toBe(10)
    expect(body.data.overview).not.toHaveProperty('thisMonthRevenue')
    expect(body.data.overview).not.toHaveProperty('pendingPayments')
    expect(body.data.overview).not.toHaveProperty('totalRevenue')
    expect(body.data.charts.last7DaysRevenue).toEqual([])
    expect(body.data.charts.last6MonthsRevenue).toEqual([])
    expect(body.data.charts.topProcedures[0]).toEqual({ name: 'Filling', count: 2 })
    // Not merely hidden: the money was never read.
    expect(prisma.payment.groupBy).not.toHaveBeenCalled()
    expect(prisma.invoice.aggregate).not.toHaveBeenCalled()
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET /api/search
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockHospitalAuthError()
    const res = await searchGET(makeReq('/api/search?q=john'))
    expect(res.status).toBe(401)
  })

  it('returns empty results for short query (< 2 chars)', async () => {
    mockHospitalAuth()
    const res = await searchGET(makeReq('/api/search?q=j'))
    const body = await res.json()

    expect(body.patients).toEqual([])
    expect(body.appointments).toEqual([])
    expect(body.invoices).toEqual([])
    expect(body.staff).toEqual([])
    expect(body.treatments).toEqual([])
    expect(prisma.patient.findMany).not.toHaveBeenCalled()
  })

  it('returns empty results when q is missing', async () => {
    mockHospitalAuth()
    const res = await searchGET(makeReq('/api/search'))
    const body = await res.json()

    expect(body.patients).toEqual([])
  })

  it('searches across all entity types', async () => {
    mockHospitalAuth()
    vi.mocked(prisma.patient.findMany).mockResolvedValue([
      { id: 'p1', patientId: 'PT001', firstName: 'John', lastName: 'Doe', phone: '9876543210' },
    ] as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      {
        id: 'a1',
        appointmentNo: 'APT001',
        scheduledDate: new Date('2026-02-20'),
        scheduledTime: '10:00',
        status: 'SCHEDULED',
        patient: { firstName: 'John', lastName: 'Doe' },
        doctor: { firstName: 'Dr', lastName: 'Smith' },
      },
    ] as any)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
    vi.mocked(prisma.staff.findMany).mockResolvedValue([])
    vi.mocked(prisma.treatment.findMany).mockResolvedValue([])

    const res = await searchGET(makeReq('/api/search?q=John'))
    const body = await res.json()

    expect(body.patients).toHaveLength(1)
    expect(body.patients[0].label).toBe('John Doe')
    expect(body.patients[0].href).toBe('/patients/p1')
    expect(body.appointments).toHaveLength(1)
    expect(body.appointments[0].label).toContain('APT001')
  })

  it('maps staff results correctly', async () => {
    mockHospitalAuth()
    vi.mocked(prisma.patient.findMany).mockResolvedValue([])
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([])
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
    vi.mocked(prisma.staff.findMany).mockResolvedValue([
      {
        id: 's1',
        firstName: 'Jane',
        lastName: 'Doctor',
        specialization: 'Orthodontics',
        employeeId: 'EMP001',
        user: { role: 'DOCTOR' },
      },
    ] as any)
    vi.mocked(prisma.treatment.findMany).mockResolvedValue([])

    const res = await searchGET(makeReq('/api/search?q=Jane'))
    const body = await res.json()

    expect(body.staff).toHaveLength(1)
    expect(body.staff[0].label).toBe('Jane Doctor')
    expect(body.staff[0].sublabel).toContain('Orthodontics')
    expect(body.staff[0].href).toBe('/staff/s1')
  })

  it('maps invoice results with currency formatting', async () => {
    mockHospitalAuth()
    vi.mocked(prisma.patient.findMany).mockResolvedValue([])
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([])
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: 'inv1',
        invoiceNo: 'INV001',
        totalAmount: 15000,
        status: 'PENDING',
        patient: { firstName: 'John', lastName: 'Doe' },
      },
    ] as any)
    vi.mocked(prisma.staff.findMany).mockResolvedValue([])
    vi.mocked(prisma.treatment.findMany).mockResolvedValue([])

    const res = await searchGET(makeReq('/api/search?q=INV001'))
    const body = await res.json()

    expect(body.invoices).toHaveLength(1)
    expect(body.invoices[0].label).toContain('INV001')
    expect(body.invoices[0].sublabel).toContain('15,000')
    expect(body.invoices[0].href).toBe('/billing/invoices/inv1')
  })

  // Bug report 12 Oct, finding 40: each kind of result is behind the
  // permission that reads it on its own screen.
  function everythingMatches() {
    vi.mocked(prisma.patient.findMany).mockResolvedValue([
      { id: 'p1', patientId: 'PT001', firstName: 'John', lastName: 'Doe', phone: '9876543210' },
    ] as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      {
        id: 'a1',
        appointmentNo: 'APT001',
        startsAt: new Date('2026-02-20T05:00:00Z'),
        status: 'SCHEDULED',
        patient: { firstName: 'John', lastName: 'Doe' },
        doctor: { firstName: 'Dr', lastName: 'Smith' },
      },
    ] as any)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: 'inv1',
        invoiceNo: 'INV001',
        totalAmount: 15000,
        status: 'PENDING',
        patient: { firstName: 'John', lastName: 'Doe' },
      },
    ] as any)
    vi.mocked(prisma.staff.findMany).mockResolvedValue([])
    vi.mocked(prisma.treatment.findMany).mockResolvedValue([])
  }

  it('gives the lab technician no appointments or invoices', async () => {
    mockHospitalAuth({ user: { id: 'u2', role: 'LAB_TECH' } })
    everythingMatches()

    const res = await searchGET(makeReq('/api/search?q=John'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.patients).toHaveLength(1)
    expect(body.appointments).toEqual([])
    expect(body.invoices).toEqual([])
    expect(prisma.appointment.findMany).not.toHaveBeenCalled()
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
  })

  it('gives the dental assistant appointments but no invoices', async () => {
    mockHospitalAuth({ user: { id: 'u3', role: 'DENTAL_ASSISTANT' } })
    everythingMatches()

    const res = await searchGET(makeReq('/api/search?q=John'))
    const body = await res.json()

    expect(body.appointments).toHaveLength(1)
    expect(body.invoices).toEqual([])
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
  })

  it('answers a role with no patient access with nothing, not a refusal', async () => {
    mockHospitalAuth({ user: { id: 'u4', role: 'INVENTORY_STAFF' } })
    everythingMatches()

    const res = await searchGET(makeReq('/api/search?q=John'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.patients).toEqual([])
    expect(prisma.patient.findMany).not.toHaveBeenCalled()
  })
})

// Notifications were section 3. The table, the route and the tray are gone:
// nothing ever created a notification, so the bell showed zero from the fork
// onwards. See the 20260915210000_drop_unwritten_tables migration.
