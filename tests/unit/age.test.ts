/**
 * Age is computed, not stored.
 *
 * The column it replaces was written once at registration and never updated,
 * so a patient registered at 34 stayed 34 — while the analytics report, which
 * computed it from the date of birth, said 35. Two answers to one question.
 */
import { describe, it, expect } from 'vitest'
import { ageInYears } from '@/lib/age'

const AT = new Date('2026-09-15T12:00:00Z')

describe('ageInYears', () => {
  it('counts whole years', () => {
    expect(ageInYears('1991-03-10', AT)).toBe(35)
  })

  it('does not count a birthday that has not come round yet', () => {
    expect(ageInYears('1991-12-25', AT)).toBe(34)
  })

  it('counts the birthday itself', () => {
    expect(ageInYears('1991-09-15', AT)).toBe(35)
  })

  it('does not count the day before the birthday', () => {
    expect(ageInYears('1991-09-16', AT)).toBe(34)
  })

  it('handles a baby', () => {
    expect(ageInYears('2026-08-01', AT)).toBe(0)
  })

  it('has no answer without a date of birth', () => {
    // Plenty of patients arrive without one, and a blank is the honest answer.
    expect(ageInYears(null)).toBeNull()
    expect(ageInYears(undefined)).toBeNull()
    expect(ageInYears('')).toBeNull()
  })

  it('refuses an unparseable date rather than returning a number', () => {
    expect(ageInYears('not a date')).toBeNull()
  })

  it('treats a date of birth in the future as a typo, not a negative age', () => {
    expect(ageInYears('2030-01-01', AT)).toBeNull()
  })

  it('accepts a Date as well as a string', () => {
    expect(ageInYears(new Date('1991-03-10'), AT)).toBe(35)
  })
})
