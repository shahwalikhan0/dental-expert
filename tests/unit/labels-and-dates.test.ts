import { describe, it, expect } from 'vitest'
import {
  BLOOD_GROUP_OPTIONS,
  GENDER_OPTIONS,
  bloodGroupLabel,
  genderLabel,
  humanise,
} from '@/lib/labels'
import { displayDate, displayDateTime, displayDateWithGap, isoDay } from '@/lib/dates'

/**
 * Two things the interface was getting wrong in front of the user.
 *
 * The patient list showed `A_POSITIVE` for a blood group and `FEMALE` as a
 * badge — column values rendered straight out, while the mapping sat
 * duplicated in the two patient forms and used by neither the list nor the
 * record. And six date formats were in play at once: the patient record said
 * "March 14th, 1993" while the appointment beside it said "20-Sept-2026".
 */

describe('labels', () => {
  it('writes a blood group the way it is written on a form', () => {
    expect(bloodGroupLabel('A_POSITIVE')).toBe('A+')
    expect(bloodGroupLabel('AB_NEGATIVE')).toBe('AB−')
    expect(bloodGroupLabel('O_POSITIVE')).toBe('O+')
  })

  it('writes a gender as a word rather than a shout', () => {
    expect(genderLabel('FEMALE')).toBe('Female')
    expect(genderLabel('MALE')).toBe('Male')
  })

  it('writes an em dash for a blank', () => {
    expect(bloodGroupLabel(null)).toBe('—')
    expect(genderLabel(undefined)).toBe('—')
    expect(genderLabel('')).toBe('—')
  })

  // Shown rather than hidden: it is in the record, and refusing to display it
  // does not make it go away.
  it('falls back on a value it does not know', () => {
    expect(bloodGroupLabel('BOMBAY_POSITIVE')).toBe('Bombay positive')
    expect(genderLabel('PREFER_NOT_TO_SAY')).toBe('Prefer not to say')
  })

  it('humanises in sentence case, because these sit next to prose', () => {
    expect(humanise('IN_PROGRESS')).toBe('In progress')
    expect(humanise('CHECKED_IN')).toBe('Checked in')
    expect(humanise('PARTIALLY_REFUNDED')).toBe('Partially refunded')
  })

  it('offers every option a form needs', () => {
    expect(BLOOD_GROUP_OPTIONS).toHaveLength(8)
    expect(BLOOD_GROUP_OPTIONS[0]).toEqual({ value: 'A_POSITIVE', label: 'A+' })
    expect(GENDER_OPTIONS.map((o) => o.value)).toEqual(['MALE', 'FEMALE', 'OTHER'])
  })
})

describe('dates', () => {
  it('spells the month, so nobody has to guess the order', () => {
    const rendered = displayDate('2026-04-03')
    expect(rendered).toContain('2026')
    expect(rendered).toMatch(/Apr/)
    // The point: never a bare 03/04, which is two different days depending on
    // who is reading it.
    expect(rendered).not.toMatch(/^\d{2}\/\d{2}/)
  })

  /**
   * A bare `YYYY-MM-DD` is a calendar day, not an instant. Passing one to
   * `new Date()` reads it as UTC midnight, which renders as the day before for
   * anyone west of Greenwich — and the appointment API returns exactly this
   * form.
   */
  it('reads a calendar day as that day', () => {
    expect(displayDate('2026-01-01')).toContain('2026')
    expect(displayDate('2026-01-01')).toMatch(/01|1/)
    expect(displayDate('2026-01-01')).toMatch(/Jan/)
  })

  it('writes an em dash for a blank or a nonsense date', () => {
    expect(displayDate(null)).toBe('—')
    expect(displayDate('')).toBe('—')
    expect(displayDate('not a date')).toBe('—')
    expect(displayDateTime(undefined)).toBe('—')
  })

  it('says how long ago, where the gap is the point', () => {
    const today = new Date()
    expect(displayDateWithGap(today)).toContain('(today)')

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    expect(displayDateWithGap(yesterday)).toContain('(yesterday)')

    const lastWeek = new Date(today)
    lastWeek.setDate(lastWeek.getDate() - 7)
    expect(displayDateWithGap(lastWeek)).toContain('(7 days ago)')
  })

  // Built from the local parts, not `toISOString` — which would shift the day
  // for anyone east of Greenwich after midday.
  it('writes an ISO day from the local date, not from UTC', () => {
    expect(isoDay(new Date(2026, 8, 20, 23, 30))).toBe('2026-09-20')
    expect(isoDay(null)).toBe('')
  })
})
