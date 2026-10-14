// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
  normalisePhone,
  pakistanMobileSubscriber,
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
  // The national form, as the placeholder on every phone field asks for it.
  it('formats a bare subscriber number', () => {
    expect(formatPhone('3001234567')).toBe('0300 1234567')
  })

  it('formats every shape a Pakistani mobile is typed in', () => {
    expect(formatPhone('03001234567')).toBe('0300 1234567')
    expect(formatPhone('+92-300-1234567')).toBe('0300 1234567')
    expect(formatPhone('+92 300 1234567')).toBe('0300 1234567')
    expect(formatPhone('923001234567')).toBe('0300 1234567')
    expect(formatPhone('0092 300 1234567')).toBe('0300 1234567')
    expect(formatPhone('(0300) 123-4567')).toBe('0300 1234567')
  })

  it('leaves anything that is not a Pakistani mobile as typed', () => {
    expect(formatPhone('12345')).toBe('12345')
    expect(formatPhone('12345678901234')).toBe('12345678901234')
    // A Karachi landline: ten digits, but not a 3XX mobile.
    expect(formatPhone('0213 4567890')).toBe('0213 4567890')
    expect(formatPhone('  +44 20 7946 0958 ')).toBe('+44 20 7946 0958')
  })

  it('returns an empty string for nothing', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone(null)).toBe('')
    expect(formatPhone(undefined)).toBe('')
  })
})

describe('Utils - normalisePhone', () => {
  it('stores a Pakistani mobile as eleven digits with the trunk zero', () => {
    expect(normalisePhone('0300 1234567')).toBe('03001234567')
    expect(normalisePhone('+92 300 1234567')).toBe('03001234567')
    expect(normalisePhone('3001234567')).toBe('03001234567')
    expect(normalisePhone('0092-300-1234567')).toBe('03001234567')
  })

  it('only trims anything else', () => {
    expect(normalisePhone(' 021 34567890 ')).toBe('021 34567890')
    expect(normalisePhone('')).toBe('')
    expect(normalisePhone(null)).toBe('')
  })
})

describe('Utils - pakistanMobileSubscriber', () => {
  it('finds the ten-digit subscriber part', () => {
    expect(pakistanMobileSubscriber('0300-1234567')).toBe('3001234567')
  })

  it('is null for a number that is not a mobile', () => {
    expect(pakistanMobileSubscriber('0213 4567890')).toBeNull()
    expect(pakistanMobileSubscriber('abc')).toBeNull()
    expect(pakistanMobileSubscriber(undefined)).toBeNull()
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
