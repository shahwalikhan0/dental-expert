import { describe, it, expect } from 'vitest'
import { normaliseWorkType, workTypeLabel, WORK_TYPES } from '@/lib/lab-orders'

/**
 * `LabOrder.workType` is an enum, and three parts of the application disagreed
 * about how to spell it.
 *
 * The new-order form offered lower case, the column accepts UPPER_SNAKE only,
 * and the route passed the value through untouched — so submitting the form
 * answered 500 and no lab case could be raised through the interface at all.
 * Every case in the database had been put there by the seed, which is why
 * nothing noticed.
 */

describe('normaliseWorkType', () => {
  it('accepts the enum spelling unchanged', () => {
    expect(normaliseWorkType('CROWN')).toBe('CROWN')
    expect(normaliseWorkType('NIGHT_GUARD')).toBe('NIGHT_GUARD')
  })

  it('accepts what the form used to send', () => {
    expect(normaliseWorkType('crown')).toBe('CROWN')
    expect(normaliseWorkType('partial_denture')).toBe('PARTIAL_DENTURE')
  })

  it('accepts the label a person would type', () => {
    expect(normaliseWorkType('Inlay/Onlay')).toBe('INLAY_ONLAY')
    expect(normaliseWorkType('night guard')).toBe('NIGHT_GUARD')
    expect(normaliseWorkType('implant-crown')).toBe('IMPLANT_CROWN')
    expect(normaliseWorkType('  Bridge  ')).toBe('BRIDGE')
  })

  it('refuses what it cannot recognise rather than guessing', () => {
    // The caller answers 400. Passing an unknown value through is what made
    // this a 500 with a Prisma validation error in the body.
    expect(normaliseWorkType('spaceship')).toBeNull()
    expect(normaliseWorkType('')).toBeNull()
    expect(normaliseWorkType(null)).toBeNull()
    expect(normaliseWorkType(undefined)).toBeNull()
    expect(normaliseWorkType(42)).toBeNull()
  })

  it('round-trips every option the forms offer', () => {
    for (const type of WORK_TYPES) {
      expect(normaliseWorkType(type.value)).toBe(type.value)
      expect(normaliseWorkType(type.label)).toBe(type.value)
    }
  })
})

describe('workTypeLabel', () => {
  it('writes a work type the way a person reads it', () => {
    expect(workTypeLabel('NIGHT_GUARD')).toBe('Night guard')
    expect(workTypeLabel('crown')).toBe('Crown')
  })

  it('shows a value it does not know rather than hiding it', () => {
    // It is in the record; refusing to display it would not make it go away.
    expect(workTypeLabel('SOMETHING_ELSE')).toBe('Something Else')
  })
})
