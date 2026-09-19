import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import { prisma } from '@/lib/prisma'
import { collectionTotals, dayKeyOf } from '@/lib/collections'

/**
 * UAT-11 — "Totals match source transactions".
 *
 * They did not. Every financial report filtered payments on `COMPLETED`, and a
 * refund moves a payment to PARTIALLY_REFUNDED or REFUNDED — so refunding two
 * thousand of a five-thousand payment did not reduce the day's takings by two
 * thousand, it erased all five. The cashier's own till reconciliation had this
 * right the whole time; the management reports it is checked against did not.
 */

const settled = () =>
  expect.objectContaining({
    status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('collectionTotals', () => {
  it('counts a partially refunded payment, net of what went back', async () => {
    ;(prisma.payment.groupBy as any).mockResolvedValue([
      { paymentMethod: 'CASH', _sum: { amount: 5000 }, _count: 1 },
    ])
    ;(prisma.refund.groupBy as any).mockResolvedValue([
      { refundMethod: 'CASH', _sum: { amount: 2000 }, _count: 1 },
    ])

    const totals = await collectionTotals('h1', { gte: new Date(0), lte: new Date() })

    expect(totals.received).toBe(5000)
    expect(totals.refunded).toBe(2000)
    expect(totals.net).toBe(3000)
    expect(totals.paymentCount).toBe(1)
    expect(totals.refundCount).toBe(1)
  })

  it('asks for the settled statuses, not COMPLETED alone', async () => {
    ;(prisma.payment.groupBy as any).mockResolvedValue([])
    ;(prisma.refund.groupBy as any).mockResolvedValue([])

    await collectionTotals('h1', { gte: new Date(0), lte: new Date() })

    expect(prisma.payment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: settled() })
    )
  })

  it('takes a refund off the method the money left by, not the one it arrived by', async () => {
    // A card payment refunded in cash leaves the drawer short; the cash column
    // has to show it.
    ;(prisma.payment.groupBy as any).mockResolvedValue([
      { paymentMethod: 'CARD', _sum: { amount: 4000 }, _count: 1 },
    ])
    ;(prisma.refund.groupBy as any).mockResolvedValue([
      { refundMethod: 'CASH', _sum: { amount: 1000 }, _count: 1 },
    ])

    const totals = await collectionTotals('h1', { gte: new Date(0), lte: new Date() })

    expect(totals.byMethod).toEqual([
      { method: 'CASH', received: 0, refunded: 1000, net: -1000, count: 0 },
      { method: 'CARD', received: 4000, refunded: 0, net: 4000, count: 1 },
    ])
    expect(totals.net).toBe(3000)
  })

  it('never drops a method it does not recognise', async () => {
    // Money vanishing from a report because a constant went stale is the fault
    // this module exists to undo; it must not reintroduce it by another door.
    ;(prisma.payment.groupBy as any).mockResolvedValue([
      { paymentMethod: 'SOMETHING_NEW', _sum: { amount: 7000 }, _count: 2 },
    ])
    ;(prisma.refund.groupBy as any).mockResolvedValue([])

    const totals = await collectionTotals('h1', { gte: new Date(0), lte: new Date() })

    expect(totals.net).toBe(7000)
    expect(totals.byMethod.map((row) => row.method)).toContain('SOMETHING_NEW')
  })

  it('reads an empty period as nothing, not as a failure', async () => {
    ;(prisma.payment.groupBy as any).mockResolvedValue([])
    ;(prisma.refund.groupBy as any).mockResolvedValue([])

    const totals = await collectionTotals('h1', { gte: new Date(0), lte: new Date() })

    expect(totals).toMatchObject({ received: 0, refunded: 0, net: 0, byMethod: [] })
  })

  it('dates refunds by when the money went back', async () => {
    ;(prisma.payment.groupBy as any).mockResolvedValue([])
    ;(prisma.refund.groupBy as any).mockResolvedValue([])

    const window = { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') }
    await collectionTotals('h1', window)

    expect(prisma.refund.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hospitalId: 'h1', refundedAt: window } })
    )
  })
})

describe('dayKeyOf', () => {
  it('puts a late Karachi evening on the clinic’s day, not the following UTC one', () => {
    // 19:30 UTC is 00:30 the next morning in Karachi.
    expect(dayKeyOf(new Date('2026-09-19T19:30:00.000Z'), 'Asia/Karachi')).toBe('2026-09-20')
    expect(dayKeyOf(new Date('2026-09-19T19:30:00.000Z'), 'UTC')).toBe('2026-09-19')
  })

  it('is stable across a day boundary in the other direction', () => {
    expect(dayKeyOf(new Date('2026-09-19T00:30:00.000Z'), 'Asia/Karachi')).toBe('2026-09-19')
  })
})
