/**
 * The rules a patient books under.
 *
 * This directory is the patient-facing half of the application and it is kept
 * apart from the clinic's half on purpose. Nobody is signed in here. There is
 * no session, no role, no capability, no tenant resolved from a token — a
 * clinic is identified by the slug in the URL and nothing else, and everything
 * the code may do is bounded by what a stranger on the internet may do.
 *
 * That boundary is why these rules exist at all. The desk books inside a
 * building, under supervision, and may legitimately squeeze somebody into a
 * gap at ten minutes' notice or pencil them in for next March. A stranger on a
 * public web page may not, and the difference is not a permission — it is a
 * different set of rules for a different situation, which is why they live in
 * their own file rather than as flags threaded through the staff booking code.
 */
import type { PrismaClient, Prisma } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export interface BookingSettings {
  /**
   * How far ahead of the slot a patient must book.
   *
   * Somebody booking a slot forty minutes from now is a person who will not
   * arrive in time and a dentist who has not been told. The desk can still
   * take that booking; the website cannot.
   */
  minimumNoticeHours: number
  /**
   * How far ahead bookings are accepted.
   *
   * A public page with no horizon is a page where somebody books for 2031 and
   * the clinic carries the row for six years.
   */
  horizonDays: number
  /**
   * Open online bookings allowed against one phone number.
   *
   * The only abuse control on an unauthenticated write. Not a rate limit —
   * there is none in this application, and that is recorded as outstanding in
   * docs/ROADMAP.md — but it does stop one number filling a week of a
   * dentist's diary, which is the damage that is actually available here.
   */
  maxOpenPerPhone: number
}

export const DEFAULT_BOOKING: BookingSettings = {
  minimumNoticeHours: 2,
  horizonDays: 60,
  maxOpenPerPhone: 3,
}

export const BOOKING_KEYS = {
  minimumNoticeHours: 'booking.minimumNoticeHours',
  horizonDays: 'booking.horizonDays',
  maxOpenPerPhone: 'booking.maxOpenPerPhone',
} as const

export const BOOKING_CATEGORY = 'booking'

function asNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback
  let value: unknown = raw
  try {
    value = JSON.parse(raw)
  } catch {
    // A bare value, written by something other than the settings route.
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), min), max)
}

export async function readBookingSettings(db: Db, hospitalId: string): Promise<BookingSettings> {
  const rows = await db.setting.findMany({
    where: { hospitalId, key: { in: Object.values(BOOKING_KEYS) } },
    select: { key: true, value: true },
  })

  const stored = new Map(rows.map((row) => [row.key, row.value]))

  return {
    minimumNoticeHours: asNumber(
      stored.get(BOOKING_KEYS.minimumNoticeHours),
      DEFAULT_BOOKING.minimumNoticeHours,
      0,
      72
    ),
    horizonDays: asNumber(
      stored.get(BOOKING_KEYS.horizonDays),
      DEFAULT_BOOKING.horizonDays,
      1,
      365
    ),
    maxOpenPerPhone: asNumber(
      stored.get(BOOKING_KEYS.maxOpenPerPhone),
      DEFAULT_BOOKING.maxOpenPerPhone,
      1,
      20
    ),
  }
}

export type WindowRefusal = 'too_soon' | 'too_far'

/**
 * Whether a patient may book this instant, or why not.
 *
 * Returns null when it is fine. The two refusals are separate because they need
 * different words on screen: "that is too soon, please telephone us" is an
 * invitation to ring, and "we are not taking bookings that far ahead" is not.
 */
export function windowRefusal(
  startsAt: Date,
  settings: BookingSettings,
  now: Date = new Date()
): WindowRefusal | null {
  const noticeMs = settings.minimumNoticeHours * 60 * 60 * 1000
  if (startsAt.getTime() - now.getTime() < noticeMs) return 'too_soon'

  const horizonMs = settings.horizonDays * 24 * 60 * 60 * 1000
  if (startsAt.getTime() - now.getTime() > horizonMs) return 'too_far'

  return null
}

/** What the person is told, per refusal. */
export const WINDOW_MESSAGES: Record<WindowRefusal, (settings: BookingSettings) => string> = {
  too_soon: (settings) =>
    `Online bookings need at least ${settings.minimumNoticeHours} hour${
      settings.minimumNoticeHours === 1 ? '' : 's'
    }' notice. Please telephone the clinic for anything sooner.`,
  too_far: (settings) =>
    `We are taking bookings up to ${settings.horizonDays} days ahead. Please choose an earlier date.`,
}

/**
 * The first and last day the date picker should offer.
 *
 * Calendar days in the clinic's own zone, because that is what the picker
 * shows and what the slots endpoint expects.
 */
export function bookableDays(
  settings: BookingSettings,
  isoDayIn: (at: Date) => string,
  now: Date = new Date()
): { first: string; last: string } {
  const earliest = new Date(now.getTime() + settings.minimumNoticeHours * 60 * 60 * 1000)
  const latest = new Date(now.getTime() + settings.horizonDays * 24 * 60 * 60 * 1000)
  return { first: isoDayIn(earliest), last: isoDayIn(latest) }
}
