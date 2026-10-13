/**
 * The till's pure arithmetic (lib/till.ts) — the figures the Till screen shows
 * while the drawer is being counted, and the rule for which money needs a till
 * open at all (bug report 12 Oct, finding 38).
 *
 * The server's closing uses the same functions, so what the screen previews is
 * what gets stamped.
 */
import { describe, it, expect } from 'vitest'
import {
  NO_OPEN_TILL,
  NO_OPEN_TILL_MESSAGE,
  PAYMENT_METHODS,
  TILL_PATH,
  closedSessionTotals,
  expectedTotals,
  methodsToCount,
  parseCount,
  reconcile,
  refundNeedsOpenTill,
  sumTotals,
  totalVariance,
  varianceKind,
} from '@/lib/till'

const line = (totals: ReturnType<typeof expectedTotals>, method: string) =>
  totals.find((t) => t.paymentMethod === method)!

describe('expectedTotals', () => {
  it('gives a line for every method, in a fixed order', () => {
    expect(expectedTotals([], [], 0).map((t) => t.paymentMethod)).toEqual([...PAYMENT_METHODS])
  })

  it('puts the float on cash alone', () => {
    const totals = expectedTotals([{ method: 'CARD', amount: 3000 }], [], 5000)
    expect(line(totals, 'CASH').expected).toBe(5000)
    expect(line(totals, 'CARD').expected).toBe(3000)
  })

  // Bilal's Rs 4,400, had a till been open: it is what the drawer should hold.
  it('adds every payment of a method together', () => {
    const totals = expectedTotals(
      [
        { method: 'CASH', amount: 4400 },
        { method: 'CASH', amount: 600 },
      ],
      [],
      1000
    )
    expect(line(totals, 'CASH')).toMatchObject({ received: 5000, refunded: 0, expected: 6000 })
  })

  it('takes a refund off the method it was paid out by', () => {
    const totals = expectedTotals(
      [
        { method: 'CASH', amount: 2000 },
        { method: 'CARD', amount: 6000 },
      ],
      [{ method: 'CASH', amount: 1500 }],
      5000
    )
    expect(line(totals, 'CASH').expected).toBe(5500)
    expect(line(totals, 'CARD').expected).toBe(6000)
  })

  it('does not drift in floating point', () => {
    const totals = expectedTotals(
      [
        { method: 'CASH', amount: 0.1 },
        { method: 'CASH', amount: 0.2 },
      ],
      [],
      0
    )
    expect(line(totals, 'CASH').expected).toBe(0.3)
  })

  it('reads amounts that arrive as strings, as Decimals do over JSON', () => {
    const totals = expectedTotals([{ method: 'CASH', amount: '250.50' as never }], [], 0)
    expect(line(totals, 'CASH').expected).toBe(250.5)
  })

  it('treats a missing float as none', () => {
    expect(line(expectedTotals([], [], NaN), 'CASH').expected).toBe(0)
  })
})

describe('sumTotals', () => {
  it('adds up across methods, float included in expected', () => {
    const totals = expectedTotals(
      [
        { method: 'CASH', amount: 2000 },
        { method: 'CARD', amount: 3000 },
      ],
      [{ method: 'CASH', amount: 500 }],
      1000
    )
    expect(sumTotals(totals)).toEqual({ received: 5000, refunded: 500, expected: 5500 })
  })
})

describe('reconcile and totalVariance, as the closing form previews them', () => {
  const totals = expectedTotals([{ method: 'CASH', amount: 4400 }], [], 1000)

  it('is balanced when the count matches', () => {
    const lines = reconcile(totals, [{ paymentMethod: 'CASH', countedAmount: 5400 }])
    expect(totalVariance(lines)).toBe(0)
    expect(varianceKind(totalVariance(lines))).toBe('balanced')
  })

  it('reports a shortfall as negative', () => {
    const lines = reconcile(totals, [{ paymentMethod: 'CASH', countedAmount: 5000 }])
    expect(line(lines, 'CASH')).toMatchObject({ expected: 5400, countedAmount: 5000 })
    expect(lines.find((l) => l.paymentMethod === 'CASH')!.varianceAmount).toBe(-400)
    expect(varianceKind(totalVariance(lines))).toBe('short')
  })

  it('reports an overage as positive', () => {
    const lines = reconcile(totals, [{ paymentMethod: 'CASH', countedAmount: 5450 }])
    expect(totalVariance(lines)).toBe(50)
    expect(varianceKind(50)).toBe('over')
  })
})

describe('varianceKind', () => {
  it('does not call a rounding crumb a variance', () => {
    expect(varianceKind(0.001)).toBe('balanced')
    expect(varianceKind(-0.004)).toBe('balanced')
    expect(varianceKind(-0.01)).toBe('short')
  })
})

describe('methodsToCount', () => {
  it('always asks for cash, even on a day with nothing taken', () => {
    expect(methodsToCount(expectedTotals([], [], 0))).toEqual(['CASH'])
  })

  it('asks for every method that saw money in or out, and no others', () => {
    const totals = expectedTotals(
      [{ method: 'CARD', amount: 3000 }],
      [{ method: 'WALLET', amount: 200 }],
      0
    )
    expect(methodsToCount(totals)).toEqual(['CASH', 'CARD', 'WALLET'])
  })

  // A card payment refunded in full still moved money through the terminal
  // that day; the slip has to be checked even though it nets to zero.
  it('asks for a method whose takings and refunds cancel out', () => {
    const totals = expectedTotals(
      [{ method: 'CARD', amount: 500 }],
      [{ method: 'CARD', amount: 500 }],
      0
    )
    expect(methodsToCount(totals)).toContain('CARD')
  })
})

describe('parseCount', () => {
  it('reads a typed amount', () => {
    expect(parseCount('4400')).toBe(4400)
    expect(parseCount(' 1,250.5 ')).toBe(1250.5)
    expect(parseCount('0')).toBe(0)
  })

  // Blank is "not counted", which the form refuses — not "counted nothing".
  it('reads blank as not counted, not as zero', () => {
    expect(parseCount('')).toBeNull()
    expect(parseCount('   ')).toBeNull()
    expect(parseCount(undefined)).toBeNull()
  })

  it('refuses what is not an amount', () => {
    expect(parseCount('abc')).toBeNull()
    expect(parseCount('-5')).toBeNull()
    expect(parseCount('Infinity')).toBeNull()
  })

  it('rounds to the paisa', () => {
    expect(parseCount('1234.565')).toBe(1234.57)
  })
})

describe('closedSessionTotals', () => {
  it('adds up the stamped rows, which arrive as strings', () => {
    expect(
      closedSessionTotals([
        { expectedAmount: '5400.00', countedAmount: '5000.00', varianceAmount: '-400.00' },
        { expectedAmount: '3000.00', countedAmount: '3000.00', varianceAmount: '0.00' },
      ])
    ).toEqual({ expected: 8400, counted: 8000, variance: -400 })
  })

  it('is all zero for a session with no rows', () => {
    expect(closedSessionTotals([])).toEqual({ expected: 0, counted: 0, variance: 0 })
  })
})

describe('refundNeedsOpenTill', () => {
  // Cash leaves the drawer; with no till it would leave a closing short with
  // nothing on record to explain it.
  it('needs a till for a cash refund', () => {
    expect(refundNeedsOpenTill('CASH')).toBe(true)
  })

  // These are settled by the bank or the terminal, not out of the drawer.
  it('does not hold up a refund that does not touch the drawer', () => {
    for (const method of ['CARD', 'BANK_TRANSFER', 'CHEQUE', 'WALLET', 'ONLINE']) {
      expect(refundNeedsOpenTill(method)).toBe(false)
    }
  })
})

describe('the refusal the screens look for', () => {
  it('names the code and sends the person to the Till screen', () => {
    expect(NO_OPEN_TILL).toBe('NO_OPEN_TILL')
    expect(NO_OPEN_TILL_MESSAGE).toContain('Billing → Till')
    expect(TILL_PATH).toBe('/billing/till')
  })
})
