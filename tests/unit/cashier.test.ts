/**
 * The arithmetic behind FR-015's reconciliation and FR-013's threshold.
 *
 * The interesting cases here are the ones that decide whether a variance is
 * real: a refund paid out by a different method than it came in, an opening
 * float that belongs to cash alone, and a method nobody counted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import {
  PAYMENT_METHODS,
  computeExpectedTotals,
  reconcile,
  round2,
  totalVariance,
  getDiscountApprovalThreshold,
  discountNeedsApproval,
  generateSessionNo,
  generateRefundNo,
  getOpenSession,
  DEFAULT_DISCOUNT_THRESHOLD,
} from '@/lib/cashier'
import { prisma } from '@/lib/prisma'

const SESSION = { id: 's1', openingFloat: 5000 }

function payments(rows: [string, number][]) {
  vi.mocked(prisma.payment.groupBy).mockResolvedValue(
    rows.map(([paymentMethod, amount]) => ({ paymentMethod, _sum: { amount } })) as never
  )
}
function refunds(rows: [string, number][]) {
  vi.mocked(prisma.refund.groupBy).mockResolvedValue(
    rows.map(([refundMethod, amount]) => ({ refundMethod, _sum: { amount } })) as never
  )
}
const find = (totals: Awaited<ReturnType<typeof computeExpectedTotals>>, m: string) =>
  totals.find((t) => t.paymentMethod === m)!

describe('computeExpectedTotals', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a line for every payment method, even unused ones', async () => {
    payments([])
    refunds([])
    const totals = await computeExpectedTotals(SESSION)
    expect(totals.map((t) => t.paymentMethod)).toEqual([...PAYMENT_METHODS])
  })

  // The float is physically in the drawer, so cash must be counted with it.
  it('adds the opening float to cash and nothing else', async () => {
    payments([
      ['CASH', 2000],
      ['CARD', 3000],
    ])
    refunds([])

    const totals = await computeExpectedTotals(SESSION)
    expect(find(totals, 'CASH').expected).toBe(7000)
    expect(find(totals, 'CARD').expected).toBe(3000)
  })

  it('counts an empty till as just the float', async () => {
    payments([])
    refunds([])
    const totals = await computeExpectedTotals(SESSION)
    expect(find(totals, 'CASH').expected).toBe(5000)
    expect(find(totals, 'CARD').expected).toBe(0)
  })

  /**
   * The case that makes this worth testing. A card payment refunded in cash
   * takes money out of the drawer; charging the refund against CARD instead
   * would report a cash shortfall and a card surplus every single time.
   */
  it('subtracts a refund from the method it was paid out by', async () => {
    payments([
      ['CASH', 2000],
      ['CARD', 6000],
    ])
    refunds([['CASH', 1500]]) // refunding a card payment, in cash

    const totals = await computeExpectedTotals(SESSION)
    expect(find(totals, 'CASH').expected).toBe(5500) // 5000 float + 2000 − 1500
    expect(find(totals, 'CARD').expected).toBe(6000) // untouched
    expect(find(totals, 'CASH').refunded).toBe(1500)
  })

  it('reports received and refunded separately from the expected figure', async () => {
    payments([['CASH', 2000]])
    refunds([['CASH', 500]])

    const cash = find(await computeExpectedTotals(SESSION), 'CASH')
    expect(cash).toMatchObject({ received: 2000, refunded: 500, expected: 6500 })
  })

  it('can go negative when refunds exceed takings', async () => {
    payments([['CARD', 100]])
    refunds([['CARD', 400]])

    expect(find(await computeExpectedTotals({ id: 's1', openingFloat: 0 }), 'CARD').expected).toBe(
      -300
    )
  })

  it('only counts settled payments', async () => {
    payments([])
    refunds([])
    await computeExpectedTotals(SESSION)

    const where = vi.mocked(prisma.payment.groupBy).mock.calls[0][0]!.where as any
    expect(where.status.in).toContain('COMPLETED')
    expect(where.status.in).not.toContain('FAILED')
    expect(where.status.in).not.toContain('PENDING')
    expect(where.cashierSessionId).toBe('s1')
  })
})

describe('reconcile', () => {
  const expected = [
    { paymentMethod: 'CASH' as const, received: 2000, refunded: 0, expected: 7000 },
    { paymentMethod: 'CARD' as const, received: 3000, refunded: 0, expected: 3000 },
  ]

  it('reports no variance when the count matches', () => {
    const lines = reconcile(expected, [
      { paymentMethod: 'CASH', countedAmount: 7000 },
      { paymentMethod: 'CARD', countedAmount: 3000 },
    ])
    expect(lines.map((l) => l.varianceAmount)).toEqual([0, 0])
    expect(totalVariance(lines)).toBe(0)
  })

  it('reports a shortfall as a negative variance', () => {
    const lines = reconcile(expected, [
      { paymentMethod: 'CASH', countedAmount: 6800 },
      { paymentMethod: 'CARD', countedAmount: 3000 },
    ])
    expect(lines[0].varianceAmount).toBe(-200)
    expect(totalVariance(lines)).toBe(-200)
  })

  it('reports an overage as a positive variance', () => {
    const lines = reconcile(expected, [{ paymentMethod: 'CASH', countedAmount: 7050 }])
    expect(lines[0].varianceAmount).toBe(50)
  })

  // An uncounted drawer with money expected in it is exactly the discrepancy a
  // closing exists to surface, so it must not be quietly skipped.
  it('treats an uncounted method as zero counted, not as balanced', () => {
    const lines = reconcile(expected, [{ paymentMethod: 'CASH', countedAmount: 7000 }])
    const card = lines.find((l) => l.paymentMethod === 'CARD')!
    expect(card.countedAmount).toBe(0)
    expect(card.varianceAmount).toBe(-3000)
  })

  it('offsetting variances still show per method', () => {
    const lines = reconcile(expected, [
      { paymentMethod: 'CASH', countedAmount: 6900 },
      { paymentMethod: 'CARD', countedAmount: 3100 },
    ])
    expect(lines.map((l) => l.varianceAmount)).toEqual([-100, 100])
    // The total nets to zero, which is why the per-method lines are kept.
    expect(totalVariance(lines)).toBe(0)
  })

  it('carries the counter’s note through', () => {
    const lines = reconcile(expected, [
      { paymentMethod: 'CASH', countedAmount: 6800, notes: 'short, till jammed' },
    ])
    expect(lines[0].notes).toBe('short, till jammed')
  })
})

describe('round2', () => {
  // Floating-point drift is not a cash variance.
  it('does not invent a variance out of binary floating point', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1234.565)).toBe(1234.57)
    expect(round2(-0.1 - 0.2)).toBe(-0.3)
  })
})

describe('getDiscountApprovalThreshold', () => {
  beforeEach(() => vi.clearAllMocks())

  // Deliberately not zero — see the note on DEFAULT_DISCOUNT_THRESHOLD. Small
  // routine discounts go through; material ones need a manager.
  it('defaults to a threshold that lets routine discretion through', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue(null as never)
    await expect(getDiscountApprovalThreshold('h1')).resolves.toBe(DEFAULT_DISCOUNT_THRESHOLD)
    expect(discountNeedsApproval(500, DEFAULT_DISCOUNT_THRESHOLD)).toBe(false)
    expect(discountNeedsApproval(5000, DEFAULT_DISCOUNT_THRESHOLD)).toBe(true)
  })

  it('reads the clinic’s configured threshold', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: '2000' } as never)
    await expect(getDiscountApprovalThreshold('h1')).resolves.toBe(2000)
  })

  // A typo in the settings table must not silently switch the control off.
  it('falls back to the default on a malformed value', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: 'lots' } as never)
    await expect(getDiscountApprovalThreshold('h1')).resolves.toBe(DEFAULT_DISCOUNT_THRESHOLD)
  })

  it('ignores a negative threshold', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: '-500' } as never)
    await expect(getDiscountApprovalThreshold('h1')).resolves.toBe(DEFAULT_DISCOUNT_THRESHOLD)
  })

  // A clinic that genuinely wants every discount seen can still say so.
  it('honours an explicit zero threshold', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: '0' } as never)
    await expect(getDiscountApprovalThreshold('h1')).resolves.toBe(0)
    expect(discountNeedsApproval(1, 0)).toBe(true)
  })
})

describe('discountNeedsApproval', () => {
  it('is strictly above the threshold, not at it', () => {
    expect(discountNeedsApproval(2000, 2000)).toBe(false)
    expect(discountNeedsApproval(2000.01, 2000)).toBe(true)
  })

  it('lets an invoice with no discount through', () => {
    expect(discountNeedsApproval(0, 0)).toBe(false)
  })
})

describe('numbering', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts a new month at 0001', async () => {
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(null as never)
    await expect(generateSessionNo('h1')).resolves.toMatch(/^CS-\d{6}-0001$/)
  })

  it('continues from the last number', async () => {
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue({
      sessionNo: 'CS-202609-0007',
    } as never)
    await expect(generateSessionNo('h1')).resolves.toMatch(/-0008$/)
  })

  it('numbers refunds the same way', async () => {
    vi.mocked(prisma.refund.findFirst).mockResolvedValue({ refundNo: 'REF-202609-0041' } as never)
    await expect(generateRefundNo('h1')).resolves.toMatch(/^REF-\d{6}-0042$/)
  })

  it('scopes numbering to the clinic', async () => {
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(null as never)
    await generateSessionNo('h1')
    expect(
      (vi.mocked(prisma.cashierSession.findFirst).mock.calls[0][0]!.where as any).hospitalId
    ).toBe('h1')
  })
})

describe('getOpenSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('looks only for an open session in this clinic', async () => {
    vi.mocked(prisma.cashierSession.findFirst).mockResolvedValue(null as never)
    await getOpenSession('h1')
    expect(vi.mocked(prisma.cashierSession.findFirst).mock.calls[0][0]).toMatchObject({
      where: { hospitalId: 'h1', status: 'OPEN' },
    })
  })
})
