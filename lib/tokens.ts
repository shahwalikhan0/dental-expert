import type { PrismaClient, Prisma } from '@prisma/client'
import { localDay } from '@/lib/appointment-time'

/**
 * Queue tokens — DDMMYY then a three-digit sequence.
 *
 * `200926001` is the first arrival on 20 September 2026. The date is in the
 * number on purpose: a token read aloud across a waiting room, written on a
 * slip, or quoted down the phone carries its own day, so yesterday's slip
 * cannot be mistaken for today's and a number alone is enough to find the
 * visit.
 *
 * Issued at check-in, never at booking. A number handed out three weeks ahead
 * describes the order bookings were made in, which is not the order anybody
 * will be seen in — people arrive early, arrive late, and do not arrive. The
 * queue a clinic actually runs is arrival order, so arrival is what mints the
 * number.
 *
 * Day boundaries are the clinic's, not the server's: a token issued at 00:30 in
 * Karachi belongs to that morning, and on a UTC host it would otherwise carry
 * the previous day's date.
 */

/** Three digits — 999 arrivals in one day is a different problem. */
const SEQUENCE_DIGITS = 3

export const TOKEN_PATTERN = /^(\d{2})(\d{2})(\d{2})(\d{3})$/

/** The DDMMYY prefix every token issued on this clinic-day shares. */
export function tokenPrefix(day: string): string {
  const [year, month, date] = day.split('-')
  return `${date}${month}${year.slice(2)}`
}

/** The date a token was issued on, as YYYY-MM-DD, or null if it is not one. */
export function tokenDay(token: string): string | null {
  const match = TOKEN_PATTERN.exec(token)
  if (!match) return null

  const [, dd, mm, yy] = match
  // Two-digit years: this is a token, not an archive key. 20xx throughout.
  return `20${yy}-${mm}-${dd}`
}

/** The sequence within the day, or null if the token is not one. */
export function tokenSequence(token: string): number | null {
  const match = TOKEN_PATTERN.exec(token)
  return match ? Number(match[4]) : null
}

/** How a token is shown — the day is in the number, but nobody reads it that way. */
export function formatToken(token: string | null | undefined): string {
  if (!token) return '—'
  const sequence = tokenSequence(token)
  return sequence === null ? token : `#${sequence}`
}

export function nextToken(prefix: string, lastToken: string | null | undefined): string {
  const last = lastToken ? (tokenSequence(lastToken) ?? 0) : 0
  return `${prefix}${String(last + 1).padStart(SEQUENCE_DIGITS, '0')}`
}

type TokenClient = PrismaClient | Prisma.TransactionClient

/**
 * Issue the next token for the clinic's today.
 *
 * Reads the highest token already issued under today's prefix and adds one.
 * `tokenNumber` is unique per clinic, so two people checking in at the same
 * instant cannot both take the same number — the second write fails and is
 * retried. Retrying is the right answer rather than serialising every check-in
 * behind a lock: collisions happen when two receptionists press the button in
 * the same moment, which is rare, and the cost of being wrong is somebody
 * holding a duplicate slip.
 */
export async function issueToken(
  db: TokenClient,
  hospitalId: string,
  timezone: string,
  at: Date = new Date()
): Promise<string> {
  const prefix = tokenPrefix(localDay(at, timezone))

  const last = await db.appointment.findFirst({
    where: { hospitalId, tokenNumber: { startsWith: prefix } },
    orderBy: { tokenNumber: 'desc' },
    select: { tokenNumber: true },
  })

  return nextToken(prefix, last?.tokenNumber)
}

/** True when the token belongs to the clinic's current day. */
export function isTokenForToday(token: string, todayInClinic: string): boolean {
  return tokenDay(token) === todayInClinic
}
