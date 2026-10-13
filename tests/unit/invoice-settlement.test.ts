/**
 * The one count of what an invoice has been paid (findings 13, 15, 16, 39).
 *
 * Every route that moves money on an invoice ends in `settleInvoice`, so the
 * cases here are the ones that used to go wrong when each route kept its own
 * running total: a duplicate payment refunded, a partial refund, a refund
 * recorded before refunds had rows of their own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import {
  deriveInvoiceStatus,
  netPaid,
  settleInvoice,
  treatmentBillingProblem,
} from '@/lib/invoice-settlement'
import { prisma } from '@/lib/prisma'

describe('netPaid', () => {
  it('counts settled payments less what went back', () => {
    expect(
      netPaid([
        { amount: 3000, status: 'COMPLETED', refunds: [] },
        { amount: 3000, status: 'REFUNDED', refunds: [{ amount: 3000 }] },
        { amount: 1000, status: 'PARTIALLY_REFUNDED', refunds: [{ amount: 400 }] },
      ])
    ).toBe(3600)
  })

  it('ignores money that never arrived', () => {
    expect(
      netPaid([
        { amount: 500, status: 'PENDING' },
        { amount: 500, status: 'FAILED' },
        { amount: 500, status: 'CANCELLED' },
      ])
    ).toBe(0)
  })

  it('reads a legacy refund total when the payment has no refund rows', () => {
    expect(netPaid([{ amount: 2000, status: 'PARTIALLY_REFUNDED', refundAmount: 500 }])).toBe(1500)
  })

  it('never takes back more than the payment', () => {
    expect(netPaid([{ amount: 100, status: 'REFUNDED', refunds: [{ amount: 150 }] }])).toBe(0)
  })
})

describe('deriveInvoiceStatus', () => {
  const at = (status: any, paidAmount: number, refunded = false) =>
    deriveInvoiceStatus({ status, totalAmount: 3000, paidAmount, refunded })

  it('reads PAID, PARTIALLY_PAID and REFUNDED from the money', () => {
    expect(at('PENDING', 3000)).toBe('PAID')
    expect(at('PENDING', 6000)).toBe('PAID')
    expect(at('PENDING', 1000)).toBe('PARTIALLY_PAID')
    expect(at('PAID', 0, true)).toBe('REFUNDED')
  })

  // The state finding 39 left an invoice in: one of two payments refunded.
  it('stays PAID when a duplicate payment is refunded', () => {
    expect(at('PAID', 3000, true)).toBe('PAID')
  })

  // Finding 15: an invoice set PAID by hand with nothing paid.
  it('corrects a PAID invoice with nothing paid', () => {
    expect(at('PAID', 0)).toBe('PENDING')
  })

  it('keeps the decisions a person made about the document', () => {
    expect(at('DRAFT', 0)).toBe('DRAFT')
    expect(at('CANCELLED', 0)).toBe('CANCELLED')
    expect(at('OVERDUE', 0)).toBe('OVERDUE')
  })
})

describe('settleInvoice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes the counted figures onto the invoice', async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      { amount: 3000, status: 'COMPLETED', refunds: [] },
      { amount: 3000, status: 'REFUNDED', refunds: [{ amount: 3000 }] },
    ] as never)

    const result = await settleInvoice(prisma, {
      id: 'inv-4',
      status: 'REFUNDED',
      totalAmount: 3000,
    })

    expect(result).toEqual({ paidAmount: 3000, balanceAmount: 0, status: 'PAID' })
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-4' },
      data: { paidAmount: 3000, balanceAmount: 0, status: 'PAID' },
    })
  })
})

describe('treatmentBillingProblem', () => {
  beforeEach(() => vi.clearAllMocks())

  const args = { hospitalId: 'h1', patientId: 'ahmed', treatmentIds: ['t1'] }

  it('accepts the patient’s own unbilled treatment', async () => {
    vi.mocked(prisma.treatment.findMany).mockResolvedValue([
      { id: 't1', patientId: 'ahmed', treatmentNo: 'TRT-1' },
    ] as never)
    vi.mocked(prisma.invoiceItem.findFirst).mockResolvedValue(null as never)

    await expect(treatmentBillingProblem(prisma, args)).resolves.toBeNull()
  })

  it('refuses another patient’s treatment', async () => {
    vi.mocked(prisma.treatment.findMany).mockResolvedValue([
      { id: 't1', patientId: 'fatima', treatmentNo: 'TRT-3' },
    ] as never)

    await expect(treatmentBillingProblem(prisma, args)).resolves.toContain('another patient')
  })

  it('refuses a treatment from another clinic, which it cannot see', async () => {
    vi.mocked(prisma.treatment.findMany).mockResolvedValue([] as never)
    await expect(treatmentBillingProblem(prisma, args)).resolves.toContain('not found')
  })

  it('refuses one already on a live invoice, ignoring the invoice being edited', async () => {
    vi.mocked(prisma.treatment.findMany).mockResolvedValue([
      { id: 't1', patientId: 'ahmed', treatmentNo: 'TRT-1' },
    ] as never)
    vi.mocked(prisma.invoiceItem.findFirst).mockResolvedValue({
      treatment: { treatmentNo: 'TRT-1' },
      invoice: { invoiceNo: 'INV-202610-0001' },
    } as never)

    await expect(
      treatmentBillingProblem(prisma, { ...args, invoiceId: 'inv-2' })
    ).resolves.toContain('INV-202610-0001')
    expect(vi.mocked(prisma.invoiceItem.findFirst).mock.calls[0][0]).toMatchObject({
      where: {
        treatmentId: { in: ['t1'] },
        invoice: { status: { not: 'CANCELLED' } },
        invoiceId: { not: 'inv-2' },
      },
    })
  })
})
