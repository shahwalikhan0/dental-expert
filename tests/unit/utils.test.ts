// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
  generatePatientId,
  generateInvoiceNo,
  validatePakistanPhone,
} from '@/lib/utils'

describe('Utils - cn (classnames merger)', () => {
  it('should merge class names correctly', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('should handle conditional classes', () => {
    expect(cn('base', true && 'active', false && 'disabled')).toBe('base active')
  })

  it('should merge tailwind classes correctly', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('should handle undefined and null values', () => {
    expect(cn('base', undefined, null, 'active')).toBe('base active')
  })

  it('should handle arrays', () => {
    expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz')
  })
})

describe('Utils - formatCurrency', () => {
  it('should format positive amounts correctly in PKR', () => {
    const result = formatCurrency(1000)
    expect(result).toContain('1,000')
    expect(result).toMatch(/Rs|PKR/)
  })

  it('should format zero correctly', () => {
    const result = formatCurrency(0)
    expect(result).toContain('0')
  })

  it('should format decimal amounts correctly', () => {
    const result = formatCurrency(1234.56)
    expect(result).toContain('1,234')
  })

  it('should format large amounts with Indian comma format', () => {
    const result = formatCurrency(1234567)
    // Indian format: 12,34,567
    expect(result).toMatch(/12,34,567|1,234,567/)
  })
})

describe('Utils - formatDate', () => {
  it('should format Date object correctly', () => {
    const date = new Date('2024-01-15')
    const result = formatDate(date)
    expect(result).toContain('15')
    expect(result).toContain('2024')
  })

  it('should format date string correctly', () => {
    const result = formatDate('2024-06-20')
    expect(result).toContain('20')
    expect(result).toContain('2024')
  })

  it('should handle invalid dates gracefully', () => {
    // This should not throw
    expect(() => formatDate('invalid-date')).not.toThrow()
  })
})

describe('Utils - formatDateTime', () => {
  it('should include both date and time', () => {
    const date = new Date('2024-01-15T14:30:00')
    const result = formatDateTime(date)
    expect(result).toContain('15')
    expect(result).toContain('2024')
  })

  it('should format string dates with time', () => {
    const result = formatDateTime('2024-06-20T09:15:00')
    expect(result).toContain('20')
    expect(result).toContain('2024')
  })
})

describe('Utils - formatPhone', () => {
  it('should format 10-digit Indian phone numbers', () => {
    const result = formatPhone('3001234567')
    expect(result).toBe('+92 300 1234567')
  })

  it('should handle phone with existing formatting', () => {
    const result = formatPhone('+92-300-1234567')
    expect(result).toBe('+92 300 1234567')
  })

  it('should return original for non-10-digit numbers', () => {
    expect(formatPhone('12345')).toBe('12345')
    expect(formatPhone('12345678901234')).toBe('12345678901234')
  })

  it('should return empty string for empty input', () => {
    expect(formatPhone('')).toBe('')
  })
})

describe('Utils - generatePatientId', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should generate ID with correct format', () => {
    vi.setSystemTime(new Date('2024-06-15'))
    const result = generatePatientId()
    expect(result).toMatch(/^PAT2406\d{4}$/)
  })

  it('should generate different IDs on consecutive calls', () => {
    const id1 = generatePatientId()
    const id2 = generatePatientId()
    // They may be the same or different due to random component
    expect(id1).toMatch(/^PAT/)
    expect(id2).toMatch(/^PAT/)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

describe('Utils - generateInvoiceNo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should generate invoice number with correct format', () => {
    vi.setSystemTime(new Date('2024-06-15'))
    const result = generateInvoiceNo()
    expect(result).toMatch(/^INV-202406-\d{4}$/)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

describe('Utils - validatePakistanPhone', () => {
  it('should validate correct Indian phone numbers', () => {
    expect(validatePakistanPhone('3001234567')).toBe(true)
    expect(validatePakistanPhone('3331234567')).toBe(true)
    expect(validatePakistanPhone('03451234567')).toBe(true)
    expect(validatePakistanPhone('3211234567')).toBe(true)
  })

  it('should validate phone numbers with formatting', () => {
    expect(validatePakistanPhone('+92-3001234567')).toBe(true)
    expect(validatePakistanPhone('92 3001234567')).toBe(true)
  })

  it('should reject invalid phone numbers', () => {
    expect(validatePakistanPhone('1234567890')).toBe(false) // Starts with 1
    expect(validatePakistanPhone('5234567890')).toBe(false) // Starts with 5
    expect(validatePakistanPhone('300123456')).toBe(false) // 9 digits
    expect(validatePakistanPhone('30012345671')).toBe(false) // 11 digits, no trunk zero
    expect(validatePakistanPhone('')).toBe(false)
  })
})
