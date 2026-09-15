/**
 * Keeping shortage alerts in step with the stock level.
 *
 * This logic used to exist three times — in the stock-movement route, in the
 * item update route, and in the seed — as three hand-written copies of "find an
 * open alert of this type, create one if there isn't". They had drifted in the
 * way copies do: only one of the three ever *cleared* an alert when the
 * shortage ended.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import { reconcileStockAlerts, shortageFor } from '@/lib/stock-alerts'
import { prisma } from '@/lib/prisma'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.stockAlert.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.stockAlert.create).mockResolvedValue({ id: 'a1' } as never)
})

const item = (currentStock: number, minimumStock: number) => ({
  hospitalId: 'h1',
  itemId: 'i1',
  currentStock,
  minimumStock,
})

describe('shortageFor', () => {
  it('calls nothing above the minimum', () => {
    expect(shortageFor(50, 10)).toBeNull()
  })

  /**
   * `<=`, not `<`. An item sitting exactly on its reorder threshold is the
   * moment to reorder, not the moment before.
   */
  it('raises low stock at the minimum, not one below it', () => {
    expect(shortageFor(11, 10)).toBeNull()
    expect(shortageFor(10, 10)).toBe('LOW_STOCK')
    expect(shortageFor(9, 10)).toBe('LOW_STOCK')
  })

  it('raises out of stock at zero, and below it', () => {
    expect(shortageFor(0, 10)).toBe('OUT_OF_STOCK')
    // Negative stock means the books are wrong, which is worse, not better.
    expect(shortageFor(-3, 10)).toBe('OUT_OF_STOCK')
  })

  it('still raises out of stock for an item with no minimum set', () => {
    expect(shortageFor(0, 0)).toBe('OUT_OF_STOCK')
    expect(shortageFor(1, 0)).toBeNull()
  })
})

describe('reconcileStockAlerts', () => {
  it('raises the alert the stock level warrants', async () => {
    await reconcileStockAlerts(prisma, item(3, 10))

    expect(vi.mocked(prisma.stockAlert.create).mock.calls[0][0].data).toMatchObject({
      hospitalId: 'h1',
      itemId: 'i1',
      alertType: 'LOW_STOCK',
    })
  })

  // Otherwise every stock movement below the threshold raises another one, and
  // the alerts list becomes a list of the same thing.
  it('does not raise a second alert while one is already open', async () => {
    vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue({ id: 'existing' } as never)

    await reconcileStockAlerts(prisma, item(3, 10))

    expect(prisma.stockAlert.create).not.toHaveBeenCalled()
  })

  /**
   * The behaviour two of the three copies were missing. Raising an item's
   * minimum and then lowering it again left a LOW_STOCK alert standing over a
   * full shelf, and the only way to be rid of it was to acknowledge something
   * that was no longer true.
   */
  it('clears the alert when stock recovers', async () => {
    await reconcileStockAlerts(prisma, item(50, 10))

    expect(vi.mocked(prisma.stockAlert.deleteMany).mock.calls[0][0].where).toMatchObject({
      itemId: 'i1',
      alertType: { in: ['OUT_OF_STOCK', 'LOW_STOCK'] },
      isAcknowledged: false,
    })
    expect(prisma.stockAlert.create).not.toHaveBeenCalled()
  })

  // Going from empty to merely low used to leave both alerts showing.
  it('clears the out-of-stock alert when the item goes back to merely low', async () => {
    await reconcileStockAlerts(prisma, item(3, 10))

    expect(vi.mocked(prisma.stockAlert.deleteMany).mock.calls[0][0].where.alertType).toEqual({
      in: ['OUT_OF_STOCK'],
    })
  })

  it('clears the low-stock alert when the item runs out entirely', async () => {
    await reconcileStockAlerts(prisma, item(0, 10))

    expect(vi.mocked(prisma.stockAlert.deleteMany).mock.calls[0][0].where.alertType).toEqual({
      in: ['LOW_STOCK'],
    })
    expect(vi.mocked(prisma.stockAlert.create).mock.calls[0][0].data.alertType).toBe('OUT_OF_STOCK')
  })

  /**
   * An acknowledged alert is a record that somebody dealt with it. Clearing it
   * along with the noise would erase the evidence — and the acknowledgement is
   * the one thing about an alert that cannot be recomputed from stock levels.
   */
  it('never removes an alert somebody has acknowledged', async () => {
    await reconcileStockAlerts(prisma, item(50, 10))

    expect(vi.mocked(prisma.stockAlert.deleteMany).mock.calls[0][0].where.isAcknowledged).toBe(
      false
    )
  })

  it('leaves expiry alerts alone — they are not about the stock level', async () => {
    await reconcileStockAlerts(prisma, item(50, 10))

    const cleared = vi.mocked(prisma.stockAlert.deleteMany).mock.calls[0][0].where.alertType as {
      in: string[]
    }
    expect(cleared.in).not.toContain('EXPIRED')
    expect(cleared.in).not.toContain('EXPIRING_SOON')
  })
})
