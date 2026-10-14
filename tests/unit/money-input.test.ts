import { describe, it, expect } from 'vitest'
import { isInvalidMoney, parseMoney, tidyMoney } from '@/lib/money-input'

describe('parseMoney', () => {
  it('reads the ways people type an amount', () => {
    expect(parseMoney('1500')).toBe(1500)
    expect(parseMoney('1,500')).toBe(1500)
    expect(parseMoney('1,500.50')).toBe(1500.5)
    expect(parseMoney(' 1500.5 ')).toBe(1500.5)
    expect(parseMoney('Rs 1,500')).toBe(1500)
    expect(parseMoney('Rs. 250')).toBe(250)
    expect(parseMoney('PKR 99.99')).toBe(99.99)
    expect(parseMoney('.5')).toBe(0.5)
    expect(parseMoney('0')).toBe(0)
  })

  it('says null — never 0 — for a blank or anything that is not an amount', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('   ')).toBeNull()
    expect(parseMoney(null)).toBeNull()
    expect(parseMoney(undefined)).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('12abc')).toBeNull()
    expect(parseMoney('1e3')).toBeNull()
    expect(parseMoney('1.2.3')).toBeNull()
  })

  it('refuses a negative amount', () => {
    expect(parseMoney('-5')).toBeNull()
    expect(parseMoney(-5)).toBeNull()
  })

  it('refuses more than two decimal places rather than rounding them away', () => {
    expect(parseMoney('10.555')).toBeNull()
    expect(parseMoney('10.55')).toBe(10.55)
  })

  it('passes a number through', () => {
    expect(parseMoney(42)).toBe(42)
    expect(parseMoney(Number.NaN)).toBeNull()
  })
})

describe('isInvalidMoney', () => {
  it('flags typed-and-wrong, not blank', () => {
    expect(isInvalidMoney('')).toBe(false)
    expect(isInvalidMoney(null)).toBe(false)
    expect(isInvalidMoney('12x')).toBe(true)
    expect(isInvalidMoney('1,200')).toBe(false)
  })
})

describe('tidyMoney', () => {
  it('drops grouping and the currency, keeping the digits as typed', () => {
    expect(tidyMoney('Rs 1,500.5')).toBe('1500.5')
    expect(tidyMoney('1500')).toBe('1500')
  })

  it('leaves unreadable text alone so it can be fixed', () => {
    expect(tidyMoney('12x')).toBe('12x')
  })
})
