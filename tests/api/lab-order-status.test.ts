import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LabOrderStatus } from '@prisma/client'

const mockAuth = vi.hoisted(() => {
  const requireAuthAndRole = vi.fn()
  // Routes gate on capabilities now (lib/rbac). Rather than stub the check
  // away, run the real matrix against whatever role the test put on
  // requireAuthAndRole — so a "returns 403 for X" case exercises the actual
  // rules instead of a mock that always says yes.
  const decide = async (perms: string[]) => {
    const { can } = await import('@/lib/rbac')
    const { NextResponse } = await import('next/server')
    const res = await requireAuthAndRole()
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
  return {
    requireAuthAndRole,
    requirePermission: vi.fn((p: string) => decide([p])),
    requireAllPermissions: vi.fn((p: string[]) => decide(p)),
  }
})

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

const { prisma } = await import('../__mocks__/prisma')
const statusModule = await import('@/app/api/lab-orders/[id]/status/route')

function makeRequest(body?: any) {
  return new Request('http://localhost/api/lab-orders/order-1/status', {
    method: 'PATCH',
    ...(body
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  }) as any
}

const ctx = { params: Promise.resolve({ id: 'order-1' }) }

/** The order as the route selects it, before any status change. */
function existingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    status: LabOrderStatus.CREATED,
    sentDate: null,
    receivedDate: null,
    deliveredDate: null,
    ...overrides,
  }
}

/** The data passed to prisma.labOrder.update in the transaction. */
function updateData() {
  return prisma.labOrder.update.mock.calls[0][0].data
}

describe('Lab Order Status API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
    })
    // The route batches the update and the history insert; the mock client
    // resolves $transaction by running the array it is given.
    prisma.$transaction.mockImplementation((arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
    )
    prisma.labOrder.update.mockResolvedValue({ id: 'order-1' })
    prisma.auditLog.create.mockResolvedValue({ id: 'history-1' })
  })

  describe('PATCH /api/lab-orders/[id]/status', () => {
    it('updates lab order status', async () => {
      prisma.labOrder.findFirst.mockResolvedValue(existingOrder())

      const res = await statusModule.PATCH(makeRequest({ status: 'in_progress' }), ctx)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('updated successfully')
      expect(updateData().status).toBe(LabOrderStatus.IN_PROGRESS)
    })

    it('auto-sets sentDate for sent_to_lab status', async () => {
      prisma.labOrder.findFirst.mockResolvedValue(existingOrder())

      const res = await statusModule.PATCH(makeRequest({ status: 'sent_to_lab' }), ctx)
      expect(res.status).toBe(200)
      expect(updateData().sentDate).toBeInstanceOf(Date)
    })

    it('auto-sets receivedDate for ready status', async () => {
      prisma.labOrder.findFirst.mockResolvedValue(
        existingOrder({ status: LabOrderStatus.IN_PROGRESS, sentDate: new Date('2026-01-01') })
      )

      const res = await statusModule.PATCH(makeRequest({ status: 'ready' }), ctx)
      expect(res.status).toBe(200)
      expect(updateData().receivedDate).toBeInstanceOf(Date)
    })

    it('auto-sets deliveredDate for fitted status', async () => {
      prisma.labOrder.findFirst.mockResolvedValue(
        existingOrder({
          status: LabOrderStatus.READY,
          sentDate: new Date('2026-01-01'),
          receivedDate: new Date('2026-01-10'),
        })
      )

      const res = await statusModule.PATCH(makeRequest({ status: 'fitted' }), ctx)
      expect(res.status).toBe(200)
      expect(updateData().deliveredDate).toBeInstanceOf(Date)
    })

    it('does not overwrite a milestone date that is already set', async () => {
      const sentDate = new Date('2026-01-01')
      prisma.labOrder.findFirst.mockResolvedValue(existingOrder({ sentDate }))

      await statusModule.PATCH(makeRequest({ status: 'sent_to_lab' }), ctx)
      expect(updateData().sentDate).toBeUndefined()
    })

    it('returns 400 when status is missing', async () => {
      const res = await statusModule.PATCH(makeRequest({}), ctx)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('required')
    })

    it('returns 400 for invalid status value', async () => {
      const res = await statusModule.PATCH(makeRequest({ status: 'INVALID_STATUS' }), ctx)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Invalid status')
    })

    it('returns 404 when lab order not found', async () => {
      prisma.labOrder.findFirst.mockResolvedValue(null)

      const res = await statusModule.PATCH(makeRequest({ status: 'in_progress' }), ctx)
      expect(res.status).toBe(404)
    })

    /**
     * The trail is the audit log now. `LabOrderHistory` was a table that
     * recorded who changed a lab order's status and when — and nothing else,
     * which is exactly what AuditLog records for every other kind of change.
     */
    it('records the change in the audit log with the supplied notes', async () => {
      prisma.labOrder.findFirst.mockResolvedValue(existingOrder())

      await statusModule.PATCH(
        makeRequest({ status: 'in_progress', notes: 'Started work on crown' }),
        ctx
      )

      const entry = prisma.auditLog.create.mock.calls[0][0].data
      expect(entry).toMatchObject({
        hospitalId: 'hospital-1',
        userId: 'user-1',
        action: 'lab_order.status_changed',
        entityType: 'LabOrder',
        entityId: 'order-1',
      })
      expect(JSON.parse(entry.oldValues)).toEqual({ status: LabOrderStatus.CREATED })
      expect(JSON.parse(entry.newValues)).toEqual({
        status: LabOrderStatus.IN_PROGRESS,
        notes: 'Started work on crown',
      })
    })

    it('falls back to a generated note when none is supplied', async () => {
      prisma.labOrder.findFirst.mockResolvedValue(existingOrder())

      await statusModule.PATCH(makeRequest({ status: 'in_progress' }), ctx)

      const entry = prisma.auditLog.create.mock.calls[0][0].data
      expect(JSON.parse(entry.newValues).notes).toContain('IN_PROGRESS')
    })

    it('returns 401 when not authenticated', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
        hospitalId: null,
        session: null,
      })

      const res = await statusModule.PATCH(makeRequest({ status: 'in_progress' }), ctx)
      expect(res.status).toBe(401)
    })

    it('accepts every LabOrderStatus, in legacy lowercase form', async () => {
      for (const status of Object.values(LabOrderStatus)) {
        vi.clearAllMocks()
        mockAuth.requireAuthAndRole.mockResolvedValue({
          error: null,
          hospitalId: 'hospital-1',
          session: { user: { id: 'user-1', role: 'ADMIN' } },
        })
        prisma.$transaction.mockImplementation((arg: any) =>
          typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
        )
        prisma.labOrder.findFirst.mockResolvedValue(existingOrder())
        prisma.labOrder.update.mockResolvedValue({ id: 'order-1' })
        prisma.auditLog.create.mockResolvedValue({ id: 'history-1' })

        const res = await statusModule.PATCH(makeRequest({ status: status.toLowerCase() }), ctx)
        expect(res.status).toBe(200)
      }
    })
  })
})
