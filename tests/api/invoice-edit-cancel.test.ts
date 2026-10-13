/**
 * Editing and cancelling an invoice (bug report 12 Oct, findings 14, 15, 17,
 * 18, 24, 37 and 68).
 *
 * What these pin down is what the invoice routes no longer do: take PAID from
 * an edit, take a tax rate from the form, cancel an invoice with money still on
 * it, or delete one outright.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const requireAuthAndRole = vi.fn()
  // The real capability matrix against whatever role the test signs in as.
  const decide = async (perms: string[]) => {
    const res = await requireAuthAndRole()
    if (!res || res.error) return res
    if (!perms.every((p) => can(res.user.role, p))) {
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
  }
})

import { PUT, DELETE } from '@/app/api/invoices/[id]/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function signedInAs(role: string, userId = 'u1') {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: userId, role },
  } as any)
}

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/invoices/i1', {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  })
}

const params = { params: Promise.resolve({ id: 'i1' }) }

const INVOICE = {
  id: 'i1',
  hospitalId: 'h1',
  invoiceNo: 'INV-202610-0007',
  patientId: 'p1',
  status: 'PENDING',
  subtotal: 1500,
  discountType: 'FIXED',
  discountValue: 0,
  discountAmount: 0,
  discountReason: null,
  discountApprovalStatus: 'NOT_REQUIRED',
  taxRate: 0,
  totalAmount: 1500,
  paidAmount: 0,
  balanceAmount: 1500,
  dueDate: null,
  notes: null,
  items: [
    {
      treatmentId: null,
      description: 'Consultation',
      quantity: 1,
      unitPrice: 1500,
      taxable: true,
    },
  ],
  payments: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('ADMIN')
  vi.mocked(prisma.invoice.update).mockImplementation(
    async ({ data }: any) => ({ ...INVOICE, ...data }) as never
  )
  vi.mocked(prisma.setting.findUnique).mockResolvedValue(null as never)
})

describe('PUT /api/invoices/[id]', () => {
  // Finding 15: INV-202610-0007 was set PAID with Rs 750 owed.
  it.each(['PAID', 'PARTIALLY_PAID', 'REFUNDED'])('refuses a manual move to %s', async (status) => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(INVOICE as never)

    const res = await PUT(request('PUT', { status }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('recording payments')
    expect(prisma.invoice.update).not.toHaveBeenCalled()
  })

  it('takes the invoice row lock before reading it', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(INVOICE as never)

    await PUT(request('PUT', { notes: 'Called the patient' }), params)

    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as string[]
    expect(sql.join('')).toContain('FOR UPDATE')
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  // Finding 14: the rate is the one stamped on the invoice.
  it('ignores a tax rate sent with an edit', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      ...INVOICE,
      status: 'DRAFT',
    } as never)

    const res = await PUT(
      request('PUT', {
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 1500 }],
        taxRate: -50,
      }),
      params
    )

    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.invoice.update).mock.calls[0][0].data as any
    // A draft is priced at the clinic's own rate — none, for this clinic —
    // whatever the form sent.
    expect(data.taxRate).toBe(0)
    expect(data.totalAmount).toBe(1500)
  })

  // Finding 37.
  it('refuses a discount above 100% rather than billing zero', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      ...INVOICE,
      status: 'DRAFT',
    } as never)

    const res = await PUT(
      request('PUT', { discountType: 'PERCENTAGE', discountValue: 150 }),
      params
    )

    expect(res.status).toBe(400)
    expect(prisma.invoice.update).not.toHaveBeenCalled()
  })

  // Finding 18: a draft approved at one discount could be edited to another.
  it('sends a changed discount back for approval when reception makes it', async () => {
    signedInAs('RECEPTIONIST', 'desk-1')
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      ...INVOICE,
      status: 'DRAFT',
      subtotal: 25000,
      totalAmount: 25000,
      items: [{ ...INVOICE.items[0], description: 'Crown', unitPrice: 25000 }],
      discountApprovalStatus: 'APPROVED',
      discountAmount: 2500,
      discountValue: 10,
      discountType: 'PERCENTAGE',
    } as never)

    const res = await PUT(
      request('PUT', { discountValue: 40, discountReason: 'Family of staff' }),
      params
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.invoice.update).mock.calls[0][0].data).toMatchObject({
      discountAmount: 10000,
      discountApprovalStatus: 'PENDING',
      discountRequestedById: 'desk-1',
      discountApprovedById: null,
    })
  })

  it('will not issue an invoice whose discount was rejected', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      ...INVOICE,
      status: 'DRAFT',
      discountApprovalStatus: 'REJECTED',
    } as never)

    const res = await PUT(request('PUT', { status: 'PENDING' }), params)

    expect(res.status).toBe(409)
    expect(prisma.invoice.update).not.toHaveBeenCalled()
  })

  it('issues a draft and audits the change', async () => {
    const draft = { ...INVOICE, status: 'DRAFT' }
    // Read under the lock, read again by the issue step, read back at the end.
    vi.mocked(prisma.invoice.findUnique)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce({
        ...INVOICE,
        status: 'PENDING',
        dueDate: new Date('2026-10-14T12:00:00Z'),
      } as never)
    vi.mocked(prisma.payment.findMany).mockResolvedValue([] as never)

    const res = await PUT(request('PUT', { status: 'PENDING' }), params)

    expect(res.status).toBe(200)
    const entry = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data as any
    expect(entry.action).toBe('invoice.updated')
    expect(JSON.parse(entry.oldValues)).toMatchObject({ status: 'DRAFT' })
    expect(JSON.parse(entry.newValues)).toMatchObject({ status: 'PENDING' })
  })

  // Invoice review 2.1 / 2.4: issuing stamps the day, and "Due on receipt"
  // becomes due on that day rather than never.
  it('stamps the issue and defaults the due date to the issue day', async () => {
    const draft = { ...INVOICE, status: 'DRAFT' }
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(draft as never)
    vi.mocked(prisma.payment.findMany).mockResolvedValue([] as never)

    await PUT(request('PUT', { status: 'PENDING' }), params)

    const issued = vi.mocked(prisma.invoice.update).mock.calls[0][0].data as any
    expect(issued.status).toBe('PENDING')
    expect(issued.issuedAt).toBeInstanceOf(Date)
    expect(issued.dueDate).toBeInstanceOf(Date)
  })

  // Invoice review 2.2: a 100% discount is issued straight to PAID.
  it('settles an invoice for nothing as paid when it is issued', async () => {
    const draft = {
      ...INVOICE,
      status: 'DRAFT',
      discountType: 'PERCENTAGE',
      discountValue: 100,
      discountAmount: 1500,
      totalAmount: 0,
    }
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(draft as never)
    vi.mocked(prisma.payment.findMany).mockResolvedValue([] as never)

    await PUT(request('PUT', { status: 'PENDING' }), params)

    const settled = vi.mocked(prisma.invoice.update).mock.calls[1][0].data as any
    expect(settled).toMatchObject({ status: 'PAID', balanceAmount: 0 })
  })

  it('refuses a due date before the day it is issued', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      ...INVOICE,
      status: 'DRAFT',
      dueDate: new Date('2020-01-01T12:00:00Z'),
    } as never)

    const res = await PUT(request('PUT', { status: 'PENDING' }), params)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('before the invoice date')
  })

  // Invoice review 6.2: the API rewrote the lines of an issued invoice.
  it('refuses to change the lines or discount once issued', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(INVOICE as never)

    const lines = await PUT(
      request('PUT', { items: [{ description: 'Consultation', quantity: 1, unitPrice: 100 }] }),
      params
    )
    expect(lines.status).toBe(409)
    const discount = await PUT(request('PUT', { discountValue: 500 }), params)
    expect(discount.status).toBe(409)
    expect(prisma.invoice.update).not.toHaveBeenCalled()
  })

  it('still takes notes on an issued invoice', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(INVOICE as never)

    const res = await PUT(request('PUT', { notes: 'Patient will pay Friday' }), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.invoice.update).mock.calls[0][0].data).toEqual({
      notes: 'Patient will pay Friday',
    })
  })

  // Invoice review 6.1: cancelling through PUT needed only billing:write.
  it.each(['RECEPTIONIST', 'ACCOUNTANT'])(
    'refuses a cancel through PUT to %s, who do not hold billing:void',
    async (role) => {
      signedInAs(role)
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue(INVOICE as never)

      const res = await PUT(request('PUT', { status: 'CANCELLED' }), params)

      expect(res.status).toBe(403)
      expect(prisma.invoice.update).not.toHaveBeenCalled()
    }
  )

  it('lets a clinic manager cancel through PUT', async () => {
    signedInAs('CLINIC_MANAGER')
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(INVOICE as never)

    const res = await PUT(request('PUT', { status: 'CANCELLED' }), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.invoice.update).mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED',
    })
  })
})

describe('DELETE /api/invoices/[id]', () => {
  // Finding 17: INV-202610-0001 was cancelled with Rs 4,800 still paid.
  it('refuses to cancel an invoice with money on it', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      ...INVOICE,
      status: 'PARTIALLY_PAID',
      payments: [{ amount: 4800, status: 'COMPLETED', refunds: [] }],
    } as never)

    const res = await DELETE(request('DELETE'), params)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Refund the payments first')
    expect(prisma.invoice.update).not.toHaveBeenCalled()
  })

  it('cancels once the payments have been refunded', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      ...INVOICE,
      status: 'REFUNDED',
      payments: [{ amount: 4800, status: 'REFUNDED', refunds: [{ amount: 4800 }] }],
    } as never)

    const res = await DELETE(request('DELETE'), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.invoice.update).mock.calls[0][0].data).toEqual({
      status: 'CANCELLED',
    })
  })

  // Finding 68: an unpaid invoice was deleted with its lines, leaving a gap.
  it('cancels an unpaid invoice rather than deleting it, and audits it', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(INVOICE as never)

    const res = await DELETE(request('DELETE'), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.invoice.update).mock.calls[0][0].data).toEqual({
      status: 'CANCELLED',
    })
    expect(prisma.invoice.delete).not.toHaveBeenCalled()
    expect(prisma.invoiceItem.deleteMany).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.auditLog.create).mock.calls[0][0].data).toMatchObject({
      action: 'invoice.cancelled',
      entityId: 'i1',
    })
  })

  it('refuses to cancel twice', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      ...INVOICE,
      status: 'CANCELLED',
    } as never)

    expect((await DELETE(request('DELETE'), params)).status).toBe(409)
  })

  it('is refused to reception, who do not hold billing:void', async () => {
    signedInAs('RECEPTIONIST')
    expect((await DELETE(request('DELETE'), params)).status).toBe(403)
  })

  it('404s for another clinic’s invoice', async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never)
    expect((await DELETE(request('DELETE'), params)).status).toBe(404)
  })
})
