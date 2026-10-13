import { describe, it, expect } from 'vitest'
import { DUE_SOON_DAYS, UPCOMING_DAYS, daysUntil, dueBand, nextDueDate } from '@/lib/recare'

/**
 * Recare — who should be in the chair and is not booked.
 *
 * The date arithmetic is the part worth testing: a recall list that says
 * "3 March" when the practice means "the end of February" is a list nobody
 * trusts, and a six-month interval set on the 31st is where that happens.
 */

const TODAY = new Date('2026-09-20T00:00:00Z')

describe('nextDueDate', () => {
  it('adds whole months, not thirty-day blocks', () => {
    expect(nextDueDate(new Date('2026-09-20T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe(
      '2027-03-20'
    )
    expect(nextDueDate(new Date('2026-09-20T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe(
      '2026-12-20'
    )
  })

  // The clamp. 31 August plus six months is February, and February has no 31st
  // — without this it rolls into March and the patient is recalled a week late.
  it('clamps to the last day of a shorter month', () => {
    expect(nextDueDate(new Date('2026-08-31T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe(
      '2027-02-28'
    )
    expect(nextDueDate(new Date('2026-10-31T00:00:00Z'), 4).toISOString().slice(0, 10)).toBe(
      '2027-02-28'
    )
  })

  it('handles a leap February', () => {
    expect(nextDueDate(new Date('2027-08-31T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe(
      '2028-02-29'
    )
  })

  it('crosses the year', () => {
    expect(nextDueDate(new Date('2026-11-15T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe(
      '2027-05-15'
    )
  })
})

describe('daysUntil', () => {
  it('counts forwards and backwards in whole days', () => {
    expect(daysUntil('2026-09-25', TODAY)).toBe(5)
    expect(daysUntil('2026-09-15', TODAY)).toBe(-5)
    expect(daysUntil('2026-09-20', TODAY)).toBe(0)
  })

  // Compared as calendar days, so a time of day cannot make "today" read as
  // yesterday.
  it('ignores the time of day', () => {
    expect(daysUntil('2026-09-20T23:59:00Z', TODAY)).toBe(0)
  })
})

describe('dueBand', () => {
  it('puts a past date in overdue', () => {
    expect(dueBand({ dueDate: '2026-09-19' }, TODAY)).toBe('OVERDUE')
    expect(dueBand({ dueDate: '2026-06-01' }, TODAY)).toBe('OVERDUE')
  })

  it('puts today and the next month in due soon', () => {
    expect(dueBand({ dueDate: '2026-09-20' }, TODAY)).toBe('DUE_SOON')
    expect(dueBand({ dueDate: '2026-10-20' }, TODAY)).toBe('DUE_SOON')
  })

  it('puts the next quarter in upcoming', () => {
    expect(dueBand({ dueDate: '2026-11-01' }, TODAY)).toBe('UPCOMING')
  })

  it('leaves anything further out of the list', () => {
    expect(dueBand({ dueDate: '2027-03-20' }, TODAY)).toBe('NOT_DUE')
  })

  // A deferral is its own band rather than a hidden row. "Ring me after
  // Ramadan" is a promise the clinic made, and a list that hides it forgets it.
  it('shows a snoozed recare as snoozed, even when it is overdue', () => {
    expect(dueBand({ dueDate: '2026-08-01', snoozedUntil: '2026-10-15' }, TODAY)).toBe('SNOOZED')
  })

  it('returns a lapsed snooze to its real band', () => {
    expect(dueBand({ dueDate: '2026-08-01', snoozedUntil: '2026-09-10' }, TODAY)).toBe('OVERDUE')
  })

  it('has bands that meet exactly at their boundaries', () => {
    const at = (days: number) => {
      const date = new Date(TODAY)
      date.setUTCDate(date.getUTCDate() + days)
      return date.toISOString().slice(0, 10)
    }

    expect(dueBand({ dueDate: at(DUE_SOON_DAYS) }, TODAY)).toBe('DUE_SOON')
    expect(dueBand({ dueDate: at(DUE_SOON_DAYS + 1) }, TODAY)).toBe('UPCOMING')
    expect(dueBand({ dueDate: at(UPCOMING_DAYS) }, TODAY)).toBe('UPCOMING')
    expect(dueBand({ dueDate: at(UPCOMING_DAYS + 1) }, TODAY)).toBe('NOT_DUE')
  })
})

describe('nextDueDate in the clinic calendar', () => {
  it('counts from the clinic day, not the UTC day', () => {
    // 00:20 on 14 October in Karachi is still 13 October in UTC.
    const visit = new Date('2026-10-13T19:20:00Z')
    expect(nextDueDate(visit, 6, 'Asia/Karachi').toISOString().slice(0, 10)).toBe('2027-04-14')
    expect(nextDueDate(visit, 6, 'UTC').toISOString().slice(0, 10)).toBe('2027-04-13')
  })
})
