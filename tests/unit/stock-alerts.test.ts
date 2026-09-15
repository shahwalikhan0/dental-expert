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

import {
  expiryFor,
  reconcileExpiryAlerts,
  reconcileStockAlerts,
  shortageFor,
} from '@/lib/stock-alerts'
import { prisma } from '@/lib/prisma'
import { StockAlertType } from '@prisma/client'

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

// ---------------------------------------------------------------------------
// Expiry (FR-016)
// ---------------------------------------------------------------------------

describe('expiryFor', () => {
  const AT = new Date('2026-09-15T00:00:00Z')
  const on = (iso: string, remainingQty = 10) => ({ expiryDate: new Date(iso), remainingQty })

  it('says nothing about a batch with no expiry date', () => {
    expect(expiryFor({ expiryDate: null, remainingQty: 10 }, AT)).toBeNull()
  })

  it('says nothing about an empty batch', () => {
    // Expiry is about stock the clinic still has and is about to lose. A batch
    // with nothing left in it is neither.
    expect(expiryFor(on('2026-09-01', 0), AT)).toBeNull()
    expect(expiryFor(on('2026-09-20', 0), AT)).toBeNull()
  })

  it('calls a past date expired', () => {
    expect(expiryFor(on('2026-09-01'), AT)).toBe(StockAlertType.EXPIRED)
  })

  it('calls the day itself expired', () => {
    // A cartridge dated the 15th is not to be used on the 15th.
    expect(expiryFor(on('2026-09-15'), AT)).toBe(StockAlertType.EXPIRED)
  })

  it('warns inside the window', () => {
    expect(expiryFor(on('2026-09-30'), AT)).toBe(StockAlertType.EXPIRING_SOON)
  })

  it('warns on the last day of the window', () => {
    expect(expiryFor(on('2026-10-15'), AT)).toBe(StockAlertType.EXPIRING_SOON)
  })

  it('says nothing beyond the window', () => {
    expect(expiryFor(on('2026-10-16'), AT)).toBeNull()
  })

  it('takes the clinic own window', () => {
    // A practice that orders monthly wants more notice than one with a
    // supplier down the road.
    expect(expiryFor(on('2026-11-30'), AT, 90)).toBe(StockAlertType.EXPIRING_SOON)
    expect(expiryFor(on('2026-09-30'), AT, 7)).toBeNull()
  })
})

describe('reconcileExpiryAlerts', () => {
  const AT = new Date('2026-09-15T00:00:00Z')

  function db(batches: any[], open: any[] = []) {
    return {
      inventoryBatch: { findMany: vi.fn().mockResolvedValue(batches) },
      stockAlert: {
        findMany: vi.fn().mockResolvedValue(open),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as any
  }

  const batch = (over: Record<string, unknown> = {}) => ({
    id: 'b1',
    itemId: 'i1',
    expiryDate: new Date('2026-09-20'),
    remainingQty: 10,
    ...over,
  })

  it('raises an alert against the batch, not just the item', async () => {
    const client = db([batch()])

    const sweep = await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(sweep).toMatchObject({ raised: 1, cleared: 0, checked: 1 })
    expect(client.stockAlert.create).toHaveBeenCalledWith({
      data: {
        hospitalId: 'h1',
        itemId: 'i1',
        batchId: 'b1',
        alertType: StockAlertType.EXPIRING_SOON,
      },
    })
  })

  it('does not raise the same alert twice', async () => {
    // The sweep runs daily; the second run must be quiet.
    const client = db(
      [batch()],
      [{ id: 'a1', batchId: 'b1', alertType: StockAlertType.EXPIRING_SOON, isAcknowledged: false }]
    )

    const sweep = await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(sweep).toMatchObject({ raised: 0, cleared: 0 })
    expect(client.stockAlert.create).not.toHaveBeenCalled()
  })

  it('upgrades a warning to expired when the date passes', async () => {
    const client = db(
      [batch({ expiryDate: new Date('2026-09-10') })],
      [{ id: 'a1', batchId: 'b1', alertType: StockAlertType.EXPIRING_SOON, isAcknowledged: false }]
    )

    await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(client.stockAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ alertType: StockAlertType.EXPIRED }),
      })
    )
    expect(client.stockAlert.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a1'] } } })
  })

  it('clears the alert when the batch is used up', async () => {
    const client = db(
      [batch({ remainingQty: 0 })],
      [{ id: 'a1', batchId: 'b1', alertType: StockAlertType.EXPIRING_SOON, isAcknowledged: false }]
    )

    const sweep = await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(sweep).toMatchObject({ raised: 0, cleared: 1 })
    expect(client.stockAlert.create).not.toHaveBeenCalled()
  })

  it('clears an alert whose batch has gone', async () => {
    const client = db(
      [],
      [{ id: 'a1', batchId: 'gone', alertType: StockAlertType.EXPIRED, isAcknowledged: false }]
    )

    const sweep = await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(sweep).toMatchObject({ cleared: 1 })
  })

  it('does not raise again what somebody has acknowledged', async () => {
    // The batch is still expired tomorrow morning. A sweep that ignored the
    // acknowledgement would raise the same alert every day and the button
    // would mean nothing.
    const client = db(
      [batch({ expiryDate: new Date('2026-09-10') })],
      [{ id: 'a1', batchId: 'b1', alertType: StockAlertType.EXPIRED, isAcknowledged: true }]
    )

    const sweep = await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(sweep).toMatchObject({ raised: 0, cleared: 0 })
    expect(client.stockAlert.create).not.toHaveBeenCalled()
    expect(client.stockAlert.deleteMany).not.toHaveBeenCalled()
  })

  it('raises again when a warning becomes an expiry, acknowledged or not', async () => {
    // A different and worse fact than the one that was acknowledged.
    const client = db(
      [batch({ expiryDate: new Date('2026-09-10') })],
      [{ id: 'a1', batchId: 'b1', alertType: StockAlertType.EXPIRING_SOON, isAcknowledged: true }]
    )

    const sweep = await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(sweep).toMatchObject({ raised: 1 })
    // The acknowledged warning is a record of what somebody did; it stays.
    expect(client.stockAlert.deleteMany).not.toHaveBeenCalled()
  })

  it('never deletes an acknowledged alert, even when its batch is used up', async () => {
    const client = db(
      [batch({ remainingQty: 0 })],
      [{ id: 'a1', batchId: 'b1', alertType: StockAlertType.EXPIRING_SOON, isAcknowledged: true }]
    )

    const sweep = await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(sweep).toMatchObject({ cleared: 0 })
  })

  it('reads acknowledged alerts as well, so it can see what was dealt with', async () => {
    const client = db([batch()])

    await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    const where = client.stockAlert.findMany.mock.calls[0][0].where
    expect(where.hospitalId).toBe('h1')
    expect(where).not.toHaveProperty('isAcknowledged')
  })

  it('looks only at batches of items that are still in the catalogue', async () => {
    const client = db([])

    await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    expect(client.inventoryBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hospitalId: 'h1', item: { deletedAt: null } }),
      })
    )
  })

  it('leaves shortage alerts alone', async () => {
    // Two kinds of alert live in one table, and a sweep of one must not touch
    // the other.
    const client = db([batch({ expiryDate: new Date('2027-01-01') })])

    await reconcileExpiryAlerts(client, { hospitalId: 'h1', at: AT })

    const where = client.stockAlert.findMany.mock.calls[0][0].where
    expect(where.alertType.in).toEqual([StockAlertType.EXPIRING_SOON, StockAlertType.EXPIRED])
  })
})
