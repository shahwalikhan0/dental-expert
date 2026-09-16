/**
 * Reading `Hospital.workingHours`.
 *
 * Every writer in the application stores one entry per weekday — the settings
 * screen, onboarding and the seed all agree. Both slot routes read it into a
 * variable they had typed `{ start, end, lunchStart, lunchEnd }`, a shape
 * nothing has ever stored, and then split `undefined`. The parse succeeded, so
 * the defaults sitting behind it never applied: the time-slot picker returned
 * 500 for every clinic that had saved its hours, on the booking screen and on
 * the public booking page both.
 */
import { describe, it, expect } from 'vitest'
import { availableSlots, hoursOn, minutesOf, timeOf, DEFAULT_DAY_HOURS } from '@/lib/working-hours'

/** Exactly what the settings screen writes. */
const STORED = JSON.stringify({
  monday: { open: '09:00', close: '20:00' },
  tuesday: { open: '09:00', close: '20:00' },
  wednesday: { open: '09:00', close: '20:00' },
  thursday: { open: '09:00', close: '20:00' },
  friday: { open: '09:00', close: '20:00' },
  saturday: { open: '09:00', close: '14:00' },
  sunday: { open: null, close: null },
})

// 2026-09-16 is a Wednesday, the 19th a Saturday, the 20th a Sunday.
describe('hoursOn', () => {
  it('reads the weekday the clinic actually stored', () => {
    expect(hoursOn(STORED, '2026-09-16')).toEqual({ open: '09:00', close: '20:00' })
    expect(hoursOn(STORED, '2026-09-19')).toEqual({ open: '09:00', close: '14:00' })
  })

  it('says closed for a day with no hours', () => {
    expect(hoursOn(STORED, '2026-09-20')).toBeNull()
  })

  it('takes the weekday from the calendar day, not from a host timezone', () => {
    // Parsed as UTC, not as local midnight, so a host west of Greenwich does
    // not read Wednesday as Tuesday.
    expect(hoursOn(STORED, '2026-09-16T00:00:00.000Z')).toEqual({
      open: '09:00',
      close: '20:00',
    })
  })

  it('falls back for a clinic that has never configured anything', () => {
    expect(hoursOn(null, '2026-09-16')).toEqual(DEFAULT_DAY_HOURS)
    expect(hoursOn('', '2026-09-16')).toEqual(DEFAULT_DAY_HOURS)
  })

  it('falls back for an object that names no day of the week', () => {
    // The shape both slot routes wrongly believed was stored.
    const legacy = JSON.stringify({ start: '09:00', end: '10:00' })
    expect(hoursOn(legacy, '2026-09-16')).toEqual(DEFAULT_DAY_HOURS)
  })

  it('falls back rather than throwing on unreadable JSON', () => {
    expect(hoursOn('{not json', '2026-09-16')).toEqual(DEFAULT_DAY_HOURS)
    expect(hoursOn('"a string"', '2026-09-16')).toEqual(DEFAULT_DAY_HOURS)
  })

  // The column is free text; a bad time used to reach `parseInt` and produce
  // NaN hours, which silently generated no slots at all.
  it('treats a malformed or impossible time as closed', () => {
    expect(
      hoursOn(JSON.stringify({ wednesday: { open: 'morning', close: '20:00' } }), '2026-09-16')
    ).toBeNull()
    expect(
      hoursOn(JSON.stringify({ wednesday: { open: '25:00', close: '26:00' } }), '2026-09-16')
    ).toBeNull()
    expect(
      hoursOn(JSON.stringify({ wednesday: { open: '20:00', close: '09:00' } }), '2026-09-16')
    ).toBeNull()
  })

  it('carries a lunch break when one is recorded', () => {
    const raw = JSON.stringify({
      wednesday: { open: '09:00', close: '18:00', lunch: { start: '13:00', end: '14:00' } },
    })
    expect(hoursOn(raw, '2026-09-16')?.lunch).toEqual({ start: '13:00', end: '14:00' })
  })

  it('does not invent a lunch break the clinic never recorded', () => {
    expect(hoursOn(STORED, '2026-09-16')?.lunch).toBeUndefined()
  })
})

describe('minutesOf / timeOf', () => {
  it('round-trips', () => {
    expect(timeOf(minutesOf('14:45'))).toBe('14:45')
  })

  it('pads', () => {
    expect(timeOf(545)).toBe('09:05')
  })

  it('wraps past midnight rather than reporting 24:45', () => {
    expect(timeOf(minutesOf('23:45') + 60)).toBe('00:45')
  })
})

const NOT_TODAY = { day: '2020-01-01', time: '00:00' }

describe('availableSlots', () => {
  const hours = { open: '09:00', close: '11:00' }

  it('offers a slot every half hour between opening and closing', () => {
    const slots = availableSlots({
      hours,
      duration: 30,
      booked: [],
      day: '2026-09-16',
      now: NOT_TODAY,
    })
    expect(slots.map((s) => s.time)).toEqual(['09:00', '09:30', '10:00', '10:30'])
    expect(slots.every((s) => s.available)).toBe(true)
  })

  // The previous loop offered every half hour up to closing time regardless of
  // how long the appointment was, so a clinic closing at 11:00 offered a
  // 60-minute slot at 10:30.
  it('does not offer a slot the appointment cannot finish in', () => {
    const slots = availableSlots({
      hours,
      duration: 60,
      booked: [],
      day: '2026-09-16',
      now: NOT_TODAY,
    })
    expect(slots.map((s) => s.time)).toEqual(['09:00', '09:30', '10:00'])
  })

  it('marks a slot overlapping an existing appointment as taken', () => {
    const slots = availableSlots({
      hours,
      duration: 30,
      booked: [{ start: '09:15', duration: 30 }],
      day: '2026-09-16',
      now: NOT_TODAY,
    })
    const taken = slots.filter((s) => !s.available).map((s) => s.time)
    expect(taken).toEqual(['09:00', '09:30'])
  })

  it('leaves a back-to-back slot free', () => {
    const slots = availableSlots({
      hours,
      duration: 30,
      booked: [{ start: '09:00', duration: 30 }],
      day: '2026-09-16',
      now: NOT_TODAY,
    })
    expect(slots.find((s) => s.time === '09:30')?.available).toBe(true)
  })

  // A lunch break, a half-day closure and an afternoon of somebody's leave are
  // one kind of obstacle here; lib/availability.ts works out which apply.
  it('closes a blocked stretch of the day', () => {
    const slots = availableSlots({
      hours: { open: '12:00', close: '15:00' },
      duration: 30,
      booked: [],
      blocked: [{ start: '13:00', end: '14:00' }],
      day: '2026-09-16',
      now: NOT_TODAY,
    })
    const closed = slots.filter((s) => !s.available).map((s) => s.time)
    expect(closed).toEqual(['13:00', '13:30'])
  })

  it('closes every blocked stretch, not just the first', () => {
    const slots = availableSlots({
      hours: { open: '09:00', close: '12:00' },
      duration: 30,
      booked: [],
      blocked: [
        { start: '09:30', end: '10:00' },
        { start: '11:00', end: '11:30' },
      ],
      day: '2026-09-16',
      now: NOT_TODAY,
    })
    expect(slots.filter((s) => !s.available).map((s) => s.time)).toEqual(['09:30', '11:00'])
  })

  it('narrows the clinic hours to the doctor shift', () => {
    const slots = availableSlots({
      hours: { open: '09:00', close: '20:00' },
      shift: { startTime: '14:00', endTime: '15:30' },
      duration: 30,
      booked: [],
      day: '2026-09-16',
      now: NOT_TODAY,
    })
    expect(slots.map((s) => s.time)).toEqual(['14:00', '14:30', '15:00'])
  })

  it('does not offer a slot that has already gone, on the clinic clock', () => {
    const slots = availableSlots({
      hours,
      duration: 30,
      booked: [],
      day: '2026-09-16',
      now: { day: '2026-09-16', time: '09:45' },
    })
    expect(slots.filter((s) => s.available).map((s) => s.time)).toEqual(['10:00', '10:30'])
  })

  it('leaves the whole day open when today is a different day', () => {
    const slots = availableSlots({
      hours,
      duration: 30,
      booked: [],
      day: '2026-09-17',
      now: { day: '2026-09-16', time: '23:00' },
    })
    expect(slots.every((s) => s.available)).toBe(true)
  })
})
