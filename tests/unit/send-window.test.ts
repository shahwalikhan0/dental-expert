/**
 * The hours a clinic may text its patients.
 *
 * This replaces one line of hardcoded India: 9am–9pm IST, computed by adding
 * five and a half hours to UTC. On a Pakistani clinic that is wrong twice over
 * — the country has no such statutory window, and the offset is half an hour
 * out, so 20:45 in Karachi was refused as "past 9pm" while 09:15 was refused as
 * "before 9am".
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SEND_WINDOW,
  describeSendWindow,
  isWithinSendWindow,
  minutesOfDayIn,
  parseTimeOfDay,
} from '@/lib/send-window'

const at = (iso: string) => new Date(iso)

describe('parseTimeOfDay', () => {
  it('reads HH:MM', () => {
    expect(parseTimeOfDay('09:00')).toBe(540)
    expect(parseTimeOfDay('00:00')).toBe(0)
    expect(parseTimeOfDay('23:59')).toBe(1439)
    expect(parseTimeOfDay('9:05')).toBe(545)
  })

  it('refuses anything else', () => {
    for (const value of ['', 'nine', '9', '24:00', '12:60', '12:0', null, undefined, 900]) {
      expect(parseTimeOfDay(value as never), String(value)).toBeNull()
    }
  })
})

describe('minutesOfDayIn', () => {
  /**
   * `Intl`, not arithmetic on an offset. An offset has to be kept in step by
   * hand — the old code's `5.5 * 60 * 60 * 1000` was already half an hour wrong
   * for Pakistan — and daylight saving makes one wrong twice a year besides.
   */
  it('reads the wall clock in the given zone', () => {
    // 07:00 UTC is 12:00 in Karachi (+5) and 12:30 in Kolkata (+5:30).
    expect(minutesOfDayIn('Asia/Karachi', at('2026-02-19T07:00:00Z'))).toBe(12 * 60)
    expect(minutesOfDayIn('Asia/Kolkata', at('2026-02-19T07:00:00Z'))).toBe(12 * 60 + 30)
    expect(minutesOfDayIn('UTC', at('2026-02-19T07:00:00Z'))).toBe(7 * 60)
  })

  it('handles midnight as zero, not as twenty-four', () => {
    expect(minutesOfDayIn('Asia/Karachi', at('2026-02-19T19:00:00Z'))).toBe(0)
  })

  it('follows daylight saving where it applies', () => {
    // London is UTC in February and UTC+1 in July.
    expect(minutesOfDayIn('Europe/London', at('2026-02-19T12:00:00Z'))).toBe(12 * 60)
    expect(minutesOfDayIn('Europe/London', at('2026-07-19T12:00:00Z'))).toBe(13 * 60)
  })
})

describe('isWithinSendWindow', () => {
  const karachi = (iso: string, window?: { start: string; end: string }) =>
    isWithinSendWindow('Asia/Karachi', window, at(iso))

  it('defaults to nine until nine', () => {
    expect(DEFAULT_SEND_WINDOW).toEqual({ start: '09:00', end: '21:00' })
    expect(karachi('2026-02-19T07:00:00Z')).toBe(true) // 12:00
    expect(karachi('2026-02-19T22:00:00Z')).toBe(false) // 03:00
  })

  /**
   * The exact half-hours the IST offset got wrong: 20:45 in Karachi is 21:15 in
   * India, and 09:15 in Karachi is 08:45 there. The old check refused both.
   */
  it('gets the quarter-hours right that the IST offset did not', () => {
    expect(karachi('2026-02-19T15:45:00Z')).toBe(true) // 20:45 Karachi
    expect(karachi('2026-02-19T04:15:00Z')).toBe(true) // 09:15 Karachi
  })

  // Half-open at the end, so "nine in the evening" means what a person means.
  it('includes the opening minute and excludes the closing one', () => {
    expect(karachi('2026-02-19T04:00:00Z')).toBe(true) // 09:00 exactly
    expect(karachi('2026-02-19T03:59:00Z')).toBe(false) // 08:59
    expect(karachi('2026-02-19T16:00:00Z')).toBe(false) // 21:00 exactly
    expect(karachi('2026-02-19T15:59:00Z')).toBe(true) // 20:59
  })

  it('honours a window the clinic has moved', () => {
    const office = { start: '08:00', end: '18:00' }
    expect(karachi('2026-02-19T03:30:00Z', office)).toBe(true) // 08:30
    expect(karachi('2026-02-19T14:00:00Z', office)).toBe(false) // 19:00
  })

  /**
   * Nobody is likely to want an overnight window, but reading it as empty would
   * silently stop every message the clinic sends instead of doing the obvious
   * thing.
   */
  it('reads a window that wraps past midnight as wrapping', () => {
    const overnight = { start: '22:00', end: '06:00' }
    expect(karachi('2026-02-19T18:00:00Z', overnight)).toBe(true) // 23:00
    expect(karachi('2026-02-19T00:00:00Z', overnight)).toBe(true) // 05:00
    expect(karachi('2026-02-19T07:00:00Z', overnight)).toBe(false) // 12:00
  })

  // How a clinic turns the restriction off, rather than by finding a checkbox
  // somewhere else that does the same thing and can disagree with this.
  it('treats equal bounds as no restriction at all', () => {
    const always = { start: '00:00', end: '00:00' }
    expect(karachi('2026-02-19T22:00:00Z', always)).toBe(true)
    expect(karachi('2026-02-19T07:00:00Z', always)).toBe(true)
  })

  /**
   * A typo in a settings field should not take down every reminder the clinic
   * sends, so an unparseable bound falls back to the default rather than
   * throwing or refusing everything.
   */
  it('falls back to the default when a bound is unreadable', () => {
    expect(karachi('2026-02-19T07:00:00Z', { start: 'nine', end: 'nine' } as never)).toBe(true)
    expect(karachi('2026-02-19T22:00:00Z', { start: 'nine', end: 'nine' } as never)).toBe(false)
    expect(isWithinSendWindow('Asia/Karachi', null, at('2026-02-19T07:00:00Z'))).toBe(true)
  })

  it('applies the same window in whatever zone the clinic is in', () => {
    // 04:30 UTC is 09:30 in Karachi and 10:00 in Kolkata: inside for both.
    expect(isWithinSendWindow('Asia/Karachi', null, at('2026-02-19T04:30:00Z'))).toBe(true)
    expect(isWithinSendWindow('Asia/Kolkata', null, at('2026-02-19T04:30:00Z'))).toBe(true)
    // 03:45 UTC is 08:45 in Karachi (outside) and 09:15 in Kolkata (inside).
    expect(isWithinSendWindow('Asia/Karachi', null, at('2026-02-19T03:45:00Z'))).toBe(false)
    expect(isWithinSendWindow('Asia/Kolkata', null, at('2026-02-19T03:45:00Z'))).toBe(true)
  })
})

describe('describeSendWindow', () => {
  it('reads back what will be enforced, for the message on the refusal', () => {
    expect(describeSendWindow({ start: '08:00', end: '18:00' })).toBe('08:00–18:00')
    expect(describeSendWindow(null)).toBe('09:00–21:00')
    expect(describeSendWindow({ start: 'nope', end: '18:00' })).toBe('09:00–18:00')
  })
})
