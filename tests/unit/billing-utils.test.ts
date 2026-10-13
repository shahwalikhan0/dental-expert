import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveTaxRate,
  calculateDiscount,
  calculateInvoiceTotals,
  discountProblem,
  formatCurrency,
  formatDate,
  formatDateTime,
  numberToWords,
  getDateRangeFromPreset,
  getPatientName,
  taxConfig,
} from '@/lib/billing-utils'

describe('Billing Utils - resolveTaxRate', () => {
  it('returns 0 when the clinic has tax switched off', () => {
    expect(resolveTaxRate({ taxEnabled: false, taxRate: 16 })).toBe(0)
  })

  it('returns the rate when tax is switched on', () => {
    expect(resolveTaxRate({ taxEnabled: true, taxRate: 16 })).toBe(16)
  })

  // Prisma hands back Decimal, not number.
  it('accepts a Decimal-like value', () => {
    expect(resolveTaxRate({ taxEnabled: true, taxRate: '16.00' as unknown as number })).toBe(16)
  })

  it('is safe with a missing or malformed clinic', () => {
    expect(resolveTaxRate(null)).toBe(0)
    expect(resolveTaxRate(undefined)).toBe(0)
    expect(resolveTaxRate({})).toBe(0)
    expect(resolveTaxRate({ taxEnabled: true, taxRate: 'abc' as unknown as number })).toBe(0)
    expect(resolveTaxRate({ taxEnabled: true, taxRate: -5 })).toBe(0)
  })
})

describe('Billing Utils - calculateInvoiceTotals', () => {
  it('should calculate totals for taxable items', () => {
    const items = [
      { quantity: 1, unitPrice: 500, taxable: true },
      { quantity: 2, unitPrice: 250, taxable: true },
    ]
    const result = calculateInvoiceTotals(items)

    expect(result.subtotal).toBe(1000)
    expect(result.taxableAmount).toBe(1000)
    expect(result.nonTaxableAmount).toBe(0)
    // Exempt by default, so the total is the subtotal.
    expect(result.taxAmount).toBe(0)
    expect(result.totalAmount).toBe(1000)

    const taxed = calculateInvoiceTotals(items, 'FIXED', 0, 16)
    expect(taxed.taxAmount).toBe(160)
    expect(taxed.totalAmount).toBe(1160)
  })

  it('should calculate totals for mixed taxable/non-taxable items', () => {
    const items = [
      { quantity: 1, unitPrice: 500, taxable: true },
      { quantity: 1, unitPrice: 500, taxable: false },
    ]
    const result = calculateInvoiceTotals(items, 'FIXED', 0, 16)

    expect(result.subtotal).toBe(1000)
    expect(result.taxableAmount).toBe(500)
    expect(result.nonTaxableAmount).toBe(500)
    expect(result.taxAmount).toBe(80) // 16% of the taxable 500 only
    expect(result.totalAmount).toBe(1080)
  })

  it('should apply discount before tax calculation', () => {
    const items = [{ quantity: 1, unitPrice: 1000, taxable: true }]
    const result = calculateInvoiceTotals(items, 'FIXED', 100, 16)

    expect(result.subtotal).toBe(1000)
    expect(result.discountAmount).toBe(100)
    expect(result.taxableAmount).toBe(900)
    expect(result.taxAmount).toBe(144) // 16% of 900, i.e. after the discount
    expect(result.totalAmount).toBe(1044)
  })

  it('should handle empty items array', () => {
    const result = calculateInvoiceTotals([])
    expect(result.subtotal).toBe(0)
    expect(result.totalAmount).toBe(0)
    expect(result.lines).toEqual([])
  })
})

// Invoice review 1.3: each figure was rounded on its own from unrounded
// intermediates, so the printed parts did not add up to the printed total.
describe('Billing Utils - calculateInvoiceTotals rounding', () => {
  /** What the printout shows: subtotal − discount + tax. */
  const printed = (t: ReturnType<typeof calculateInvoiceTotals>) =>
    Math.round((t.subtotal - t.discountAmount + t.taxAmount) * 100) / 100

  it('adds up with tax off: Rs 3,333 at 2.5% off', () => {
    const t = calculateInvoiceTotals(
      [{ quantity: 1, unitPrice: 3333, taxable: true }],
      'PERCENTAGE',
      2.5
    )
    expect(t.discountAmount).toBe(83.33)
    expect(t.totalAmount).toBe(3249.67)
    expect(printed(t)).toBe(t.totalAmount)
  })

  it('adds up with tax on and a mix of taxable and exempt lines', () => {
    const t = calculateInvoiceTotals(
      [
        { quantity: 1, unitPrice: 1250, taxable: true },
        { quantity: 1, unitPrice: 999, taxable: false },
      ],
      'PERCENTAGE',
      12.5,
      16
    )
    expect(t.subtotal).toBe(2249)
    expect(t.discountAmount).toBe(281.13)
    // The taxable share of the discount is rounded, the exempt share takes the
    // remainder, so the two values add back to subtotal − discount.
    expect(t.taxableAmount).toBe(1093.75)
    expect(t.nonTaxableAmount).toBe(874.12)
    expect(Math.round((t.taxableAmount + t.nonTaxableAmount) * 100) / 100).toBe(
      Math.round((t.subtotal - t.discountAmount) * 100) / 100
    )
    expect(t.taxAmount).toBe(175)
    expect(t.totalAmount).toBe(2142.87)
    expect(printed(t)).toBe(t.totalAmount)
  })

  it('rounds the unit price to the paisa and builds the line from it', () => {
    const t = calculateInvoiceTotals([{ quantity: 3, unitPrice: 33.335, taxable: true }])
    expect(t.lines[0].unitPrice).toBe(33.34)
    // 3 × 33.34, the figures printed on the line — not 3 × 33.335.
    expect(t.lines[0].amount).toBe(100.02)
    expect(t.subtotal).toBe(100.02)
  })

  it('makes the subtotal the sum of the stored line amounts', () => {
    const t = calculateInvoiceTotals([
      { quantity: 3, unitPrice: 0.1, taxable: true },
      { quantity: 7, unitPrice: 0.7, taxable: false },
    ])
    expect(t.lines.map((l) => l.amount)).toEqual([0.3, 4.9])
    expect(t.subtotal).toBe(5.2)
  })

  it('clamps a discount to the subtotal, never below zero', () => {
    const items = [{ quantity: 1, unitPrice: 1500, taxable: true }]
    expect(calculateInvoiceTotals(items, 'FIXED', 5000).totalAmount).toBe(0)
    expect(calculateInvoiceTotals(items, 'FIXED', -100).discountAmount).toBe(0)
  })

  it('totals zero for a full discount', () => {
    const t = calculateInvoiceTotals(
      [{ quantity: 2, unitPrice: 750, taxable: true }],
      'PERCENTAGE',
      100,
      16
    )
    expect(t.discountAmount).toBe(1500)
    expect(t.taxAmount).toBe(0)
    expect(t.totalAmount).toBe(0)
  })
})

describe('Billing Utils - formatCurrency', () => {
  it('should format positive amounts in PKR', () => {
    const result = formatCurrency(1234.56)
    expect(result).toContain('1,234.56')
    expect(result).toContain('Rs')
  })

  it('should handle null/undefined', () => {
    // Intl separates the symbol from the amount with a non-breaking space, so
    // match rather than compare against a literal ASCII space.
    expect(formatCurrency(null)).toMatch(/^Rs\s0\.00$/)
    expect(formatCurrency(undefined)).toMatch(/^Rs\s0\.00$/)
  })

  it('should handle string amounts', () => {
    expect(formatCurrency('1234.56')).toContain('1,234.56')
  })

  it('should handle invalid string amounts', () => {
    expect(formatCurrency('invalid')).toMatch(/^Rs\s0\.00$/)
  })

  it('should format zero correctly', () => {
    expect(formatCurrency(0)).toContain('0.00')
  })
})

describe('Billing Utils - formatDate', () => {
  it('should format Date object', () => {
    const result = formatDate(new Date('2024-01-15'))
    expect(result).toContain('15')
    expect(result).toContain('2024')
  })

  it('should format date string', () => {
    const result = formatDate('2024-06-20')
    expect(result).toContain('20')
    expect(result).toContain('2024')
  })

  it('should handle null/undefined', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate(undefined)).toBe('-')
  })
})

describe('Billing Utils - formatDateTime', () => {
  it('should format Date with time', () => {
    const result = formatDateTime(new Date('2024-01-15T14:30:00'))
    expect(result).toContain('15')
    expect(result).toContain('2024')
  })

  it('should handle null/undefined', () => {
    expect(formatDateTime(null)).toBe('-')
    expect(formatDateTime(undefined)).toBe('-')
  })
})

describe('Billing Utils - numberToWords', () => {
  it('should convert zero', () => {
    expect(numberToWords(0)).toBe('Zero')
  })

  it('should convert small numbers', () => {
    expect(numberToWords(5)).toBe('Five Rupees Only')
    expect(numberToWords(15)).toBe('Fifteen Rupees Only')
    expect(numberToWords(99)).toBe('Ninety Nine Rupees Only')
  })

  it('should convert hundreds', () => {
    expect(numberToWords(100)).toBe('One Hundred Rupees Only')
    expect(numberToWords(500)).toBe('Five Hundred Rupees Only')
    expect(numberToWords(999)).toBe('Nine Hundred Ninety Nine Rupees Only')
  })

  it('should convert thousands (Indian format)', () => {
    expect(numberToWords(1000)).toBe('One Thousand Rupees Only')
    expect(numberToWords(50000)).toBe('Fifty Thousand Rupees Only')
  })

  it('should convert lakhs (Indian format)', () => {
    expect(numberToWords(100000)).toBe('One Lakh Rupees Only')
    expect(numberToWords(500000)).toBe('Five Lakh Rupees Only')
  })

  it('should convert crores (Indian format)', () => {
    expect(numberToWords(10000000)).toBe('One Crore Rupees Only')
  })

  it('should handle decimal amounts (paisa)', () => {
    const result = numberToWords(100.5)
    expect(result).toContain('One Hundred Rupees')
    expect(result).toContain('Fifty Paisa')
  })
})

describe('Billing Utils - getDateRangeFromPreset', () => {
  // The ranges are built on the clinic's calendar now. These cases read them
  // back with local getters, so the clinic is put in the zone the tests run
  // in; tests/unit/invoice-figures.test.ts checks a named zone.
  const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T10:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return today range', () => {
    const { startDate, endDate } = getDateRangeFromPreset('today', ZONE)
    expect(startDate.getDate()).toBe(15)
    expect(startDate.getHours()).toBe(0)
    expect(endDate.getDate()).toBe(15)
    expect(endDate.getHours()).toBe(23)
  })

  it('should return yesterday range', () => {
    const { startDate, endDate } = getDateRangeFromPreset('yesterday', ZONE)
    expect(startDate.getDate()).toBe(14)
    expect(endDate.getDate()).toBe(14)
  })

  it('should return this_week range', () => {
    const { startDate, endDate } = getDateRangeFromPreset('this_week', ZONE)
    expect(startDate.getDay()).toBe(0) // Sunday
    expect(endDate.getDate()).toBe(15)
  })

  it('should return this_month range', () => {
    const { startDate, endDate } = getDateRangeFromPreset('this_month', ZONE)
    expect(startDate.getDate()).toBe(1)
    expect(startDate.getMonth()).toBe(5) // June
    expect(endDate.getMonth()).toBe(5)
  })

  it('should return last_month range', () => {
    const { startDate, endDate } = getDateRangeFromPreset('last_month', ZONE)
    expect(startDate.getMonth()).toBe(4) // May
    expect(startDate.getDate()).toBe(1)
    expect(endDate.getMonth()).toBe(4)
    expect(endDate.getDate()).toBe(31)
  })

  it('should return this_year range', () => {
    const { startDate, endDate } = getDateRangeFromPreset('this_year', ZONE)
    expect(startDate.getMonth()).toBe(0) // January
    expect(startDate.getDate()).toBe(1)
    expect(startDate.getFullYear()).toBe(2024)
  })
})

describe('Billing Utils - getPatientName', () => {
  it('should return full name', () => {
    const patient = { firstName: 'John', lastName: 'Doe' }
    expect(getPatientName(patient)).toBe('John Doe')
  })

  it('should handle null patient', () => {
    expect(getPatientName(null)).toBe('Unknown Patient')
  })
})

describe('Billing Utils - taxConfig', () => {
  it('defaults to exempt, with items taxable if a rate is ever set', () => {
    expect(taxConfig.rate).toBe(0)
    expect(taxConfig.label).toBe('Sales Tax')
    expect(taxConfig.defaultTaxable).toBe(true)
  })
})

// Finding 37: a 150% discount, and Rs 5,000 off a Rs 1,500 bill, were both
// accepted and billed at zero. The server refuses them instead.
describe('Billing Utils - discountProblem', () => {
  it('accepts a discount within the bill', () => {
    expect(discountProblem(1500, 'PERCENTAGE', 100)).toBeNull()
    expect(discountProblem(1500, 'PERCENTAGE', 0)).toBeNull()
    expect(discountProblem(1500, 'FIXED', 1500)).toBeNull()
    expect(discountProblem(1500, 'FIXED', undefined)).toBeNull()
  })

  it('refuses a percentage above 100', () => {
    expect(discountProblem(1500, 'PERCENTAGE', 150)).toContain('between 0 and 100')
  })

  it('refuses a fixed discount larger than the bill', () => {
    expect(discountProblem(1500, 'FIXED', 5000)).toContain('more than')
  })

  it('refuses a negative or non-numeric discount', () => {
    expect(discountProblem(1500, 'FIXED', -10)).toBeTruthy()
    expect(discountProblem(1500, 'PERCENTAGE', 'lots')).toBeTruthy()
  })

  it('refuses an unknown discount type', () => {
    expect(discountProblem(1500, 'BOGOF', 10)).toBeTruthy()
  })
})
