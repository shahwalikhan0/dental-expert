import { describe, it, expect } from 'vitest'
import { parseCreditLimit, parsePaymentTerms, parseRating } from '@/lib/vendor-fields'
import { negativeField, normaliseSku, ITEM_NUMBER_FIELDS } from '@/lib/inventory-items'

/**
 * Finding 20: the Add Vendor form sent `rating: 0`, the route stored null, and
 * the vendors page crashed calling `.toFixed` on it.
 */
describe('parseRating', () => {
  it('reads zero, blank and null as "not rated"', () => {
    expect(parseRating(0)).toEqual({ ok: true, value: null })
    expect(parseRating('0')).toEqual({ ok: true, value: null })
    expect(parseRating('')).toEqual({ ok: true, value: null })
    expect(parseRating(null)).toEqual({ ok: true, value: null })
  })

  it('leaves an absent rating alone', () => {
    expect(parseRating(undefined)).toEqual({ ok: true, value: undefined })
  })

  it('accepts whole stars from 1 to 5', () => {
    expect(parseRating(4)).toEqual({ ok: true, value: 4 })
    expect(parseRating('5')).toEqual({ ok: true, value: 5 })
  })

  it('refuses fractions and anything out of range', () => {
    expect(parseRating(4.5).ok).toBe(false)
    expect(parseRating(6).ok).toBe(false)
    expect(parseRating(-1).ok).toBe(false)
    expect(parseRating('great').ok).toBe(false)
  })
})

/** Finding 49: `paymentTerms: 30` was a 500 — the column is text. */
describe('parsePaymentTerms', () => {
  it('keeps text, trimmed', () => {
    expect(parsePaymentTerms(' Net 30 ')).toEqual({ ok: true, value: 'Net 30' })
  })

  it('reads a number as days', () => {
    expect(parsePaymentTerms(30)).toEqual({ ok: true, value: 'Net 30' })
  })

  it('refuses anything that is neither', () => {
    expect(parsePaymentTerms({ days: 30 }).ok).toBe(false)
    expect(parsePaymentTerms([30]).ok).toBe(false)
    expect(parsePaymentTerms(-5).ok).toBe(false)
  })

  it('leaves absent terms alone, and stores blank as null', () => {
    expect(parsePaymentTerms(undefined)).toEqual({ ok: true, value: undefined })
    expect(parsePaymentTerms('')).toEqual({ ok: true, value: null })
  })
})

describe('parseCreditLimit', () => {
  it('accepts zero or more, from a form or a number', () => {
    expect(parseCreditLimit('5000')).toEqual({ ok: true, value: 5000 })
    expect(parseCreditLimit(0)).toEqual({ ok: true, value: 0 })
  })

  it('refuses a negative or non-numeric limit', () => {
    expect(parseCreditLimit(-1).ok).toBe(false)
    expect(parseCreditLimit('lots').ok).toBe(false)
  })
})

/** Finding 57: `cmp-a2` beside `CMP-A2`; a price of −5; opening stock of −10. */
describe('inventory item values', () => {
  it('stores one spelling of a SKU', () => {
    expect(normaliseSku(' cmp-a2 ')).toBe('CMP-A2')
    expect(normaliseSku('')).toBeNull()
    expect(normaliseSku(null)).toBeNull()
  })

  it('refuses negative prices and stock', () => {
    expect(negativeField({ purchasePrice: -5 }, ITEM_NUMBER_FIELDS)).toContain('Purchase price')
    expect(negativeField({ currentStock: -10 }, ITEM_NUMBER_FIELDS)).toContain('Opening stock')
  })

  it('refuses fractional stock levels', () => {
    expect(negativeField({ minimumStock: 2.5 }, ITEM_NUMBER_FIELDS)).toContain('whole number')
  })

  it('accepts zero and leaves absent fields to the defaults', () => {
    expect(negativeField({ purchasePrice: 0, currentStock: 0 }, ITEM_NUMBER_FIELDS)).toBeNull()
    expect(negativeField({}, ITEM_NUMBER_FIELDS)).toBeNull()
  })
})
