/**
 * When a clinic, or one member of staff, can be booked.
 *
 * `StaffShift` said when a dentist works and `Holiday` said when the clinic is
 * shut. Both answered the same question for the slot picker, which queried each
 * separately and reconciled the answers itself — and between them they could
 * not express a dentist's day off (nothing recorded staff leave at all, so
 * somebody on holiday went on showing free slots) or a half-day closure.
 *
 * `Holiday.isRecurring` was worse than unused: the column existed and the
 * settings screen offered the checkbox, while both slot routes matched on the
 * exact date — so a holiday marked as recurring was observed once.
 */
import { describe, it, expect } from 'vitest'
import {
  appliesOn,
  blockedIntervals,
  closureOn,
  obstaclesOn,
  relevantOn,
  shiftOn,
  weekdayOf,
  type AvailabilityRow,
} from '@/lib/availability'

function row(overrides: Partial<AvailabilityRow>): AvailabilityRow {
  return {
    id: 'a1',
    staffId: null,
    dayOfWeek: null,
    date: null,
    startTime: null,
    endTime: null,
    isAvailable: true,
    name: null,
    isRecurring: false,
    ...overrides,
  }
}

const day = (d: string) => new Date(`${d}T00:00:00.000Z`)

// 2026-09-16 is a Wednesday.
const WEDNESDAY = '2026-09-16'
const THURSDAY = '2026-09-17'

describe('weekdayOf', () => {
  it('counts from Sunday, like the shift column always did', () => {
    expect(weekdayOf('2026-09-13')).toBe(0)
    expect(weekdayOf(WEDNESDAY)).toBe(3)
  })

  it('reads the day out of the string, not out of the host timezone', () => {
    expect(weekdayOf('2026-09-16T00:00:00.000Z')).toBe(3)
  })
})

describe('appliesOn', () => {
  it('matches a weekly row on its weekday', () => {
    expect(appliesOn(row({ dayOfWeek: 3 }), WEDNESDAY)).toBe(true)
    expect(appliesOn(row({ dayOfWeek: 3 }), THURSDAY)).toBe(false)
  })

  it('matches a dated row on its date', () => {
    expect(appliesOn(row({ date: day(WEDNESDAY) }), WEDNESDAY)).toBe(true)
    expect(appliesOn(row({ date: day(WEDNESDAY) }), THURSDAY)).toBe(false)
  })

  // The whole point of the column the old code ignored.
  it('matches a recurring row on the same day of a different year', () => {
    const eid = row({ date: day('2024-09-16'), isRecurring: true })
    expect(appliesOn(eid, WEDNESDAY)).toBe(true)
    expect(appliesOn(eid, THURSDAY)).toBe(false)
  })
})

describe('relevantOn', () => {
  it('asks for the weekday, the date and anything recurring', () => {
    const where = relevantOn('h1', WEDNESDAY)
    expect(where.hospitalId).toBe('h1')
    expect(where.AND[0].OR).toEqual([
      { dayOfWeek: 3 },
      { date: day(WEDNESDAY) },
      { isRecurring: true },
    ])
  })

  // A clinic closure applies to everybody; one dentist's leave does not apply
  // to the colleague being booked.
  it('narrows to the clinic and one person when a doctor is named', () => {
    const where = relevantOn('h1', WEDNESDAY, 'doc-1')
    expect(where.AND[1]).toEqual({ OR: [{ staffId: null }, { staffId: 'doc-1' }] })
  })

  it('asks for everybody when no doctor is named', () => {
    expect(relevantOn('h1', WEDNESDAY).AND).toHaveLength(1)
  })
})

describe('closureOn', () => {
  const holiday = row({ date: day(WEDNESDAY), isAvailable: false, name: 'Eid al-Fitr' })

  it('reports a whole day the clinic is shut', () => {
    expect(closureOn([holiday], WEDNESDAY)).toEqual({ reason: 'Holiday: Eid al-Fitr' })
  })

  it('says nothing about a day it does not cover', () => {
    expect(closureOn([holiday], THURSDAY)).toBeNull()
  })

  it('observes a recurring holiday every year, not once', () => {
    const yearly = row({
      date: day('2024-09-16'),
      isAvailable: false,
      name: 'Eid al-Fitr',
      isRecurring: true,
    })
    expect(closureOn([yearly], WEDNESDAY)?.reason).toContain('Eid al-Fitr')
  })

  // A closure with times narrows the day rather than removing it.
  it('is not triggered by a half-day closure', () => {
    const halfDay = row({
      date: day(WEDNESDAY),
      isAvailable: false,
      startTime: '13:00',
      endTime: '18:00',
      name: 'Closing early',
    })
    expect(closureOn([halfDay], WEDNESDAY)).toBeNull()
  })

  it('is not triggered by a weekly shift', () => {
    expect(
      closureOn([row({ dayOfWeek: 3, startTime: '09:00', endTime: '17:00' })], WEDNESDAY)
    ).toBeNull()
  })

  it('names the day plainly when the closure has no name', () => {
    const unnamed = row({ date: day(WEDNESDAY), isAvailable: false })
    expect(closureOn([unnamed], WEDNESDAY)?.reason).toBe('The clinic is closed on this day')
  })
})

describe('shiftOn', () => {
  const shift = row({
    staffId: 'doc-1',
    dayOfWeek: 3,
    startTime: '10:00',
    endTime: '16:00',
  })

  it('finds the dentist own hours for the day', () => {
    expect(shiftOn([shift], WEDNESDAY, 'doc-1')).toEqual({
      startTime: '10:00',
      endTime: '16:00',
    })
  })

  it('does not hand one dentist another dentist hours', () => {
    expect(shiftOn([shift], WEDNESDAY, 'doc-2')).toBeNull()
  })

  it('does not mistake a clinic-wide row for somebody shift', () => {
    const clinicWide = row({ dayOfWeek: 3, startTime: '09:00', endTime: '20:00' })
    expect(shiftOn([clinicWide], WEDNESDAY, 'doc-1')).toBeNull()
  })

  it('returns nothing on a day they do not work', () => {
    expect(shiftOn([shift], THURSDAY, 'doc-1')).toBeNull()
  })
})

describe('blockedIntervals', () => {
  it('reports a half-day closure as the stretch it covers', () => {
    const halfDay = row({
      date: day(WEDNESDAY),
      isAvailable: false,
      startTime: '13:00',
      endTime: '18:00',
    })
    expect(blockedIntervals([halfDay], WEDNESDAY)).toEqual([{ start: '13:00', end: '18:00' }])
  })

  // What neither of the two old tables could say at all.
  it('reports an afternoon of somebody leave', () => {
    const leave = row({
      staffId: 'doc-1',
      date: day(WEDNESDAY),
      isAvailable: false,
      startTime: '14:00',
      endTime: '18:00',
      name: 'Annual leave',
    })
    expect(blockedIntervals([leave], WEDNESDAY)).toEqual([{ start: '14:00', end: '18:00' }])
  })

  it('ignores anything that opens the time rather than closing it', () => {
    expect(
      blockedIntervals([row({ dayOfWeek: 3, startTime: '09:00', endTime: '17:00' })], WEDNESDAY)
    ).toEqual([])
  })
})

describe('obstaclesOn', () => {
  it('puts the clinic lunch break alongside the closures', () => {
    const hours = { open: '09:00', close: '18:00', lunch: { start: '13:00', end: '14:00' } }
    const leave = row({
      staffId: 'doc-1',
      date: day(WEDNESDAY),
      isAvailable: false,
      startTime: '15:00',
      endTime: '16:00',
    })

    expect(obstaclesOn(hours, [leave], WEDNESDAY)).toEqual([
      { start: '15:00', end: '16:00' },
      { start: '13:00', end: '14:00' },
    ])
  })

  it('drops an interval that covers no time at all', () => {
    const nonsense = row({
      date: day(WEDNESDAY),
      isAvailable: false,
      startTime: '14:00',
      endTime: '14:00',
    })
    expect(obstaclesOn({ open: '09:00', close: '18:00' }, [nonsense], WEDNESDAY)).toEqual([])
  })
})
