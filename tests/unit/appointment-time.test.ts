/**
 * Putting a date-only column and an `HH:MM` string back together.
 *
 * The reminder cron did this by taking `scheduledDate` and subtracting an hour,
 * which is an hour before midnight rather than an hour before the appointment.
 */
import { describe, it, expect } from 'vitest'
import { appointmentInstant, formatCalendarDay, offsetMinutesIn } from '@/lib/appointment-time'

const KARACHI = 'Asia/Karachi'

describe('offsetMinutesIn', () => {
  it('reads Pakistan as five hours ahead, all year', () => {
    expect(offsetMinutesIn(KARACHI, new Date('2026-01-15T00:00:00Z'))).toBe(300)
    expect(offsetMinutesIn(KARACHI, new Date('2026-07-15T00:00:00Z'))).toBe(300)
  })

  it('follows a zone that does change', () => {
    expect(offsetMinutesIn('Europe/London', new Date('2026-01-15T12:00:00Z'))).toBe(0)
    expect(offsetMinutesIn('Europe/London', new Date('2026-07-15T12:00:00Z'))).toBe(60)
  })

  it('handles a half-hour zone', () => {
    expect(offsetMinutesIn('Asia/Kathmandu', new Date('2026-07-15T12:00:00Z'))).toBe(345)
  })
})

describe('appointmentInstant', () => {
  // The date column reads back as UTC midnight; only its calendar day matters.
  const day = new Date('2026-09-16T00:00:00Z')

  it('reads the time as the clinic own wall clock', () => {
    // 15:00 in Karachi is 10:00 UTC.
    expect(appointmentInstant(day, '15:00', KARACHI)?.toISOString()).toBe(
      '2026-09-16T10:00:00.000Z'
    )
  })

  it('does not drift the calendar day', () => {
    expect(appointmentInstant(day, '09:00', KARACHI)?.toISOString()).toBe(
      '2026-09-16T04:00:00.000Z'
    )
  })

  it('handles an early appointment that lands on the previous UTC day', () => {
    expect(appointmentInstant(day, '02:00', KARACHI)?.toISOString()).toBe(
      '2026-09-15T21:00:00.000Z'
    )
  })

  it('is right on both sides of a daylight-saving change', () => {
    const beforeClocks = new Date('2026-03-28T00:00:00Z')
    const afterClocks = new Date('2026-03-30T00:00:00Z')

    expect(appointmentInstant(beforeClocks, '12:00', 'Europe/London')?.toISOString()).toBe(
      '2026-03-28T12:00:00.000Z'
    )
    expect(appointmentInstant(afterClocks, '12:00', 'Europe/London')?.toISOString()).toBe(
      '2026-03-30T11:00:00.000Z'
    )
  })

  it('accepts a single-digit hour', () => {
    expect(appointmentInstant(day, '9:30', KARACHI)?.toISOString()).toBe('2026-09-16T04:30:00.000Z')
  })

  it('ignores anything after the minutes', () => {
    expect(appointmentInstant(day, '15:00:00', KARACHI)?.toISOString()).toBe(
      '2026-09-16T10:00:00.000Z'
    )
  })

  it('returns null rather than a nonsense date', () => {
    // `scheduledTime` is free text with no database constraint.
    for (const bad of ['', 'morning', '25:00', '10:75', '1000']) {
      expect(appointmentInstant(day, bad, KARACHI)).toBeNull()
    }
  })
})

describe('formatCalendarDay', () => {
  it('names the day the date column holds', () => {
    expect(formatCalendarDay(new Date('2026-09-16T00:00:00Z'))).toBe('16-Sep-2026')
  })

  it('does not slip a day on a host west of Greenwich', () => {
    // `format()` from date-fns reads the server's local timezone, so a date
    // column — which comes back as UTC midnight — renders as the day before.
    // A reminder that names the wrong day is worse than no reminder.
    expect(formatCalendarDay(new Date('2026-01-01T00:00:00Z'))).toBe('01-Jan-2026')
  })
})
