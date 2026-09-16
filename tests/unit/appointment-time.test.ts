/**
 * Wall clock and instant.
 *
 * An appointment is stored as a point in time, but a clinic books and reads a
 * wall-clock time in its own zone. Everything here is the conversion between
 * the two — the thing the reminder cron used to skip, subtracting an hour from
 * a date column and arriving an hour before midnight.
 */
import { describe, it, expect } from 'vitest'
import {
  clinicTimezone,
  dayRangeIn,
  endsAt,
  formatCalendarDay,
  instantAt,
  localDay,
  offsetMinutesIn,
  wallClockIn,
  withWallClock,
} from '@/lib/appointment-time'

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

describe('instantAt', () => {
  const day = '2026-09-16'

  it('reads the time as the clinic own wall clock', () => {
    // 15:00 in Karachi is 10:00 UTC.
    expect(instantAt(day, '15:00', KARACHI)?.toISOString()).toBe('2026-09-16T10:00:00.000Z')
  })

  it('does not drift the calendar day', () => {
    expect(instantAt(day, '09:00', KARACHI)?.toISOString()).toBe('2026-09-16T04:00:00.000Z')
  })

  it('handles an early appointment that lands on the previous UTC day', () => {
    expect(instantAt(day, '02:00', KARACHI)?.toISOString()).toBe('2026-09-15T21:00:00.000Z')
  })

  it('takes the calendar day out of a Date without reading the host zone', () => {
    // A `Date` arriving from an ISO string is UTC midnight; its calendar day is
    // what is wanted, not whatever day the server thinks that instant is.
    expect(instantAt(new Date('2026-09-16T00:00:00Z'), '15:00', KARACHI)?.toISOString()).toBe(
      '2026-09-16T10:00:00.000Z'
    )
  })

  it('is right on both sides of a daylight-saving change', () => {
    expect(instantAt('2026-03-28', '12:00', 'Europe/London')?.toISOString()).toBe(
      '2026-03-28T12:00:00.000Z'
    )
    expect(instantAt('2026-03-30', '12:00', 'Europe/London')?.toISOString()).toBe(
      '2026-03-30T11:00:00.000Z'
    )
  })

  it('accepts a single-digit hour', () => {
    expect(instantAt(day, '9:30', KARACHI)?.toISOString()).toBe('2026-09-16T04:30:00.000Z')
  })

  it('ignores anything after the minutes', () => {
    expect(instantAt(day, '15:00:00', KARACHI)?.toISOString()).toBe('2026-09-16T10:00:00.000Z')
  })

  it('returns null rather than a nonsense date', () => {
    // Both halves arrive from request bodies and spreadsheet imports.
    for (const bad of ['', 'morning', '25:00', '10:75', '1000']) {
      expect(instantAt(day, bad, KARACHI)).toBeNull()
    }
    expect(instantAt('not a day', '15:00', KARACHI)).toBeNull()
    expect(instantAt(new Date('nonsense'), '15:00', KARACHI)).toBeNull()
  })
})

describe('wallClockIn', () => {
  it('reads an instant off the clinic wall', () => {
    expect(wallClockIn(new Date('2026-09-16T10:00:00Z'), KARACHI)).toEqual({
      scheduledDate: '2026-09-16',
      scheduledTime: '15:00',
    })
  })

  it('names the clinic day, not the UTC one', () => {
    // 02:00 on the 16th in Karachi is still the 15th in UTC.
    expect(wallClockIn(new Date('2026-09-15T21:00:00Z'), KARACHI)).toEqual({
      scheduledDate: '2026-09-16',
      scheduledTime: '02:00',
    })
  })

  it('renders clinic midnight as 00:00 and not 24:00', () => {
    expect(wallClockIn(new Date('2026-09-15T19:00:00Z'), KARACHI).scheduledTime).toBe('00:00')
  })

  it('round-trips with instantAt', () => {
    const instant = new Date('2026-09-16T10:00:00Z')
    const { scheduledDate, scheduledTime } = wallClockIn(instant, KARACHI)
    expect(instantAt(scheduledDate, scheduledTime, KARACHI)?.toISOString()).toBe(
      instant.toISOString()
    )
  })
})

describe('dayRangeIn', () => {
  it('covers the clinic day, not the server one', () => {
    const range = dayRangeIn('2026-09-16', KARACHI)
    expect(range.gte.toISOString()).toBe('2026-09-15T19:00:00.000Z')
    expect(range.lt.toISOString()).toBe('2026-09-16T19:00:00.000Z')
  })

  it('is half-open, so an appointment at 23:59 is in and the next day is out', () => {
    const range = dayRangeIn('2026-09-16', KARACHI)
    const lastMinute = instantAt('2026-09-16', '23:59', KARACHI)!
    const nextMidnight = instantAt('2026-09-17', '00:00', KARACHI)!
    expect(lastMinute >= range.gte && lastMinute < range.lt).toBe(true)
    expect(nextMidnight < range.lt).toBe(false)
  })

  it('spans several days when asked', () => {
    const week = dayRangeIn('2026-09-14', KARACHI, 7)
    expect(week.gte.toISOString()).toBe('2026-09-13T19:00:00.000Z')
    expect(week.lt.toISOString()).toBe('2026-09-20T19:00:00.000Z')
  })

  it('crosses a month end', () => {
    const range = dayRangeIn('2026-09-01', KARACHI, 30)
    expect(wallClockIn(range.lt, KARACHI).scheduledDate).toBe('2026-10-01')
  })
})

describe('localDay', () => {
  it('names the clinic calendar day an instant falls on', () => {
    expect(localDay(new Date('2026-09-15T21:00:00Z'), KARACHI)).toBe('2026-09-16')
    expect(localDay(new Date('2026-09-15T18:00:00Z'), KARACHI)).toBe('2026-09-15')
  })
})

describe('formatCalendarDay', () => {
  it('names the day in the clinic zone', () => {
    expect(formatCalendarDay(new Date('2026-09-16T10:00:00Z'), KARACHI)).toBe('16-Sep-2026')
  })

  it('does not slip a day for an appointment early in the clinic morning', () => {
    // A reminder that names the wrong day is worse than no reminder.
    expect(formatCalendarDay(new Date('2025-12-31T21:00:00Z'), KARACHI)).toBe('01-Jan-2026')
  })

  it('writes a three-letter September, unlike Intl', () => {
    expect(formatCalendarDay(new Date('2026-09-16T10:00:00Z'), KARACHI)).toContain('Sep-')
    expect(formatCalendarDay(new Date('2026-09-16T10:00:00Z'), KARACHI)).not.toContain('Sept')
  })
})

describe('endsAt', () => {
  it('adds the duration in minutes', () => {
    expect(endsAt(new Date('2026-09-16T10:00:00Z'), 45).toISOString()).toBe(
      '2026-09-16T10:45:00.000Z'
    )
  })
})

describe('withWallClock', () => {
  it('keeps the instant and adds what the screens read', () => {
    const row = { id: 'a1', startsAt: new Date('2026-09-16T10:00:00Z') }
    expect(withWallClock(row, KARACHI)).toEqual({
      id: 'a1',
      startsAt: new Date('2026-09-16T10:00:00Z'),
      scheduledDate: '2026-09-16',
      scheduledTime: '15:00',
    })
  })
})

describe('clinicTimezone', () => {
  const db = (timezone: string | null) => ({
    hospital: {
      findUnique: async () => (timezone === null ? null : { timezone }),
    },
  })

  it('reads the clinic own zone', async () => {
    expect(await clinicTimezone(db('Europe/London') as never, 'h1')).toBe('Europe/London')
  })

  it('falls back rather than formatting against undefined', async () => {
    expect(await clinicTimezone(db(null) as never, 'h1')).toBe(KARACHI)
    expect(await clinicTimezone(db('') as never, 'h1')).toBe(KARACHI)
  })
})
