import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

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
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

const detailModule = await import('@/app/api/payments/[id]/route')
const refundModule = await import('@/app/api/payments/[id]/refund/route')

function makeRequest(method: string, body?: any) {
  return new Request('http://localhost/api/payments/pay-1', {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  }) as any
}

const ctx = { params: Promise.resolve({ id: 'pay-1' }) }

describe('Payments Detail & Refund API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      user: { id: 'user-1', role: 'ADMIN' },
      session: { user: { id: 'user-1', role: 'ADMIN' } },
    })
    // Taking money needs an open till (finding 38); these cases are about
    // other things, so one is open unless a case says otherwise.
    ;(prisma.cashierSession.findFirst as any).mockResolvedValue({
      id: 'cs-1',
      sessionNo: 'CS-202610-0001',
      status: 'OPEN',
    })
  })

  // ─── GET /api/payments/[id] ───────────────────────────
  describe('GET /api/payments/[id]', () => {
    it('returns payment with invoice and patient details', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        amount: 1000,
        paymentMethod: 'CASH',
        status: 'COMPLETED',
        invoice: {
          id: 'inv-1',
          invoiceNo: 'INV001',
          totalAmount: 2000,
          paidAmount: 1000,
          balanceAmount: 1000,
          status: 'PARTIALLY_PAID',
          patient: {
            id: 'p1',
            patientId: 'PAT001',
            firstName: 'John',
            lastName: 'Doe',
            phone: '9876543210',
            email: 'john@test.com',
          },
        },
      })

      const res = await detailModule.GET(makeRequest('GET'), ctx)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.amount).toBe(1000)
      expect(body.invoice.patient.firstName).toBe('John')
    })

    it('returns 404 when payment not found', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue(null)

      const res = await detailModule.GET(makeRequest('GET'), ctx)
      expect(res.status).toBe(404)
    })

    it('returns 401 when not authenticated', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
        hospitalId: null,
        session: null,
      })

      const res = await detailModule.GET(makeRequest('GET'), ctx)
      expect(res.status).toBe(401)
    })
  })

  // ─── PUT /api/payments/[id] ───────────────────────────
  describe('PUT /api/payments/[id]', () => {
    it('updates payment notes', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
        amount: 1000,
        invoice: { paidAmount: 0, totalAmount: 2000, status: 'PENDING' },
      })
      ;(prisma.payment.update as any).mockResolvedValue({
        id: 'pay-1',
        notes: 'Updated note',
        invoice: {
          id: 'inv-1',
          invoiceNo: 'INV001',
          totalAmount: 2000,
          paidAmount: 0,
          balanceAmount: 2000,
          status: 'PENDING',
        },
      })

      const res = await detailModule.PUT(makeRequest('PUT', { notes: 'Updated note' }), ctx)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.notes).toBe('Updated note')
    })

    it('completes a pending payment and updates invoice', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
        amount: 2000,
        invoiceId: 'inv-1',
        invoice: { paidAmount: 0, totalAmount: 2000, status: 'PENDING' },
      })
      ;(prisma.invoice.update as any).mockResolvedValue({})
      ;(prisma.payment.update as any).mockResolvedValue({
        id: 'pay-1',
        status: 'COMPLETED',
        invoice: { id: 'inv-1', status: 'PAID' },
      })
      // The invoice is recounted from its payments: nothing settled before,
      // this one after.
      ;(prisma.payment.findMany as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amount: 2000, status: 'COMPLETED', refunds: [] }])

      const res = await detailModule.PUT(makeRequest('PUT', { status: 'COMPLETED' }), ctx)
      expect(res.status).toBe(200)
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { paidAmount: 2000, balanceAmount: 0, status: 'PAID' },
        })
      )
    })

    // Finding 38: money completed with no till open would belong to no till.
    it('refuses to complete a pending payment when no till is open', async () => {
      ;(prisma.cashierSession.findFirst as any).mockResolvedValue(null)
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
        amount: 2000,
        invoiceId: 'inv-1',
        invoice: { paidAmount: 0, totalAmount: 2000, status: 'PENDING' },
      })
      ;(prisma.payment.findMany as any).mockResolvedValueOnce([])

      const res = await detailModule.PUT(makeRequest('PUT', { status: 'COMPLETED' }), ctx)
      expect(res.status).toBe(409)
      await expect(res.json()).resolves.toMatchObject({ code: 'NO_OPEN_TILL' })
      expect(prisma.payment.update).not.toHaveBeenCalled()
    })

    it('puts a completed pending payment in the till open now', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
        amount: 2000,
        invoiceId: 'inv-1',
        cashierSessionId: null,
        invoice: { paidAmount: 0, totalAmount: 2000, status: 'PENDING' },
      })
      ;(prisma.invoice.update as any).mockResolvedValue({})
      ;(prisma.payment.update as any).mockResolvedValue({
        id: 'pay-1',
        status: 'COMPLETED',
        invoice: { id: 'inv-1', status: 'PAID' },
      })
      ;(prisma.payment.findMany as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amount: 2000, status: 'COMPLETED', refunds: [] }])

      const res = await detailModule.PUT(makeRequest('PUT', { status: 'COMPLETED' }), ctx)
      expect(res.status).toBe(200)
      expect((prisma.payment.update as any).mock.calls[0][0].data).toMatchObject({
        status: 'COMPLETED',
        cashierSessionId: 'cs-1',
      })
    })

    it('refuses to complete a pending payment on a cancelled invoice', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
        amount: 2000,
        invoiceId: 'inv-1',
        invoice: { paidAmount: 0, totalAmount: 2000, status: 'CANCELLED' },
      })

      const res = await detailModule.PUT(makeRequest('PUT', { status: 'COMPLETED' }), ctx)
      expect(res.status).toBe(409)
      expect(prisma.payment.update).not.toHaveBeenCalled()
      expect(prisma.invoice.update).not.toHaveBeenCalled()
    })

    it('rejects changing status of completed payment', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'COMPLETED',
        amount: 1000,
        invoice: { paidAmount: 1000, totalAmount: 1000, status: 'PAID' },
      })

      const res = await detailModule.PUT(makeRequest('PUT', { status: 'CANCELLED' }), ctx)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('refund')
    })

    it('returns 400 when no valid fields to update', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
        amount: 1000,
        invoice: { paidAmount: 0, totalAmount: 1000, status: 'PENDING' },
      })

      const res = await detailModule.PUT(makeRequest('PUT', {}), ctx)
      expect(res.status).toBe(400)
    })

    it('returns 403 without billing:write', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: null,
        hospitalId: 'hospital-1',
        session: { user: { id: 'user-1', role: 'LAB_TECH' } },
      })

      const res = await detailModule.PUT(makeRequest('PUT', { notes: 'test' }), ctx)
      expect(res.status).toBe(403)
    })

    it('returns 404 when payment not found', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue(null)

      const res = await detailModule.PUT(makeRequest('PUT', { notes: 'test' }), ctx)
      expect(res.status).toBe(404)
    })
  })

  // ─── DELETE /api/payments/[id] ────────────────────────
  describe('DELETE /api/payments/[id]', () => {
    it('deletes a pending payment', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
      })
      ;(prisma.payment.delete as any).mockResolvedValue({})

      const res = await detailModule.DELETE(makeRequest('DELETE'), ctx)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toContain('deleted')
    })

    it('rejects deleting completed payment', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue({
        id: 'pay-1',
        status: 'COMPLETED',
      })

      const res = await detailModule.DELETE(makeRequest('DELETE'), ctx)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('refund')
    })

    it('returns 404 when payment not found', async () => {
      ;(prisma.payment.findUnique as any).mockResolvedValue(null)

      const res = await detailModule.DELETE(makeRequest('DELETE'), ctx)
      expect(res.status).toBe(404)
    })

    it('returns 403 for non-ADMIN roles', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: null,
        hospitalId: 'hospital-1',
        session: { user: { id: 'user-1', role: 'ACCOUNTANT' } },
      })

      const res = await detailModule.DELETE(makeRequest('DELETE'), ctx)
      expect(res.status).toBe(403)
    })
  })

  // ─── POST /api/payments/[id]/refund ───────────────────
  //
  // Rewritten for FR-014. A refund is now its own record rather than an edit
  // of the payment, so these assert the shape of that record and the invoice
  // it writes back to; the full FR-014 surface (method, authoriser, partial
  // refunds, till attachment) is covered in refund-and-discount-approval.test.
  describe('POST /api/payments/[id]/refund', () => {
    beforeEach(() => {
      ;(prisma.refund.findFirst as any).mockResolvedValue(null)
      ;(prisma.refund.create as any).mockResolvedValue({ id: 'ref-1', refundNo: 'REF-1' })
      ;(prisma.payment.update as any).mockResolvedValue({})
      ;(prisma.invoice.update as any).mockResolvedValue({})
    })

    it('processes full refund successfully', async () => {
      ;(prisma.payment.findFirst as any).mockResolvedValue({
        id: 'pay-1',
        paymentNo: 'PAY-1',
        status: 'COMPLETED',
        amount: 1000,
        paymentMethod: 'CASH',
        invoiceId: 'inv-1',
        refunds: [],
        invoice: { paidAmount: 1000, totalAmount: 1000, status: 'PAID' },
      })

      // After the refund, the one payment on the invoice has gone back in full.
      ;(prisma.payment.findMany as any).mockResolvedValue([
        { amount: 1000, status: 'REFUNDED', refundAmount: 1000, refunds: [{ amount: 1000 }] },
      ])

      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 1000, refundReason: 'Patient request' }),
        ctx
      )
      expect(res.status).toBe(201)
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REFUNDED' }),
        })
      )
    })

    it('processes partial refund', async () => {
      ;(prisma.payment.findFirst as any).mockResolvedValue({
        id: 'pay-1',
        paymentNo: 'PAY-1',
        status: 'COMPLETED',
        amount: 1000,
        paymentMethod: 'CASH',
        invoiceId: 'inv-1',
        refunds: [],
        invoice: { paidAmount: 1000, totalAmount: 1000, status: 'PAID' },
      })

      ;(prisma.payment.findMany as any).mockResolvedValue([
        {
          amount: 1000,
          status: 'PARTIALLY_REFUNDED',
          refundAmount: 500,
          refunds: [{ amount: 500 }],
        },
      ])

      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 500, refundReason: 'Partial adjustment' }),
        ctx
      )
      expect(res.status).toBe(201)
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PARTIALLY_PAID', paidAmount: 500 }),
        })
      )
    })

    // Finding 39: the paid amount is counted from the invoice's payments. Two
    // Rs 3,000 payments on a Rs 3,000 invoice, one of them refunded, leave it
    // PAID with 3,000 paid — not REFUNDED with nothing paid, which is what
    // subtracting from the invoice's own running total of 3,000 gave.
    it('recounts the invoice from its payments after refunding a duplicate', async () => {
      ;(prisma.payment.findFirst as any).mockResolvedValue({
        id: 'pay-1',
        paymentNo: 'PAY-6',
        status: 'COMPLETED',
        amount: 3000,
        paymentMethod: 'CASH',
        invoiceId: 'inv-1',
        refunds: [],
        invoice: { id: 'inv-1', paidAmount: 3000, totalAmount: 3000, status: 'PAID' },
      })
      ;(prisma.payment.findMany as any).mockResolvedValue([
        { amount: 3000, status: 'COMPLETED', refunds: [] },
        { amount: 3000, status: 'REFUNDED', refundAmount: 3000, refunds: [{ amount: 3000 }] },
      ])

      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 3000, refundReason: 'Duplicate payment' }),
        ctx
      )
      expect(res.status).toBe(201)
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { paidAmount: 3000, balanceAmount: 0, status: 'PAID' },
        })
      )
    })

    it('returns 400 for invalid refund amount', async () => {
      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 0, refundReason: 'Nothing to give back' }),
        ctx
      )
      expect(res.status).toBe(400)
    })

    // New under FR-014: the reason is the point of the record.
    it('returns 400 when no reason is given', async () => {
      const res = await refundModule.POST(makeRequest('POST', { refundAmount: 500 }), ctx)
      expect(res.status).toBe(400)
      expect(prisma.refund.create).not.toHaveBeenCalled()
    })

    it('returns 400 when refund exceeds payment amount', async () => {
      ;(prisma.payment.findFirst as any).mockResolvedValue({
        id: 'pay-1',
        paymentNo: 'PAY-1',
        status: 'COMPLETED',
        amount: 500,
        paymentMethod: 'CASH',
        invoiceId: 'inv-1',
        refunds: [],
        invoice: { paidAmount: 500, totalAmount: 500, status: 'PAID' },
      })

      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 1000, refundReason: 'Too much' }),
        ctx
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('exceeds')
    })

    it('returns 400 for a payment that never settled', async () => {
      ;(prisma.payment.findFirst as any).mockResolvedValue({
        id: 'pay-1',
        paymentNo: 'PAY-1',
        status: 'PENDING',
        amount: 1000,
        paymentMethod: 'CASH',
        refunds: [],
        invoice: {},
      })

      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 500, refundReason: 'Never arrived' }),
        ctx
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('settled')
    })

    // Fully refunded is now decided by the refund records, not by a single
    // legacy field being non-null — which is what used to block second
    // refunds after a partial one.
    it('returns 400 for an already fully refunded payment', async () => {
      ;(prisma.payment.findFirst as any).mockResolvedValue({
        id: 'pay-1',
        paymentNo: 'PAY-1',
        status: 'REFUNDED',
        amount: 1000,
        paymentMethod: 'CASH',
        refunds: [{ amount: 1000 }],
        invoice: {},
      })

      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 500, refundReason: 'Once more' }),
        ctx
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('already been refunded')
    })

    it('returns 404 when payment not found', async () => {
      ;(prisma.payment.findFirst as any).mockResolvedValue(null)

      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 500, refundReason: 'Not ours' }),
        ctx
      )
      expect(res.status).toBe(404)
    })

    it('returns 403 for a role without billing:refund', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: null,
        hospitalId: 'hospital-1',
        user: { id: 'user-1', role: 'DOCTOR' },
        session: { user: { id: 'user-1', role: 'DOCTOR' } },
      })

      const res = await refundModule.POST(
        makeRequest('POST', { refundAmount: 500, refundReason: 'Please' }),
        ctx
      )
      expect(res.status).toBe(403)
    })
  })
})
