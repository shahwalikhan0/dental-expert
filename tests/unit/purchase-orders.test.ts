/**
 * Purchase order arithmetic and the rules receipt turns on.
 *
 * Receipt is the part worth testing hardest: it moves stock, and a wrong
 * quantity is not discovered until somebody counts the shelf.
 */
import { describe, it, expect } from 'vitest'
import { PurchaseOrderStatus } from '@prisma/client'
import {
  canReceive,
  checkReceipt,
  expectedDateRefusal,
  isEditable,
  isExpired,
  orderTotals,
  receiptStatusFor,
} from '@/lib/purchase-orders'
import type { OrderedLine } from '@/lib/purchase-orders'

function line(overrides: Partial<OrderedLine> = {}): OrderedLine {
  return {
    id: 'line-1',
    itemId: 'item-1',
    itemName: 'Latex gloves',
    quantity: 10,
    receivedQty: 0,
    batchTracking: false,
    expiryTracking: false,
    ...overrides,
  }
}

describe('orderTotals', () => {
  it('sums line amounts', () => {
    const totals = orderTotals([
      { quantity: 10, unitPrice: 250 },
      { quantity: 3, unitPrice: 1200 },
    ])

    expect(totals.subtotal).toBe(6100)
    expect(totals.taxAmount).toBe(0)
    expect(totals.totalAmount).toBe(6100)
  })

  it('taxes each line at its own rate rather than the order at one rate', () => {
    // A delivery of zero-rated gloves and taxable equipment. One rate applied
    // to the subtotal would overcharge the gloves and undercharge the chair.
    const totals = orderTotals([
      { quantity: 10, unitPrice: 100, taxPercentage: 0 },
      { quantity: 1, unitPrice: 1000, taxPercentage: 17 },
    ])

    expect(totals.subtotal).toBe(2000)
    expect(totals.taxAmount).toBe(170)
    expect(totals.totalAmount).toBe(2170)
  })

  it('rounds each line before summing, so the total matches the printed lines', () => {
    const totals = orderTotals([
      { quantity: 3, unitPrice: 33.333 },
      { quantity: 3, unitPrice: 33.333 },
    ])

    // 99.999 rounds to 100.00 per line; a reader adding the two printed
    // amounts gets 200.00, and so does the total.
    expect(totals.lines.map((l) => l.amount)).toEqual([100, 100])
    expect(totals.totalAmount).toBe(200)
  })

  it('treats a missing tax rate as untaxed', () => {
    expect(orderTotals([{ quantity: 1, unitPrice: 100, taxPercentage: null }]).taxAmount).toBe(0)
  })
})

describe('isEditable / canReceive', () => {
  it('only a draft can be edited', () => {
    expect(isEditable(PurchaseOrderStatus.DRAFT)).toBe(true)
    expect(isEditable(PurchaseOrderStatus.ORDERED)).toBe(false)
  })

  it('a draft cannot receive goods', () => {
    // Stock arriving against an order nobody placed came from somewhere else,
    // and that is an adjustment with its own reason.
    expect(canReceive(PurchaseOrderStatus.DRAFT)).toBe(false)
  })

  it('a placed or part-received order can receive', () => {
    expect(canReceive(PurchaseOrderStatus.ORDERED)).toBe(true)
    expect(canReceive(PurchaseOrderStatus.PARTIALLY_RECEIVED)).toBe(true)
  })

  it('a completed or cancelled order cannot', () => {
    expect(canReceive(PurchaseOrderStatus.RECEIVED)).toBe(false)
    expect(canReceive(PurchaseOrderStatus.CANCELLED)).toBe(false)
  })
})

describe('receiptStatusFor', () => {
  const ORDERED = PurchaseOrderStatus.ORDERED

  it('closes the order when every line is complete', () => {
    expect(
      receiptStatusFor(
        [
          { quantity: 10, receivedQty: 10 },
          { quantity: 5, receivedQty: 5 },
        ],
        ORDERED
      )
    ).toBe(PurchaseOrderStatus.RECEIVED)
  })

  it('is partial while anything is outstanding', () => {
    expect(
      receiptStatusFor(
        [
          { quantity: 10, receivedQty: 10 },
          { quantity: 5, receivedQty: 0 },
        ],
        ORDERED
      )
    ).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED)
  })

  it('leaves an order alone when nothing has arrived', () => {
    expect(receiptStatusFor([{ quantity: 10, receivedQty: 0 }], ORDERED)).toBe(ORDERED)
  })

  it('closes on over-receipt rather than staying open forever', () => {
    // The route refuses over-receipt, but an order amended downwards after a
    // delivery would leave receivedQty above quantity, and that order is done.
    expect(receiptStatusFor([{ quantity: 10, receivedQty: 12 }], ORDERED)).toBe(
      PurchaseOrderStatus.RECEIVED
    )
  })
})

describe('checkReceipt', () => {
  it('accepts a straightforward delivery', () => {
    expect(checkReceipt([line()], [{ lineId: 'line-1', quantity: 10 }])).toEqual({ ok: true })
  })

  it('accepts a part delivery', () => {
    expect(checkReceipt([line()], [{ lineId: 'line-1', quantity: 4 }])).toEqual({ ok: true })
  })

  it('refuses an empty receipt', () => {
    expect(checkReceipt([line()], [])).toMatchObject({ ok: false })
  })

  it('refuses a line that is not on the order', () => {
    const result = checkReceipt([line()], [{ lineId: 'other', quantity: 1 }])
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses the same line twice in one receipt', () => {
    const result = checkReceipt(
      [line()],
      [
        { lineId: 'line-1', quantity: 2 },
        { lineId: 'line-1', quantity: 3 },
      ]
    )
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('twice')
  })

  it('refuses a fractional or negative quantity', () => {
    expect(checkReceipt([line()], [{ lineId: 'line-1', quantity: 2.5 }])).toMatchObject({
      ok: false,
    })
    expect(checkReceipt([line()], [{ lineId: 'line-1', quantity: -1 }])).toMatchObject({
      ok: false,
    })
  })

  it('refuses more than is outstanding, and says what to do instead', () => {
    const result = checkReceipt(
      [line({ quantity: 10, receivedQty: 8 })],
      [{ lineId: 'line-1', quantity: 5 }]
    )

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.error).toContain('only 2 outstanding')
      expect(result.error).toContain('Amend the order quantity')
    }
  })

  it('counts what has already arrived when deciding what is outstanding', () => {
    expect(
      checkReceipt([line({ quantity: 10, receivedQty: 8 })], [{ lineId: 'line-1', quantity: 2 }])
    ).toEqual({ ok: true })
  })

  it('requires a batch number for a batch-tracked item', () => {
    const result = checkReceipt(
      [line({ batchTracking: true })],
      [{ lineId: 'line-1', quantity: 10 }]
    )
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('batch number')
  })

  it('requires an expiry date for an expiry-tracked item', () => {
    // This is the rule FR-016 rests on: an alert about stock going out of date
    // needs a date, and the only moment it is knowable is at the door.
    const result = checkReceipt(
      [line({ batchTracking: true, expiryTracking: true })],
      [{ lineId: 'line-1', quantity: 10, batchNumber: 'B-1' }]
    )
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('expiry date')
  })

  it('refuses an expiry date with nothing to hang it on', () => {
    const result = checkReceipt(
      [line()],
      [{ lineId: 'line-1', quantity: 10, expiryDate: '2027-01-01' }]
    )
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('no batch number')
  })

  it('lets an untracked item through without either', () => {
    expect(checkReceipt([line()], [{ lineId: 'line-1', quantity: 10 }])).toEqual({ ok: true })
  })

  it('names the item in every refusal, not the line id', () => {
    const result = checkReceipt(
      [line({ batchTracking: true })],
      [{ lineId: 'line-1', quantity: 10 }]
    )
    if (!result.ok) expect(result.error).toContain('Latex gloves')
  })
})

/**
 * Finding 43: fifty lignocaine cartridges were received into a batch that had
 * expired on 1 January 2025.
 */
describe('receiving expired stock', () => {
  const AT = new Date('2026-10-12T10:00:00Z')
  const tracked = line({ batchTracking: true, expiryTracking: true })

  it('refuses an expiry date that has passed', () => {
    const result = checkReceipt(
      [tracked],
      [{ lineId: 'line-1', quantity: 10, batchNumber: 'LIG-OLD', expiryDate: '2025-01-01' }],
      AT
    )
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('LIG-OLD expired')
  })

  it('refuses an expiry date of today', () => {
    const result = checkReceipt(
      [tracked],
      [{ lineId: 'line-1', quantity: 10, batchNumber: 'B-1', expiryDate: '2026-10-12' }],
      AT
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses an expiry date that is not a date', () => {
    const result = checkReceipt(
      [tracked],
      [{ lineId: 'line-1', quantity: 10, batchNumber: 'B-1', expiryDate: 'soon' }],
      AT
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('accepts a date still ahead', () => {
    expect(
      checkReceipt(
        [tracked],
        [{ lineId: 'line-1', quantity: 10, batchNumber: 'B-1', expiryDate: '2027-01-01' }],
        AT
      )
    ).toEqual({ ok: true })
  })

  it('isExpired treats no date as not expired', () => {
    expect(isExpired(null, AT)).toBe(false)
    expect(isExpired(new Date('2025-01-01'), AT)).toBe(true)
  })
})

describe('expectedDateRefusal', () => {
  const TODAY = '2026-10-13'
  const TZ = 'Asia/Karachi'

  it('allows a blank date, today and later', () => {
    expect(expectedDateRefusal(null, TODAY, TZ)).toBeNull()
    expect(expectedDateRefusal('', TODAY, TZ)).toBeNull()
    expect(expectedDateRefusal('2026-10-13', TODAY, TZ)).toBeNull()
    expect(expectedDateRefusal('2026-10-20', TODAY, TZ)).toBeNull()
  })

  it('refuses a date before the order date', () => {
    expect(expectedDateRefusal('2020-01-01', TODAY, TZ)).toMatch(/before the order date/)
    expect(expectedDateRefusal('2026-10-12', TODAY, TZ)).toMatch(/before the order date/)
  })

  it('reads a stored instant in the clinic calendar', () => {
    // 19:30 UTC on the 12th is 00:30 on the 13th in Karachi.
    expect(expectedDateRefusal(new Date('2026-10-12T19:30:00Z'), TODAY, TZ)).toBeNull()
    expect(expectedDateRefusal(new Date('2026-10-12T18:30:00Z'), TODAY, TZ)).not.toBeNull()
  })

  it('refuses something that is not a date', () => {
    expect(expectedDateRefusal('next week', TODAY, TZ)).toBe('The expected date is not a date')
    expect(expectedDateRefusal(42, TODAY, TZ)).toBe('The expected date is not a date')
  })
})
