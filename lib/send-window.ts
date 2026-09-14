/**
 * The hours of day a clinic may text its patients.
 *
 * The rule used to be one line: 9am to 9pm **IST**, computed by adding five and
 * a half hours to UTC. That is India's TRAI restriction, hardcoded, and on a
 * Pakistani clinic it is wrong twice over — the country has no such statutory
 * window, and the offset is half an hour out, so a message sent at 9:15pm local
 * went out while one at 8:45am was refused.
 *
 * What replaces it is not a rule about any country. It is the clinic's own
 * decision about when it is acceptable to make a patient's phone buzz, applied
 * in the clinic's own timezone. The default is the same 09:00–21:00 the old
 * code enforced, because that is a reasonable thing to want; what changed is
 * that it is now the clinic's to move.
 */

/** Settings keys. Per clinic, like every other configurable. */
export const SEND_WINDOW_START_KEY = 'sms.sendWindowStart'
export const SEND_WINDOW_END_KEY = 'sms.sendWindowEnd'

export const DEFAULT_SEND_WINDOW = { start: '09:00', end: '21:00' } as const

/** Minutes since midnight, or null if this is not a HH:MM time. */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  return hours * 60 + minutes
}

/**
 * What time it is where the clinic is, in minutes since midnight.
 *
 * `Intl` rather than arithmetic on a UTC offset. An offset has to be kept in
 * step with the rules by hand — the old code's `5.5 * 60 * 60 * 1000` was
 * already half an hour wrong for Pakistan — and any country that observes
 * daylight saving makes it wrong twice a year as well.
 */
export function minutesOfDayIn(timezone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')

  // A midnight formatted as "24" by some ICU versions is 00:00 of that day.
  return (hour % 24) * 60 + minute
}

export interface SendWindow {
  start: string
  end: string
}

/**
 * Whether now is inside the window.
 *
 * Half-open at the end: a window ending 21:00 permits 20:59 and refuses 21:00,
 * so "nine in the evening" means what a person means by it.
 *
 * A window that wraps past midnight (22:00–06:00) is read as wrapping rather
 * than as empty. No clinic is likely to want one, but reading it as empty would
 * silently stop every message instead of doing the obvious thing.
 *
 * An unparseable time falls back to the default rather than throwing. A typo in
 * a settings field should not take down every reminder the clinic sends.
 */
export function isWithinSendWindow(
  timezone: string,
  window: Partial<SendWindow> | null | undefined,
  at: Date = new Date()
): boolean {
  const start = parseTimeOfDay(window?.start) ?? parseTimeOfDay(DEFAULT_SEND_WINDOW.start)!
  const end = parseTimeOfDay(window?.end) ?? parseTimeOfDay(DEFAULT_SEND_WINDOW.end)!

  // Equal bounds mean no restriction, which is how a clinic turns the window
  // off — rather than by finding a checkbox somewhere else that does the same
  // thing and can disagree with this.
  if (start === end) return true

  const now = minutesOfDayIn(timezone, at)

  return start < end ? now >= start && now < end : now >= start || now < end
}

/** For the message on the refusal, so the desk knows when it can try again. */
export function describeSendWindow(window: Partial<SendWindow> | null | undefined): string {
  const start =
    window?.start && parseTimeOfDay(window.start) !== null
      ? window.start
      : DEFAULT_SEND_WINDOW.start
  const end =
    window?.end && parseTimeOfDay(window.end) !== null ? window.end : DEFAULT_SEND_WINDOW.end
  return `${start}–${end}`
}
