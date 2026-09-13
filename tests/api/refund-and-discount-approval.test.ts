/**
 * FR-014 (refund control) and FR-013 (discount control).
 *
 * Both requirements are about accountability rather than arithmetic: who
 * authorised money leaving, why, and against which original transaction. The
 * tests below are written as those questions.
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

import { POST as REFUND } from '@/app/api/payments/[id]/refund/route'
import { POST as DECIDE } from '@/app/api/invoices/[id]/discount-approval/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function signedInAs(role: string, userId = 'u1') {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: userId, role },
  } as any)
}

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const PAYMENT = {
  id: 'p1',
  paymentNo: 'PAY-202609-0001',
  hospitalId: 'h1',
  invoiceId: 'i1',
  amount: 10000,
  paymentMethod: 'CARD',
  status: 'COMPLETED',
  refunds: [],
  invoice: { id: 'i1', totalAmount: 10000, paidAmount: 10000, status: 'PAID' },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.refund.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.refund.create).mockResolvedValue({ id: 'r1', refundNo: 'REF-1' } as never)
  vi.mocked(prisma.payment.update).mockResolvedValue({} as never)
  vi.mocked(prisma.invoice.update).mockResolvedValue({} as never)
})

describe('POST /api/payments/[id]/refund — FR-014', () => {
  it('records amount, method, reason, authoriser and the original payment', async () => {
    signedInAs('ACCOUNTANT', 'acct-1')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(PAYMENT as never)

    const res = await REFUND(
      post('/api/payments/p1/refund', {
        refundAmount: 10000,
        refundReason: 'Treatment cancelled by the patient',
      }),
      params('p1')
    )

    expect(res.status).toBe(201)
    // Every field FR-014 names, on one row.
    expect(vi.mocked(prisma.refund.create).mock.calls[0][0].data).toMatchObject({
      hospitalId: 'h1',
      paymentId: 'p1',
      amount: 10000,
      refundMethod: 'CARD',
      reason: 'Treatment cancelled by the patient',
      authorisedById: 'acct-1',
    })
  })

  // The field the requirement exists for. Without it the trail says money went
  // back but not why.
  it('refuses a refund with no reason', async () => {
    signedInAs('ACCOUNTANT')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(PAYMENT as never)

    const res = await REFUND(post('/api/payments/p1/refund', { refundAmount: 500 }), params('p1'))
    expect(res.status).toBe(400)
    expect(prisma.refund.create).not.toHaveBeenCalled()
  })

  it('refuses a token reason', async () => {
    signedInAs('ACCOUNTANT')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(PAYMENT as never)

    expect(
      (
        await REFUND(
          post('/api/payments/p1/refund', { refundAmount: 500, refundReason: 'x' }),
          params('p1')
        )
      ).status
    ).toBe(400)
  })

  // Card takings are routinely refunded in cash, and the till has to see the
  // outflow under the method the money actually left by.
  it('allows a refund method different from the original payment', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(PAYMENT as never)

    await REFUND(
      post('/api/payments/p1/refund', {
        refundAmount: 2000,
        refundReason: 'Overcharged for the crown',
        refundMethod: 'CASH',
      }),
      params('p1')
    )

    expect(vi.mocked(prisma.refund.create).mock.calls[0][0].data).toMatchObject({
      refundMethod: 'CASH',
    })
  })

  // The old implementation treated `refundAmount` being set at all as "already
  // refunded", so a partial refund could never be followed by another.
  it('allows a second partial refund up to the remaining balance', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...PAYMENT,
      status: 'PARTIALLY_REFUNDED',
      refunds: [{ amount: 3000 }],
    } as never)

    const res = await REFUND(
      post('/api/payments/p1/refund', { refundAmount: 4000, refundReason: 'Second adjustment' }),
      params('p1')
    )

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ remainingRefundable: 3000 })
  })

  it('refuses a refund beyond what is left', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...PAYMENT,
      refunds: [{ amount: 8000 }],
    } as never)

    const res = await REFUND(
      post('/api/payments/p1/refund', { refundAmount: 5000, refundReason: 'Too much' }),
      params('p1')
    )
    expect(res.status).toBe(400)
    expect(prisma.refund.create).not.toHaveBeenCalled()
  })

  it('refuses once the payment is fully refunded', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...PAYMENT,
      status: 'REFUNDED',
      refunds: [{ amount: 10000 }],
    } as never)

    expect(
      (
        await REFUND(
          post('/api/payments/p1/refund', { refundAmount: 1, refundReason: 'Once more' }),
          params('p1')
        )
      ).status
    ).toBe(400)
  })

  it('marks the payment partially refunded rather than refunded', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(PAYMENT as never)

    await REFUND(
      post('/api/payments/p1/refund', { refundAmount: 2500, refundReason: 'Partial adjustment' }),
      params('p1')
    )

    expect(vi.mocked(prisma.payment.update).mock.calls[0][0].data).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundAmount: 2500,
    })
  })

  it('marks it fully refunded when the last of it goes back', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...PAYMENT,
      refunds: [{ amount: 6000 }],
    } as never)

    await REFUND(
      post('/api/payments/p1/refund', { refundAmount: 4000, refundReason: 'Balance returned' }),
      params('p1')
    )

    expect(vi.mocked(prisma.payment.update).mock.calls[0][0].data).toMatchObject({
      status: 'REFUNDED',
      refundAmount: 10000,
    })
  })

  it('attaches the refund to the open till so the closing sees the outflow', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(PAYMENT as never)
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue({
      id: 's1',
      sessionNo: 'CS-202609-0001',
    } as never)

    await REFUND(
      post('/api/payments/p1/refund', { refundAmount: 100, refundReason: 'Small correction' }),
      params('p1')
    )

    expect(vi.mocked(prisma.refund.create).mock.calls[0][0].data).toMatchObject({
      cashierSessionId: 's1',
    })
  })

  it('still records a refund when no till is open', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(PAYMENT as never)

    const res = await REFUND(
      post('/api/payments/p1/refund', { refundAmount: 100, refundReason: 'Out of hours' }),
      params('p1')
    )

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.refund.create).mock.calls[0][0].data).toMatchObject({
      cashierSessionId: null,
    })
  })

  it('refuses to refund a payment that never settled', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...PAYMENT,
      status: 'FAILED',
    } as never)

    expect(
      (
        await REFUND(
          post('/api/payments/p1/refund', { refundAmount: 100, refundReason: 'Never arrived' }),
          params('p1')
        )
      ).status
    ).toBe(400)
  })

  it('is refused to reception', async () => {
    signedInAs('RECEPTIONIST')
    const res = await REFUND(
      post('/api/payments/p1/refund', { refundAmount: 100, refundReason: 'Please' }),
      params('p1')
    )
    expect(res.status).toBe(403)
    expect(prisma.refund.create).not.toHaveBeenCalled()
  })

  it('404s for a payment belonging to another clinic', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null as never)

    expect(
      (
        await REFUND(
          post('/api/payments/p9/refund', { refundAmount: 100, refundReason: 'Not mine' }),
          params('p9')
        )
      ).status
    ).toBe(404)
  })
})

describe('POST /api/invoices/[id]/discount-approval — FR-013', () => {
  const PENDING_INVOICE = {
    id: 'i1',
    invoiceNo: 'INV-202609-0001',
    discountAmount: 5000,
    discountApprovalStatus: 'PENDING',
    discountRequestedById: 'reception-1',
  }

  beforeEach(() => {
    vi.mocked(prisma.invoice.update).mockResolvedValue({ id: 'i1' } as never)
  })

  it('lets a manager approve and records who decided', async () => {
    signedInAs('CLINIC_MANAGER', 'manager-1')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(PENDING_INVOICE as never)

    const res = await DECIDE(
      post('/api/invoices/i1/discount-approval', { decision: 'APPROVE' }),
      params('i1')
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.invoice.update).mock.calls[0][0].data).toMatchObject({
      discountApprovalStatus: 'APPROVED',
      discountApprovedById: 'manager-1',
    })
  })

  // The separation FR-013 is asking for. Holding the capability is not enough
  // if you are the person who asked for the discount.
  it('refuses approval by the person who requested it', async () => {
    signedInAs('ADMIN', 'reception-1')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(PENDING_INVOICE as never)

    const res = await DECIDE(
      post('/api/invoices/i1/discount-approval', { decision: 'APPROVE' }),
      params('i1')
    )

    expect(res.status).toBe(403)
    expect(prisma.invoice.update).not.toHaveBeenCalled()
  })

  it('is refused to reception, who do not hold billing:discount', async () => {
    signedInAs('RECEPTIONIST')
    expect(
      (
        await DECIDE(
          post('/api/invoices/i1/discount-approval', { decision: 'APPROVE' }),
          params('i1')
        )
      ).status
    ).toBe(403)
  })

  // The accountant raises invoices but is deliberately not a discount approver.
  it('is refused to the accountant', async () => {
    signedInAs('ACCOUNTANT')
    expect(
      (
        await DECIDE(
          post('/api/invoices/i1/discount-approval', { decision: 'APPROVE' }),
          params('i1')
        )
      ).status
    ).toBe(403)
  })

  it('requires a note when rejecting', async () => {
    signedInAs('ADMIN', 'admin-1')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(PENDING_INVOICE as never)

    const res = await DECIDE(
      post('/api/invoices/i1/discount-approval', { decision: 'REJECT' }),
      params('i1')
    )
    expect(res.status).toBe(400)
    expect(prisma.invoice.update).not.toHaveBeenCalled()
  })

  it('records a rejection with its note', async () => {
    signedInAs('ADMIN', 'admin-1')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(PENDING_INVOICE as never)

    await DECIDE(
      post('/api/invoices/i1/discount-approval', {
        decision: 'REJECT',
        note: 'Outside the agreed schedule',
      }),
      params('i1')
    )

    expect(vi.mocked(prisma.invoice.update).mock.calls[0][0].data).toMatchObject({
      discountApprovalStatus: 'REJECTED',
      discountDecisionNote: 'Outside the agreed schedule',
    })
  })

  it('refuses to decide twice', async () => {
    signedInAs('ADMIN', 'admin-1')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...PENDING_INVOICE,
      discountApprovalStatus: 'APPROVED',
    } as never)

    const res = await DECIDE(
      post('/api/invoices/i1/discount-approval', { decision: 'REJECT', note: 'changed my mind' }),
      params('i1')
    )
    expect(res.status).toBe(409)
    expect(prisma.invoice.update).not.toHaveBeenCalled()
  })

  it('refuses on an invoice with no discount to decide', async () => {
    signedInAs('ADMIN', 'admin-1')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...PENDING_INVOICE,
      discountApprovalStatus: 'NOT_REQUIRED',
    } as never)

    expect(
      (
        await DECIDE(
          post('/api/invoices/i1/discount-approval', { decision: 'APPROVE' }),
          params('i1')
        )
      ).status
    ).toBe(409)
  })

  it('404s for an invoice belonging to another clinic', async () => {
    signedInAs('ADMIN', 'admin-1')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never)

    expect(
      (
        await DECIDE(
          post('/api/invoices/i9/discount-approval', { decision: 'APPROVE' }),
          params('i9')
        )
      ).status
    ).toBe(404)
  })
})
