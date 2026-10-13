// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { LabOrderStatus, VendorStatus } from '@prisma/client'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

// The lab module is a paid feature (lib/plan-gate.ts). These tests are about
// what the routes do once it is included; the refusal has its own test.
vi.mock('@/lib/plan-gate', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

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

// ── Imports ──────────────────────────────────────────────────────────────────

import { GET as vendorsGET, POST as vendorsPOST } from '@/app/api/lab-vendors/route'
import {
  GET as vendorDetailGET,
  PUT as vendorDetailPUT,
  DELETE as vendorDetailDELETE,
} from '@/app/api/lab-vendors/[id]/route'
import {
  GET as labOrderDetailGET,
  PUT as labOrderDetailPUT,
  DELETE as labOrderDetailDELETE,
} from '@/app/api/lab-orders/[id]/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { requireFeature } from '@/lib/plan-gate'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    hospitalId: 'h1',
    session: { user: { id: 'u1', name: 'Admin', role: 'ADMIN' } },
  }
  vi.mocked(requireAuthAndRole).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function mockAuthError() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
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

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/lab-vendors (Prisma)
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/lab-vendors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await vendorsGET(makeReq('/api/lab-vendors'))
    expect(res.status).toBe(401)
  })

  it('returns vendors with pagination', async () => {
    mockAuth()
    const mockVendors = [
      { id: 'v1', name: 'Lab A', phone: '9876543210', status: 'ACTIVE' },
      { id: 'v2', name: 'Lab B', phone: '9876543211', status: 'ACTIVE' },
    ]
    vi.mocked(prisma.vendor.count).mockResolvedValue(2)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue(mockVendors as any)

    const res = await vendorsGET(makeReq('/api/lab-vendors'))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(body.pagination.total).toBe(2)
  })

  it('filters by search term', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.count).mockResolvedValue(0)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([])

    await vendorsGET(makeReq('/api/lab-vendors?search=dental'))

    const whereArg = vi.mocked(prisma.vendor.findMany).mock.calls[0][0]?.where
    expect(whereArg.OR).toBeDefined()
    expect(whereArg.OR.length).toBe(3)
  })

  /**
   * Laboratories and suppliers are one table now, told apart by `kind`. Without
   * that filter the laboratories screen would list the clinic's materials
   * suppliers, so it is worth asserting rather than assuming.
   */
  it('lists only laboratories, and only ones that are not deleted', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.count).mockResolvedValue(0)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([])

    await vendorsGET(makeReq('/api/lab-vendors'))

    expect(vi.mocked(prisma.vendor.findMany).mock.calls[0][0]?.where).toMatchObject({
      hospitalId: 'h1',
      kind: 'LAB',
      // LabVendor had a `deletedAt` column that nothing ever filtered on, so a
      // deleted laboratory stayed on the list for ever.
      deletedAt: null,
    })
  })

  it('filters by active status', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.count).mockResolvedValue(0)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([])

    await vendorsGET(makeReq('/api/lab-vendors?status=active'))

    const whereArg = vi.mocked(prisma.vendor.findMany).mock.calls[0][0]?.where
    expect(whereArg.status).toBe(VendorStatus.ACTIVE)
  })

  it('filters by inactive status', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.count).mockResolvedValue(0)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([])

    await vendorsGET(makeReq('/api/lab-vendors?status=inactive'))

    const whereArg = vi.mocked(prisma.vendor.findMany).mock.calls[0][0]?.where
    expect(whereArg.status).toBe(VendorStatus.INACTIVE)
  })

  /**
   * The old filter read the `isActive` boolean, which made "inactive" and
   * "blocked" the same query — the screen could not tell a laboratory that had
   * simply lapsed from one the clinic had refused to use again.
   */
  it('tells a blocked laboratory apart from an inactive one', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.count).mockResolvedValue(0)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([])

    await vendorsGET(makeReq('/api/lab-vendors?status=blocked'))

    expect(vi.mocked(prisma.vendor.findMany).mock.calls[0][0]?.where.status).toBe(
      VendorStatus.BLOCKED
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /api/lab-vendors (Prisma)
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/lab-vendors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await vendorsPOST(
      makeReq('/api/lab-vendors', 'POST', { name: 'Lab A', phone: '123' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when required fields missing', async () => {
    mockAuth()
    const res = await vendorsPOST(makeReq('/api/lab-vendors', 'POST', { email: 'test@lab.com' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('required')
  })

  it('creates a lab vendor', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.create).mockResolvedValue({
      id: 'v1',
      name: 'Lab A',
      phone: '9876543210',
      hospitalId: 'h1',
      isActive: true,
    } as any)

    const res = await vendorsPOST(
      makeReq('/api/lab-vendors', 'POST', {
        name: 'Lab A',
        phone: '9876543210',
        contactPerson: 'Dr. Smith',
        email: 'lab@example.com',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.name).toBe('Lab A')
  })

  // Finding 20: the form sent `rating: 0`, the route stored `0 || null`, and
  // the page called `.toFixed` on the null.
  it('stores a rating of 0, or none, as null', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.create).mockResolvedValue({ id: 'v1' } as any)

    await vendorsPOST(makeReq('/api/lab-vendors', 'POST', { name: 'Lab A', phone: '1', rating: 0 }))
    await vendorsPOST(makeReq('/api/lab-vendors', 'POST', { name: 'Lab B', phone: '2' }))

    expect(vi.mocked(prisma.vendor.create).mock.calls[0][0].data.rating).toBeNull()
    expect(vi.mocked(prisma.vendor.create).mock.calls[1][0].data.rating).toBeNull()
  })

  it('refuses a rating outside 1 to 5', async () => {
    mockAuth()

    const res = await vendorsPOST(
      makeReq('/api/lab-vendors', 'POST', { name: 'Lab A', phone: '1', rating: 4.5 })
    )

    expect(res.status).toBe(400)
    expect(prisma.vendor.create).not.toHaveBeenCalled()
  })

  it('maps the form status onto the enum rather than failing on it', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.create).mockResolvedValue({ id: 'v1' } as any)

    await vendorsPOST(
      makeReq('/api/lab-vendors', 'POST', { name: 'Lab A', phone: '1', status: 'active' })
    )

    expect(vi.mocked(prisma.vendor.create).mock.calls[0][0].data.status).toBe(VendorStatus.ACTIVE)
  })

  // Finding 26: a Free clinic created a lab vendor (201).
  it('refuses on a plan without the lab module, with a message for the toast', async () => {
    mockAuth()
    vi.mocked(requireFeature).mockResolvedValueOnce(
      NextResponse.json(
        { error: 'The lab module is not included in the Free plan. Upgrade to use it.' },
        { status: 403 }
      )
    )

    const res = await vendorsPOST(makeReq('/api/lab-vendors', 'POST', { name: 'L', phone: '1' }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('Upgrade')
    expect(prisma.vendor.create).not.toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. GET /api/lab-vendors/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/lab-vendors/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await vendorDetailGET(makeReq('/api/lab-vendors/v1'), makeParams('v1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when vendor not found', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null)

    const res = await vendorDetailGET(makeReq('/api/lab-vendors/v1'), makeParams('v1'))
    expect(res.status).toBe(404)
  })

  it('returns vendor detail', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({
      id: 'v1',
      code: 'LV001',
      name: 'Lab A',
      phone: '9876543210',
      status: VendorStatus.ACTIVE,
    } as any)

    const res = await vendorDetailGET(makeReq('/api/lab-vendors/v1'), makeParams('v1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.name).toBe('Lab A')
    expect(body.data.code).toBe('LV001')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. PUT /api/lab-vendors/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /api/lab-vendors/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when vendor not found', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null)

    const res = await vendorDetailPUT(
      makeReq('/api/lab-vendors/v1', 'PUT', { code: 'LV001', name: 'X', phone: '1' }),
      makeParams('v1')
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when required fields missing', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({ id: 'v1' } as any)

    const res = await vendorDetailPUT(
      makeReq('/api/lab-vendors/v1', 'PUT', { name: 'X' }),
      makeParams('v1')
    )
    expect(res.status).toBe(400)
  })

  it('returns 409 when the vendor code is a duplicate', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst)
      .mockResolvedValueOnce({ id: 'v1' } as any)
      .mockResolvedValueOnce({ id: 'v2' } as any)

    const res = await vendorDetailPUT(
      makeReq('/api/lab-vendors/v1', 'PUT', { code: 'LV002', name: 'X', phone: '1' }),
      makeParams('v1')
    )
    expect(res.status).toBe(409)
  })

  it('updates vendor successfully', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst)
      .mockResolvedValueOnce({ id: 'v1' } as any)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.vendor.update).mockResolvedValue({ id: 'v1' } as any)

    const res = await vendorDetailPUT(
      makeReq('/api/lab-vendors/v1', 'PUT', {
        code: 'LV001',
        name: 'Updated Lab',
        phone: '9876543210',
        status: 'blocked',
        creditLimit: 5000,
      }),
      makeParams('v1')
    )
    expect(res.status).toBe(200)

    const data = vi.mocked(prisma.vendor.update).mock.calls[0][0].data
    expect(data.name).toBe('Updated Lab')
    expect(data.creditLimit).toBe(5000)
    // Legacy lowercase status is accepted and mapped onto the enum.
    expect(data.status).toBe(VendorStatus.BLOCKED)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. DELETE /api/lab-vendors/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/lab-vendors/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when vendor not found', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null)

    const res = await vendorDetailDELETE(makeReq('/api/lab-vendors/v1'), makeParams('v1'))
    expect(res.status).toBe(404)
  })

  it('returns 400 when the vendor still has lab orders', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({ id: 'v1' } as any)
    vi.mocked(prisma.labOrder.count).mockResolvedValue(3)

    const res = await vendorDetailDELETE(makeReq('/api/lab-vendors/v1'), makeParams('v1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('existing lab orders')
  })

  it('soft deletes the vendor', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({ id: 'v1' } as any)
    vi.mocked(prisma.labOrder.count).mockResolvedValue(0)
    vi.mocked(prisma.vendor.update).mockResolvedValue({ id: 'v1' } as any)

    const res = await vendorDetailDELETE(makeReq('/api/lab-vendors/v1'), makeParams('v1'))
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.vendor.update).mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. GET /api/lab-orders/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/lab-orders/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await labOrderDetailGET(makeReq('/api/lab-orders/lo1'), makeParams('lo1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(null)

    const res = await labOrderDetailGET(makeReq('/api/lab-orders/lo1'), makeParams('lo1'))
    expect(res.status).toBe(404)
  })

  it('returns the order with its status trail', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue({
      id: 'lo1',
      orderNumber: 'LO-001',
      status: LabOrderStatus.IN_PROGRESS,
      createdBy: 'u1',
      labVendor: {
        name: 'Lab A',
        phone: '1',
        email: 'a@lab.com',
        address: 'Street',
        avgTurnaround: 5,
        rating: 4,
      },
      patient: {
        patientId: 'PAT001',
        firstName: 'Rahul',
        lastName: 'Sharma',
        phone: '99',
        email: 'r@x.com',
      },
    } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Admin' } as any)
    // The trail comes from the audit log. `LabOrderHistory` recorded who
    // changed a lab order's status and when — and nothing else, which is what
    // AuditLog already records for every other kind of change in the system.
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      {
        id: 'h1',
        createdAt: new Date(),
        oldValues: JSON.stringify({ status: LabOrderStatus.CREATED }),
        newValues: JSON.stringify({
          status: LabOrderStatus.IN_PROGRESS,
          notes: 'Sent to lab',
        }),
        user: { name: 'Admin' },
      },
    ] as any)

    const res = await labOrderDetailGET(makeReq('/api/lab-orders/lo1'), makeParams('lo1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.vendorName).toBe('Lab A')
    expect(body.data.patientName).toBe('Rahul Sharma')
    expect(body.data.createdByName).toBe('Admin')
    expect(body.data.history[0]).toMatchObject({
      statusFrom: LabOrderStatus.CREATED,
      statusTo: LabOrderStatus.IN_PROGRESS,
      notes: 'Sent to lab',
      changedByName: 'Admin',
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. PUT /api/lab-orders/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /api/lab-orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockImplementation((arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
    )
    // The laboratory named on the case, in this clinic.
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({ id: 'v1' } as any)
    vi.mocked(prisma.labOrder.update).mockResolvedValue({ id: 'lo1' } as any)
  })

  /** The case as the route reads it before changing it. */
  function existingCase(overrides: Record<string, unknown> = {}) {
    return {
      id: 'lo1',
      status: LabOrderStatus.CREATED,
      patientId: 'p1',
      labVendorId: 'v1',
      sentDate: null,
      receivedDate: null,
      deliveredDate: null,
      ...overrides,
    }
  }

  const validBody = {
    patientId: 'p1',
    labVendorId: 'v1',
    workType: 'CROWN',
    orderDate: '2026-01-01',
    estimatedCost: 5000,
  }

  it('returns 404 when order not found', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(null)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', validBody),
      makeParams('lo1')
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when required fields missing', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue({
      id: 'lo1',
      status: LabOrderStatus.CREATED,
    } as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', { patientId: 'p1' }),
      makeParams('lo1')
    )
    expect(res.status).toBe(400)
  })

  it('updates the lab order and logs the status change', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue({
      id: 'lo1',
      status: LabOrderStatus.CREATED,
    } as any)
    vi.mocked(prisma.labOrder.update).mockResolvedValue({ id: 'lo1' } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'h1' } as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', {
        ...validBody,
        status: LabOrderStatus.SENT_TO_LAB,
      }),
      makeParams('lo1')
    )
    expect(res.status).toBe(200)

    const entry = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data
    expect(entry).toMatchObject({
      action: 'lab_order.status_changed',
      entityType: 'LabOrder',
      entityId: 'lo1',
      userId: 'u1',
    })
    expect(JSON.parse(entry.oldValues as string)).toEqual({ status: LabOrderStatus.CREATED })
    expect(JSON.parse(entry.newValues as string)).toMatchObject({
      status: LabOrderStatus.SENT_TO_LAB,
    })
    // The milestone is stamped the same way the status route stamps it.
    expect(vi.mocked(prisma.labOrder.update).mock.calls[0][0].data.sentDate).toBeInstanceOf(Date)
  })

  it('records nothing when the status is unchanged', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue({
      id: 'lo1',
      status: LabOrderStatus.CREATED,
    } as any)
    vi.mocked(prisma.labOrder.update).mockResolvedValue({ id: 'lo1' } as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', { ...validBody, status: LabOrderStatus.CREATED }),
      makeParams('lo1')
    )
    expect(res.status).toBe(200)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })
  // Finding 45: the same rules as the status route.
  it('refuses a status jump through the edit route too', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(existingCase() as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', { ...validBody, status: LabOrderStatus.FITTED }),
      makeParams('lo1')
    )

    expect(res.status).toBe(400)
    expect(prisma.labOrder.update).not.toHaveBeenCalled()
  })

  it('does not take milestone dates from the body', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(existingCase() as any)

    await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', { ...validBody, deliveredDate: '2026-01-02' }),
      makeParams('lo1')
    )

    expect(vi.mocked(prisma.labOrder.update).mock.calls[0][0].data).not.toHaveProperty(
      'deliveredDate'
    )
  })

  // Finding 59.
  it('refuses an expected date before the order date', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(existingCase() as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', {
        ...validBody,
        orderDate: '2026-10-12',
        expectedDate: '2026-10-01',
      }),
      makeParams('lo1')
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('before the order date')
  })

  it('refuses a negative cost', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(existingCase() as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', { ...validBody, actualCost: -100 }),
      makeParams('lo1')
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('negative')
  })

  // Finding 60.
  it("links the case to this patient's treatment", async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(existingCase() as any)
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue({ id: 't1', patientId: 'p1' } as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', { ...validBody, treatmentId: 't1' }),
      makeParams('lo1')
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.treatment.findFirst).mock.calls[0][0].where).toMatchObject({
      id: 't1',
      hospitalId: 'h1',
    })
    expect(vi.mocked(prisma.labOrder.update).mock.calls[0][0].data.treatmentId).toBe('t1')
  })

  it("refuses another patient's treatment", async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(existingCase() as any)
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue({
      id: 't9',
      patientId: 'someone-else',
    } as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', { ...validBody, treatmentId: 't9' }),
      makeParams('lo1')
    )

    expect(res.status).toBe(400)
    expect(prisma.labOrder.update).not.toHaveBeenCalled()
  })

  it('refuses a priority the column does not have', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(existingCase() as any)

    const res = await labOrderDetailPUT(
      makeReq('/api/lab-orders/lo1', 'PUT', { ...validBody, priority: 'HIGH' }),
      makeParams('lo1')
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('priority')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. DELETE /api/lab-orders/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/lab-orders/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when order not found', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue(null)

    const res = await labOrderDetailDELETE(makeReq('/api/lab-orders/lo1'), makeParams('lo1'))
    expect(res.status).toBe(404)
  })

  it('returns 400 when the order is already in progress', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue({
      id: 'lo1',
      status: LabOrderStatus.IN_PROGRESS,
    } as any)

    const res = await labOrderDetailDELETE(makeReq('/api/lab-orders/lo1'), makeParams('lo1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('in progress')
  })

  it('allows deletion of created orders', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue({
      id: 'lo1',
      status: LabOrderStatus.CREATED,
    } as any)
    vi.mocked(prisma.labOrder.update).mockResolvedValue({ id: 'lo1' } as any)

    const res = await labOrderDetailDELETE(makeReq('/api/lab-orders/lo1'), makeParams('lo1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(vi.mocked(prisma.labOrder.update).mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date)
  })

  it('allows deletion of cancelled orders', async () => {
    mockAuth()
    vi.mocked(prisma.labOrder.findFirst).mockResolvedValue({
      id: 'lo1',
      status: LabOrderStatus.CANCELLED,
    } as any)
    vi.mocked(prisma.labOrder.update).mockResolvedValue({ id: 'lo1' } as any)

    const res = await labOrderDetailDELETE(makeReq('/api/lab-orders/lo1'), makeParams('lo1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })
})
