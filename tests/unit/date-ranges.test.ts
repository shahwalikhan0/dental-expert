import { describe, it, expect } from 'vitest'
import { browserToday, presetOf, rangeOf } from '@/lib/date-ranges'

// A Wednesday.
const TODAY = '2026-10-14'

describe('date range presets', () => {
  it('computes each preset on the given day', () => {
    expect(rangeOf('today', TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(rangeOf('yesterday', TODAY)).toEqual({ from: '2026-10-13', to: '2026-10-13' })
    expect(rangeOf('last_7_days', TODAY)).toEqual({ from: '2026-10-08', to: TODAY })
    // Weeks start on Monday.
    expect(rangeOf('this_week', TODAY)).toEqual({ from: '2026-10-12', to: TODAY })
    expect(rangeOf('this_month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
    expect(rangeOf('last_month', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(rangeOf('this_year', TODAY)).toEqual({ from: '2026-01-01', to: TODAY })
  })

  it('gives an empty range for any date or an unknown preset', () => {
    expect(rangeOf('any', TODAY)).toEqual({ from: '', to: '' })
    expect(rangeOf('nonsense', TODAY)).toEqual({ from: '', to: '' })
  })

  it('recognises a range as its preset, any, or custom', () => {
    expect(presetOf({ from: '', to: '' }, TODAY)).toBe('any')
    expect(presetOf({ from: '2026-10-01', to: TODAY }, TODAY)).toBe('this_month')
    expect(presetOf({ from: '2026-10-02', to: TODAY }, TODAY)).toBe('custom')
    expect(presetOf({ from: '2026-10-02', to: '' }, TODAY)).toBe('custom')
  })

  it('reads the browser day from local parts', () => {
    expect(browserToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
