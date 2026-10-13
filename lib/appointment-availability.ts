import type { PrismaClient, Prisma } from '@prisma/client'
import { hoursOn, minutesOf, type DayHours } from '@/lib/working-hours'
import { readAppointmentSettings, type AppointmentSettings } from '@/lib/appointment-settings'
import {
  blockedIntervals,
  closureOn,
  relevantOn,
  shiftOn,
  type AvailabilityRow,
  type Interval,
} from '@/lib/availability'
import { localDay, wallClockIn } from '@/lib/appointment-time'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Whether a dentist can be booked at a given time — one answer for the slot
 * picker and for the routes that write a booking.
 *
 * `/api/appointments/slots` refused holidays, closed hours and the lunch break,
 * and `POST /api/appointments` checked none of them (bug report 12 Oct,
 * finding 6). The slot picker was the only thing protecting the diary, so a
 * booking for a clinic holiday, for 23:30 with the clinic shut at 21:00, or for
 * 13:15 in the middle of lunch went straight in through the API, and a
 * reschedule went round the picker entirely. Both now ask here.
 */

/** A stretch of the day that cannot be booked, and what to call it. */
export interface Obstacle extends Interval {
  what: string
}

export interface DayAvailability {
  /** Why the whole day is shut — a holiday, the clinic's day off, leave — or null. */
  closed: string | null
  hours: DayHours | null
  /** The dentist's own shift that day, which replaces the clinic's hours when set. */
  shift: { startTime: string; endTime: string } | null
  /** Lunch, half-day closures and partial leave. */
  blocked: Obstacle[]
  settings: AppointmentSettings
}

export const CLINIC_CLOSED = 'The clinic is closed on this day'

/**
 * Everything that bears on booking `doctorId` on `day` (`YYYY-MM-DD`, the
 * clinic's calendar).
 */
export async function dayAvailability(
  db: Db,
  hospitalId: string,
  day: string,
  doctorId: string
): Promise<DayAvailability> {
  const [hospital, settings, rows] = await Promise.all([
    db.hospital.findUnique({ where: { id: hospitalId }, select: { workingHours: true } }),
    readAppointmentSettings(db, hospitalId),
    // Clinic closures and this dentist's own shifts and leave, in one query.
    db.availability.findMany({
      where: relevantOn(hospitalId, day, doctorId),
      select: {
        id: true,
        staffId: true,
        dayOfWeek: true,
        date: true,
        startTime: true,
        endTime: true,
        isAvailable: true,
        name: true,
        isRecurring: true,
      },
    }) as Promise<AvailabilityRow[]>,
  ])

  const hours = hoursOn(hospital?.workingHours, day)
  if (!hours) return { closed: CLINIC_CLOSED, hours: null, shift: null, blocked: [], settings }

  const closure = closureOn(rows, day)
  if (closure) return { closed: closure.reason, hours, shift: null, blocked: [], settings }

  const blocked: Obstacle[] = [
    ...blockedIntervals(rows, day).map((i) => ({ ...i, what: 'a closure' })),
    // The lunch break the clinic's own hours may carry for this weekday...
    ...(hours.lunch ? [{ ...hours.lunch, what: 'the lunch break' }] : []),
    // ...and the simple clinic-wide one Settings → Appointments offers.
    ...(settings.lunchBreakStart && settings.lunchBreakEnd
      ? [{ start: settings.lunchBreakStart, end: settings.lunchBreakEnd, what: 'the lunch break' }]
      : []),
  ].filter((i) => minutesOf(i.end) > minutesOf(i.start))

  return { closed: null, hours, shift: shiftOn(rows, day, doctorId), blocked, settings }
}

/**
 * Why `time` (`HH:MM`) for `duration` minutes cannot be booked on a day, or
 * null if it can. The same rules the slot generator applies, for one slot.
 */
export function timeRefusal(day: DayAvailability, time: string, duration: number): string | null {
  if (day.closed || !day.hours) return day.closed ?? CLINIC_CLOSED

  const open = day.shift?.startTime ?? day.hours.open
  const close = day.shift?.endTime ?? day.hours.close
  const start = minutesOf(time)
  const end = start + duration

  if (start < minutesOf(open) || end > minutesOf(close)) {
    const whose = day.shift ? "the dentist's hours" : 'opening hours'
    return `${time} for ${duration} minutes is outside ${whose} on this day (${open}–${close}).`
  }

  const hit = day.blocked.find((b) => start < minutesOf(b.end) && minutesOf(b.start) < end)
  if (hit) {
    return `${time} for ${duration} minutes runs into ${hit.what} (${hit.start}–${hit.end}).`
  }

  return null
}

export const PAST_REFUSAL = 'Cannot schedule appointments in the past'

/**
 * Every rule a new or moved booking must meet apart from clashes: not on a
 * past day, inside the booking horizon, and inside the dentist's open hours on
 * a day the clinic is open. Null when it may be booked.
 *
 * "In the past" means the clinic's yesterday, not the server's: a booking made
 * at 02:00 Karachi for later that morning is not in the past, however the
 * host's own clock reads.
 */
export async function scheduleRefusal(
  db: Db,
  query: {
    hospitalId: string
    doctorId: string
    startsAt: Date
    duration: number
    timezone: string
  }
): Promise<string | null> {
  const { hospitalId, doctorId, startsAt, duration, timezone } = query
  const day = localDay(startsAt, timezone)
  const now = new Date()

  if (day < localDay(now, timezone)) return PAST_REFUSAL

  const availability = await dayAvailability(db, hospitalId, day, doctorId)

  /**
   * How far ahead the desk may book.
   *
   * Counted in the clinic's own calendar days, so it agrees with the "in the
   * past" check above rather than with the server's clock. Null when the
   * clinic has never set one — see lib/appointment-settings.ts.
   */
  const ahead = availability.settings.maxAdvanceBookingDays
  if (ahead !== null) {
    const horizon = new Date(now.getTime() + ahead * 24 * 60 * 60 * 1000)
    if (day > localDay(horizon, timezone)) {
      return `Appointments can be booked up to ${ahead} days ahead. Change this at Settings → Appointments.`
    }
  }

  return timeRefusal(availability, wallClockIn(startsAt, timezone).scheduledTime, duration)
}
