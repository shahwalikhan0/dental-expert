import { describe, it, expect } from 'vitest'
import {
  canMoveStatus,
  checkLabOrderValues,
  milestoneUpdate,
  nextStatuses,
  normaliseWorkType,
  STATUS_PATH,
  workTypeLabel,
  WORK_TYPES,
} from '@/lib/lab-orders'

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

/**
 * Finding 45: LAB20260001 went CREATED → FITTED → CREATED, both answered 200,
 * and its delivered date stayed stamped on an order that said CREATED.
 */
describe('lab order status moves', () => {
  it('moves forward one stage at a time', () => {
    for (let i = 0; i < STATUS_PATH.length - 1; i++) {
      expect(canMoveStatus(STATUS_PATH[i], STATUS_PATH[i + 1])).toBe(true)
    }
  })

  it('refuses to skip a stage', () => {
    expect(canMoveStatus('CREATED', 'FITTED')).toBe(false)
    expect(canMoveStatus('SENT_TO_LAB', 'READY')).toBe(false)
  })

  it('refuses to go back, apart from the rework steps', () => {
    expect(canMoveStatus('FITTED', 'CREATED')).toBe(false)
    expect(canMoveStatus('READY', 'IN_PROGRESS')).toBe(false)
    // Failed the check: back on the bench.
    expect(canMoveStatus('QUALITY_CHECK', 'IN_PROGRESS')).toBe(true)
    // Came back wrong, or did not fit: remade, and sent again.
    expect(canMoveStatus('DELIVERED', 'REMAKE_REQUIRED')).toBe(true)
    expect(canMoveStatus('REMAKE_REQUIRED', 'SENT_TO_LAB')).toBe(true)
  })

  it('ends at fitted and at cancelled', () => {
    expect(nextStatuses('FITTED')).toEqual([])
    expect(nextStatuses('CANCELLED')).toEqual([])
  })

  it('can be cancelled until the work is fitted', () => {
    for (const status of ['CREATED', 'SENT_TO_LAB', 'IN_PROGRESS', 'READY', 'DELIVERED'] as const) {
      expect(canMoveStatus(status, 'CANCELLED')).toBe(true)
    }
  })
})

describe('milestoneUpdate', () => {
  const NOW = new Date('2026-10-12T10:00:00Z')
  const none = { sentDate: null, receivedDate: null, deliveredDate: null }

  it('stamps each date the first time its stage is reached', () => {
    expect(milestoneUpdate(none, 'CREATED', 'SENT_TO_LAB', NOW)).toEqual({ sentDate: NOW })
    expect(milestoneUpdate({ ...none, sentDate: NOW }, 'QUALITY_CHECK', 'READY', NOW)).toEqual({
      receivedDate: NOW,
    })
  })

  it('does not restamp a date already set', () => {
    const sent = new Date('2026-10-01')
    expect(milestoneUpdate({ ...none, sentDate: sent }, 'SENT_TO_LAB', 'IN_PROGRESS', NOW)).toEqual(
      {}
    )
  })

  it('clears the dates a remake is now short of', () => {
    const dates = {
      sentDate: new Date('2026-10-01'),
      receivedDate: new Date('2026-10-05'),
      deliveredDate: new Date('2026-10-06'),
    }
    expect(milestoneUpdate(dates, 'DELIVERED', 'REMAKE_REQUIRED', NOW)).toEqual({
      receivedDate: null,
      deliveredDate: null,
    })
  })

  it('stamps a fresh sent date when a remake goes back to the laboratory', () => {
    const dates = { ...none, sentDate: new Date('2026-10-01') }
    expect(milestoneUpdate(dates, 'REMAKE_REQUIRED', 'SENT_TO_LAB', NOW)).toEqual({
      sentDate: NOW,
    })
  })

  it('leaves the dates alone on cancellation', () => {
    const dates = { ...none, sentDate: new Date('2026-10-01') }
    expect(milestoneUpdate(dates, 'IN_PROGRESS', 'CANCELLED', NOW)).toEqual({})
  })
})

/** Finding 59: ordered 12 October, due 1 October, estimate −100. */
describe('checkLabOrderValues', () => {
  const ok = { orderDate: '2026-10-12', expectedDate: '2026-10-20', estimatedCost: 5000 }

  it('accepts a case that makes sense', () => {
    expect(checkLabOrderValues(ok)).toBeNull()
  })

  it('accepts a blank expected date and a blank actual cost', () => {
    expect(checkLabOrderValues({ ...ok, expectedDate: '', actualCost: '' })).toBeNull()
  })

  it('accepts an expected date on the order date', () => {
    expect(checkLabOrderValues({ ...ok, expectedDate: '2026-10-12' })).toBeNull()
  })

  it('refuses an expected date before the order date', () => {
    expect(checkLabOrderValues({ ...ok, expectedDate: '2026-10-01' })).toContain(
      'before the order date'
    )
  })

  it('refuses a negative estimate or actual cost', () => {
    expect(checkLabOrderValues({ ...ok, estimatedCost: -100 })).toContain('negative')
    expect(checkLabOrderValues({ ...ok, actualCost: -1 })).toContain('negative')
  })

  it('refuses a date or a cost that is not one', () => {
    expect(checkLabOrderValues({ ...ok, orderDate: 'yesterday' })).toContain('not a date')
    expect(checkLabOrderValues({ ...ok, estimatedCost: 'lots' })).toContain('number')
  })
})
