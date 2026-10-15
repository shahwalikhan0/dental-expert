import type { PrismaClient, Prisma } from '@prisma/client'
import { availabilityFrom } from '@/lib/appointment-availability'
import { readAppointmentSettings } from '@/lib/appointment-settings'
import { BLOCKING_STATUSES_EXCLUDED } from '@/lib/appointment-conflicts'
import { dayRangeIn, wallClockIn } from '@/lib/appointment-time'
import { appliesOn, type AvailabilityRow } from '@/lib/availability'
import { CLINICIAN_WHERE } from '@/lib/clinicians'
import { subjectName } from '@/lib/visitors'
import { hoursOn, minutesOf, timeOf } from '@/lib/working-hours'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Who is free when, and how many patients each clinician saw.
 *
 * The slot picker answers "can Dr Ahmed take somebody at 11:00?" one dentist
 * and one day at a time. A clinic planning its day asks the other way round:
 * across everybody who sees patients, dentists and assistants alike, where are
 * the gaps, and how busy was each hour. This module answers that with the same
 * rules booking uses (lib/appointment-availability.ts), so a slot shown free
 * here is one the booking form will accept.
 */

/**
 * A visit counts as seen once the patient has arrived: checked in, in the
 * chair, or done. Walk-ins are appointments too, so they count. Booked visits
 * still to come, cancellations and no-shows do not.
 */
export const SEEN_STATUSES = ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] as const

export type ClinicianKind = 'dentist' | 'assistant'

export type SlotState = 'free' | 'booked' | 'blocked' | 'past'

export interface ScheduleSlot {
  /** `HH:MM` on the clinic's wall clock. */
  time: string
  state: SlotState
  /** The visit occupying it, when booked. */
  appointmentId?: string
  patientName?: string
  status?: string
  /** Why it is blocked: "the lunch break", "a closure". */
  what?: string
}

export interface ScheduleVisit {
  id: string
  time: string
  duration: number
  status: string
  patientName: string
  /** What this clinician is on the visit as. */
  role: ClinicianKind
}

export interface ClinicianDay {
  id: string
  name: string
  kind: ClinicianKind
  specialization: string | null
  /** Why they cannot be booked at all today — a holiday, leave, the clinic shut. */
  closed: string | null
  /** Their hours today: their own shift if they have one, else the clinic's. */
  open: string | null
  close: string | null
  /** True when `open`–`close` is their own shift rather than the clinic's hours. */
  ownShift: boolean
  slots: ScheduleSlot[]
  visits: ScheduleVisit[]
  counts: { free: number; booked: number; seen: number; visits: number }
}

export interface ClinicSchedule {
  day: string
  /** The clinic's today, so a screen can tell past slots from free ones. */
  today: string
  slotMinutes: number
  clinicians: ClinicianDay[]
}

const AVAILABILITY_SELECT = {
  id: true,
  staffId: true,
  dayOfWeek: true,
  date: true,
  startTime: true,
  endTime: true,
  isAvailable: true,
  name: true,
  isRecurring: true,
} as const

const CLINICIAN_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  specialization: true,
  user: { select: { role: true, clinicalRole: true } },
} as const

function kindOf(user: { role: string; clinicalRole: string | null }): ClinicianKind {
  return user.role === 'DOCTOR' || user.clinicalRole === 'DOCTOR' ? 'dentist' : 'assistant'
}

function nameOf(staff: { firstName: string; lastName: string }, kind: ClinicianKind): string {
  const name = `${staff.firstName} ${staff.lastName}`.trim()
  return kind === 'dentist' ? `Dr. ${name}` : name
}

/** Dentists first, then assistants, each by first name. */
function byKindThenName(a: { kind: ClinicianKind; name: string }, b: typeof a) {
  if (a.kind !== b.kind) return a.kind === 'dentist' ? -1 : 1
  return a.name.replace(/^Dr\. /, '').localeCompare(b.name.replace(/^Dr\. /, ''))
}

async function activeClinicians(db: Db, hospitalId: string) {
  const staff = await db.staff.findMany({
    where: { hospitalId, ...CLINICIAN_WHERE },
    select: CLINICIAN_SELECT,
  })
  return staff
    .map((s) => {
      const kind = kindOf(s.user)
      return { id: s.id, name: nameOf(s, kind), kind, specialization: s.specialization }
    })
    .sort(byKindThenName)
}

/** Everybody who sees patients, and their day as bookable slots. */
export async function clinicSchedule(
  db: Db,
  hospitalId: string,
  day: string,
  timezone: string
): Promise<ClinicSchedule> {
  const [clinicians, hospital, settings, rows, appointments] = await Promise.all([
    activeClinicians(db, hospitalId),
    db.hospital.findUnique({ where: { id: hospitalId }, select: { workingHours: true } }),
    readAppointmentSettings(db, hospitalId),
    // Every closure, shift and day of leave that could bear on the day, for
    // everybody at once; matched per person below.
    db.availability.findMany({
      where: {
        hospitalId,
        OR: [
          { dayOfWeek: new Date(`${day}T00:00:00Z`).getUTCDay() },
          { date: new Date(`${day}T00:00:00.000Z`) },
          { isRecurring: true },
        ],
      },
      select: AVAILABILITY_SELECT,
    }) as Promise<AvailabilityRow[]>,
    db.appointment.findMany({
      where: {
        hospitalId,
        startsAt: dayRangeIn(day, timezone),
        status: { notIn: [...BLOCKING_STATUSES_EXCLUDED] },
      },
      select: {
        id: true,
        startsAt: true,
        duration: true,
        status: true,
        doctorId: true,
        assistantId: true,
        patient: { select: { firstName: true, lastName: true } },
        visitor: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
    }),
  ])

  const now = wallClockIn(new Date(), timezone)
  const isToday = now.scheduledDate === day
  const nowMinutes = minutesOf(now.scheduledTime)
  const step = Math.max(5, settings.slotDuration)
  const buffer = Math.max(0, settings.bufferTime)

  const visits = appointments.map((a) => ({
    id: a.id,
    doctorId: a.doctorId,
    assistantId: a.assistantId,
    time: wallClockIn(a.startsAt, timezone).scheduledTime,
    duration: a.duration,
    status: a.status,
    patientName: subjectName(a),
  }))

  const result = clinicians.map((clinician): ClinicianDay => {
    const own = visits
      .filter((v) => v.doctorId === clinician.id || v.assistantId === clinician.id)
      .map((v): ScheduleVisit => ({
        id: v.id,
        time: v.time,
        duration: v.duration,
        status: v.status,
        patientName: v.patientName,
        role: v.doctorId === clinician.id ? 'dentist' : 'assistant',
      }))
    const seen = own.filter((v) => (SEEN_STATUSES as readonly string[]).includes(v.status)).length

    const availability = availabilityFrom({
      workingHours: hospital?.workingHours,
      settings,
      rows: rows.filter((row) => appliesOn(row, day)),
      day,
      staffId: clinician.id,
    })

    const base = { ...clinician, visits: own }
    if (availability.closed || !availability.hours) {
      return {
        ...base,
        closed: availability.closed,
        open: null,
        close: null,
        ownShift: false,
        slots: [],
        counts: { free: 0, booked: 0, seen, visits: own.length },
      }
    }

    const open = availability.shift?.startTime ?? availability.hours.open
    const close = availability.shift?.endTime ?? availability.hours.close
    const slots: ScheduleSlot[] = []
    for (let start = minutesOf(open); start + step <= minutesOf(close); start += step) {
      const end = start + step
      const visit = own.find((v) => {
        const from = minutesOf(v.time)
        return start < from + v.duration + buffer && from < end
      })
      const block = availability.blocked.find(
        (b) => start < minutesOf(b.end) && minutesOf(b.start) < end
      )
      const time = timeOf(start)
      if (visit) {
        slots.push({
          time,
          state: 'booked',
          appointmentId: visit.id,
          patientName: visit.patientName,
          status: visit.status,
        })
      } else if (block) {
        slots.push({ time, state: 'blocked', what: block.what })
      } else if (isToday && start <= nowMinutes) {
        slots.push({ time, state: 'past' })
      } else {
        slots.push({ time, state: 'free' })
      }
    }

    return {
      ...base,
      closed: null,
      open,
      close,
      ownShift: !!availability.shift,
      slots,
      counts: {
        free: slots.filter((s) => s.state === 'free').length,
        booked: slots.filter((s) => s.state === 'booked').length,
        seen,
        visits: own.length,
      },
    }
  })

  return { day, today: now.scheduledDate, slotMinutes: step, clinicians: result }
}

export interface SeenClinician {
  id: string
  name: string
  kind: ClinicianKind
  total: number
  /** Patients seen on each of `days`, in order. */
  byDay: number[]
  /** Patients seen in each of `hours`, in order, over the whole range. */
  byHour: number[]
}

export interface SeenCounts {
  days: string[]
  /** Hours of the day shown, `9` for 09:00–10:00. */
  hours: number[]
  /** Patients seen at the clinic, by day then hour: `grid[day][hour]`. */
  grid: number[][]
  total: number
  clinicians: SeenClinician[]
}

function addDays(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + by)
  return date.toISOString().slice(0, 10)
}

/**
 * Patients seen per hour, per day, and per clinician, over `days` days from
 * `from`. A visit counts once for the clinic, and once each for its dentist and
 * its assistant.
 */
export async function seenCounts(
  db: Db,
  hospitalId: string,
  from: string,
  dayCount: number,
  timezone: string
): Promise<SeenCounts> {
  const days = Array.from({ length: dayCount }, (_, index) => addDays(from, index))

  const [clinicians, hospital, visits] = await Promise.all([
    activeClinicians(db, hospitalId),
    db.hospital.findUnique({ where: { id: hospitalId }, select: { workingHours: true } }),
    db.appointment.findMany({
      where: {
        hospitalId,
        startsAt: dayRangeIn(from, timezone, dayCount),
        status: { in: [...SEEN_STATUSES] },
      },
      select: { startsAt: true, doctorId: true, assistantId: true },
    }),
  ])

  const placed = visits.map((v) => {
    const clock = wallClockIn(v.startsAt, timezone)
    return {
      dayIndex: days.indexOf(clock.scheduledDate),
      hour: Number(clock.scheduledTime.slice(0, 2)),
      doctorId: v.doctorId,
      assistantId: v.assistantId,
    }
  })

  // The opening hours across the range, widened to any hour somebody was seen
  // in, so an early emergency is not cut off the chart.
  let first = 24
  let last = -1
  for (const day of days) {
    const hours = hoursOn(hospital?.workingHours, day)
    if (!hours) continue
    first = Math.min(first, Math.floor(minutesOf(hours.open) / 60))
    last = Math.max(last, Math.ceil(minutesOf(hours.close) / 60) - 1)
  }
  for (const p of placed) {
    first = Math.min(first, p.hour)
    last = Math.max(last, p.hour)
  }
  if (last < first) {
    first = 9
    last = 20
  }
  const hours = Array.from({ length: last - first + 1 }, (_, index) => first + index)

  const grid = days.map(() => hours.map(() => 0))
  const perClinician = new Map(
    clinicians.map((c) => [
      c.id,
      { ...c, total: 0, byDay: days.map(() => 0), byHour: hours.map(() => 0) },
    ])
  )

  for (const p of placed) {
    if (p.dayIndex < 0) continue
    const hourIndex = p.hour - first
    grid[p.dayIndex][hourIndex] += 1
    for (const id of new Set([p.doctorId, p.assistantId])) {
      const clinician = id ? perClinician.get(id) : undefined
      if (!clinician) continue
      clinician.total += 1
      clinician.byDay[p.dayIndex] += 1
      clinician.byHour[hourIndex] += 1
    }
  }

  return {
    days,
    hours,
    grid,
    total: placed.filter((p) => p.dayIndex >= 0).length,
    clinicians: [...perClinician.values()],
  }
}
