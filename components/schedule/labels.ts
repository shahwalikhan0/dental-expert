/** `9 AM`, `1 PM`: an hour on a chart axis, where `9:00 AM` will not fit. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`
}

/**
 * `9 AM`, `1:30 PM`: a `HH:MM` wall-clock time with the minutes only when they
 * matter.
 *
 * `24:00` — a closing time meaning midnight at the end of the day — reads as
 * `12 AM`. Without the wrap it came out `12 PM`, so a clinic open round the
 * clock was shown closing at noon.
 */
export function shortTime(time: string): string {
  const [hour, m] = time.split(':').map(Number)
  const h = hour % 24
  const minutes = m ? `:${String(m).padStart(2, '0')}` : ''
  return `${h % 12 || 12}${minutes} ${h >= 12 ? 'PM' : 'AM'}`
}

/**
 * A day's opening hours in words: `9 AM–8 PM`, or `Open 24 hours`.
 *
 * Midnight to midnight has no readable range — `12 AM–12 AM` says nothing, and
 * says it twice — so it is named instead.
 */
export function hoursLabel(open: string, close: string): string {
  if (open === '00:00' && close === '24:00') return 'Open 24 hours'
  return `${shortTime(open)}–${shortTime(close)}`
}

/** `9 AM–10 AM`, for an hour's accessible name. */
export function hourRange(hour: number): string {
  return `${hourLabel(hour)}–${hourLabel(hour + 1)}`
}

/** `Thu`, for a `YYYY-MM-DD` read as that calendar day wherever the browser is. */
export function weekdayShort(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  })
}

/** `15 Oct`, for a `YYYY-MM-DD`, read the same way. */
export function dayMonth(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function addDays(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + by)
  return date.toISOString().slice(0, 10)
}

/** The Sunday a week starts on, as the appointment book's week view counts it. */
export function weekStart(day: string): string {
  return addDays(day, -new Date(`${day}T00:00:00Z`).getUTCDay())
}
