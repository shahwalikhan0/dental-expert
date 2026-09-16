/**
 * Reference numbers that two people cannot be given at once.
 *
 * Thirteen generators read the highest existing number and added one. Between
 * the read and the write there is a gap, and two receptionists billing in the
 * same second fall into it: the second write loses to the unique index, and
 * what the cashier sees is a 500 and no invoice.
 */
import { describe, it, expect, vi } from 'vitest'
import { nextInSeries, trailingNumber } from '@/lib/numbering'

function db(seq: number) {
  return { $queryRaw: vi.fn().mockResolvedValue([{ seq }]) } as any
}

describe('nextInSeries', () => {
  it('formats the number with the series prefix and width', async () => {
    expect(await nextInSeries(db(7), { hospitalId: 'h1', prefix: 'INV-202609-', width: 4 })).toBe(
      'INV-202609-0007'
    )
  })

  it('pads to the width the series uses', async () => {
    expect(await nextInSeries(db(42), { hospitalId: 'h1', prefix: 'PAT2609', width: 5 })).toBe(
      'PAT260900042'
    )
  })

  it('does not truncate a number that has outgrown its width', async () => {
    // Better a five-digit number in a four-digit series than a duplicate.
    expect(await nextInSeries(db(12345), { hospitalId: 'h1', prefix: 'APT2026', width: 4 })).toBe(
      'APT202612345'
    )
  })

  it('allocates in one statement, not a read and then a write', async () => {
    const client = db(1)

    await nextInSeries(client, { hospitalId: 'h1', prefix: 'INV-', width: 4 })

    expect(client.$queryRaw).toHaveBeenCalledTimes(1)
    const sql = client.$queryRaw.mock.calls[0][0].join('')
    expect(sql).toContain('ON CONFLICT')
    expect(sql).toContain('DO UPDATE')
  })

  it('asks for the current maximum only to seed a series', async () => {
    // Existing clinics have numbers that predate the counter; starting at 1
    // would collide with every one of them.
    const currentMax = vi.fn().mockResolvedValue(38)
    const client = db(39)

    await nextInSeries(client, { hospitalId: 'h1', prefix: 'INV-', width: 4, currentMax })

    expect(currentMax).toHaveBeenCalled()
    // seed + 2 is the value inserted, so a fresh row hands out seed + 1.
    expect(client.$queryRaw.mock.calls[0].slice(1)).toContain(40)
  })

  it('starts at one with no seed', async () => {
    const client = db(1)

    await nextInSeries(client, { hospitalId: 'h1', prefix: 'INV-', width: 4 })

    expect(client.$queryRaw.mock.calls[0].slice(1)).toContain(2)
  })

  it('keys the counter on the clinic and the series', async () => {
    const client = db(1)

    await nextInSeries(client, { hospitalId: 'h1', prefix: 'INV-202609-', width: 4 })

    const args = client.$queryRaw.mock.calls[0].slice(1)
    expect(args).toContain('h1')
    expect(args).toContain('INV-202609-')
  })
})

describe('trailingNumber', () => {
  it('reads the number off the end of a reference', () => {
    expect(trailingNumber('INV-202609-0042', 4)).toBe(42)
    expect(trailingNumber('PAT260900007', 5)).toBe(7)
  })

  it('is zero when there is nothing to read', () => {
    // A clinic with no invoices yet, and a series that has never been used.
    expect(trailingNumber(null, 4)).toBe(0)
    expect(trailingNumber(undefined, 4)).toBe(0)
    expect(trailingNumber('INV-202609-', 4)).toBe(0)
    expect(trailingNumber('INV-ABCD', 4)).toBe(0)
  })
})
