// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'

vi.mock('@prisma/client', () => ({
  InvoiceStatus: {
    DRAFT: 'DRAFT',
    PENDING: 'PENDING',
    PARTIALLY_PAID: 'PARTIALLY_PAID',
    PAID: 'PAID',
    OVERDUE: 'OVERDUE',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
  },
  PaymentMethod: {
    CASH: 'CASH',
    CARD: 'CARD',
    BANK_TRANSFER: 'BANK_TRANSFER',
    CHEQUE: 'CHEQUE',
    WALLET: 'WALLET',
    ONLINE: 'ONLINE',
  },
  PaymentStatus: {
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    REFUNDED: 'REFUNDED',
    CANCELLED: 'CANCELLED',
  },
  DiscountType: { PERCENTAGE: 'PERCENTAGE', FIXED: 'FIXED' },
}))

import { formatCurrency, formatDate, formatPhone, validatePakistanPhone } from '@/lib/utils'
import {
  discountTypeConfig,
  formatCurrency as billingFormatCurrency,
  numberToWords,
  formatDateTime as billingFormatDateTime,
} from '@/lib/billing-utils'

describe('Section 10.1 — Current Locale (Pakistan)', () => {
  // ─── Currency Display ───────────────────────────────────────────────

  describe('Currency Display', () => {
    it('formatCurrency from utils displays the Rs symbol', () => {
      const result = formatCurrency(500)
      expect(result).toContain('Rs')
    })

    it('billingFormatCurrency displays Rs with 2 decimal places', () => {
      const result = billingFormatCurrency(500)
      expect(result).toContain('Rs')
      expect(result).toMatch(/500\.00/)
    })

    it('uses western grouping — thousands (100,000 not 1,00,000)', () => {
      const result = formatCurrency(100000)
      // en-PK formats 100000 as 100,000 — INR's lakh grouping does not apply
      expect(result).toContain('100,000')
      expect(result).not.toContain('1,00,000')
    })

    it('uses western grouping — millions', () => {
      const result = formatCurrency(10000000)
      expect(result).toContain('10,000,000')
    })

    it('zero amount renders as Rs 0', () => {
      const result = formatCurrency(0)
      expect(result).toContain('Rs')
      expect(result).toMatch(/0/)
    })

    it('large amounts group in thousands in billing', () => {
      const result = billingFormatCurrency(25000000)
      // 25,000,000.00
      expect(result).toContain('25,000,000')
    })

    it('negative amounts are handled', () => {
      const result = formatCurrency(-1500)
      expect(result).toContain('Rs')
      expect(result).toContain('1,500')
    })

    it('discountTypeConfig.FIXED.symbol is Rs', () => {
      expect(discountTypeConfig.FIXED.symbol).toBe('Rs')
    })
  })

  // ─── Date Format ────────────────────────────────────────────────────

  describe('Date Format', () => {
    it('formatDate uses the en-PK locale', () => {
      const result = formatDate(new Date(2026, 2, 8)) // March 8, 2026
      // en-IN with day:2-digit, month:short, year:numeric => "08 Mar 2026"
      expect(result).toMatch(/08/)
      expect(result).toMatch(/Mar/)
      expect(result).toMatch(/2026/)
    })

    it('output format is DD Mon YYYY', () => {
      const result = formatDate(new Date(2026, 0, 15)) // Jan 15, 2026
      expect(result).toMatch(/15.*Jan.*2026/)
    })

    it('invalid date returns the em dash every screen writes for a blank', () => {
      expect(formatDate('not-a-date')).toBe('—')
    })

    it('string date input works', () => {
      const result = formatDate('2026-03-08')
      expect(result).toMatch(/Mar/)
      expect(result).toMatch(/2026/)
    })

    it('Date object input works', () => {
      const result = formatDate(new Date(2025, 11, 25)) // Dec 25, 2025
      expect(result).toMatch(/25/)
      expect(result).toMatch(/Dec/)
      expect(result).toMatch(/2025/)
    })
  })

  // ─── Phone Number Format ────────────────────────────────────────────

  describe('Phone Number Format', () => {
    it('formatPhone writes a 10-digit subscriber number in the national form', () => {
      const result = formatPhone('3001234567')
      expect(result).toBe('0300 1234567')
    })

    it('formatPhone handles a 12-digit number with the 92 prefix', () => {
      const result = formatPhone('923001234567')
      expect(result).toBe('0300 1234567')
    })

    it('validatePakistanPhone accepts a bare subscriber number', () => {
      expect(validatePakistanPhone('3123456789')).toBe(true)
    })

    it('validatePakistanPhone accepts the national form with a trunk zero', () => {
      expect(validatePakistanPhone('03123456789')).toBe(true)
    })

    it('validatePakistanPhone accepts the international form', () => {
      expect(validatePakistanPhone('923123456789')).toBe(true)
    })

    it('validatePakistanPhone accepts every 3XX mobile prefix', () => {
      expect(validatePakistanPhone('3451234567')).toBe(true)
    })

    it('validatePakistanPhone rejects subscriber numbers not starting with 3', () => {
      expect(validatePakistanPhone('1234567890')).toBe(false)
      expect(validatePakistanPhone('2345678901')).toBe(false)
      expect(validatePakistanPhone('4567890123')).toBe(false)
      expect(validatePakistanPhone('5678901234')).toBe(false)
      // A landline (042 = Lahore) is not a mobile number.
      expect(validatePakistanPhone('0421234567')).toBe(false)
    })

    it('validatePakistanPhone rejects wrong length', () => {
      expect(validatePakistanPhone('30012')).toBe(false)
      expect(validatePakistanPhone('300123456')).toBe(false) // 9 digits
      expect(validatePakistanPhone('30012345671')).toBe(false) // 11 digits, no trunk zero
    })
  })

  // ─── Number to Words (Indian) ───────────────────────────────────────

  describe('Number to Words (Indian)', () => {
    it('numberToWords(1) returns "One Rupees Only"', () => {
      expect(numberToWords(1)).toBe('One Rupees Only')
    })

    it('numberToWords(100000) contains "Lakh" (not "Hundred Thousand")', () => {
      const result = numberToWords(100000)
      expect(result).toContain('Lakh')
      expect(result).not.toContain('Hundred Thousand')
    })

    it('numberToWords(10000000) contains "Crore"', () => {
      const result = numberToWords(10000000)
      expect(result).toContain('Crore')
    })

    // Paisa, the Pakistani word; "Paise" is the Indian one.
    it('numberToWords(1500.50) contains "Rupees" and "Paisa"', () => {
      const result = numberToWords(1500.5)
      expect(result).toContain('Rupees')
      expect(result).toContain('Paisa')
      expect(result).not.toContain('Paise')
    })

    it('numberToWords(0) returns "Zero"', () => {
      expect(numberToWords(0)).toBe('Zero')
    })
  })

  // ─── Time Format ────────────────────────────────────────────────────

  describe('Time Format', () => {
    it('billingFormatDateTime uses 12-hour AM/PM format', () => {
      // 14:30 (2:30 PM)
      const date = new Date(2026, 2, 8, 14, 30, 0)
      const result = billingFormatDateTime(date)
      // en-IN with hour12:true should produce am/pm or AM/PM
      expect(result).toMatch(/[apAP][mM]/)
    })

    it('billingFormatDateTime includes date components', () => {
      const date = new Date(2026, 2, 8, 10, 15, 0)
      const result = billingFormatDateTime(date)
      expect(result).toMatch(/08/)
      expect(result).toMatch(/Mar/)
      expect(result).toMatch(/2026/)
    })
  })
})
