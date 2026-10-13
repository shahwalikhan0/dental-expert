/**
 * Staff rules that need the database. The rest, which the forms share, are in
 * lib/staff-rules.ts and re-exported here for the routes.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { clinicTimezone, dayRangeIn, localDay } from '@/lib/appointment-time'

export * from '@/lib/staff-rules'

type Db = PrismaClient | Prisma.TransactionClient

// ────────────────────────────────────────────────────────────────────────────
// Employee numbers
// ────────────────────────────────────────────────────────────────────────────

/**
 * The next employee number, `EMP26` and four digits.
 *
 * Shared by Add Staff and by accepting an invitation. The invitation path used
 * to count the clinic's staff and add one, which gave `EMP004` beside
 * `EMP260003`, and gave the same number twice once anybody had been removed.
 */
export async function generateEmployeeId(db: Db, hospitalId: string): Promise<string> {
  const prefix = `EMP${new Date().getFullYear().toString().slice(-2)}`

  return nextInSeries(db, {
    hospitalId,
    prefix,
    width: 4,
    currentMax: async () => {
      const last = await db.staff.findFirst({
        where: { hospitalId, employeeId: { startsWith: prefix } },
        orderBy: { employeeId: 'desc' },
        select: { employeeId: true },
      })
      return trailingNumber(last?.employeeId, 4)
    },
  })
}

/** Today, on the clinic's clock, as `2026-10-13`. */
export async function clinicToday(hospitalId: string): Promise<string> {
  return localDay(new Date(), await clinicTimezone(prisma, hospitalId))
}

// ────────────────────────────────────────────────────────────────────────────
// Deactivating somebody with patients waiting
// ────────────────────────────────────────────────────────────────────────────

/** Statuses that still need the dentist: booked, or in the building. */
const OPEN_STATUSES = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] as const

export interface OpenAppointment {
  id: string
  appointmentNo: string
  startsAt: Date
  status: string
  patient: string
}

/**
 * Today's queue and the future diary still assigned to this staff member.
 *
 * Deactivating a dentist used to leave all of it on them, silently (finding
 * 21): two patients sitting in the waiting room under a dentist who could no
 * longer sign in. From the start of the clinic's today onward, so this
 * morning's booking that has not been checked in yet still counts — the
 * patient may be on the way.
 *
 * Nothing is reassigned here. Which colleague takes which patient is a
 * decision for the desk, made on the appointments screen, and doing it
 * automatically would book patients with somebody they never chose.
 */
export async function openAppointmentsFor(
  hospitalId: string,
  staffId: string
): Promise<OpenAppointment[]> {
  const timezone = await clinicTimezone(prisma, hospitalId)
  const today = localDay(new Date(), timezone)
  const rows = await prisma.appointment.findMany({
    where: {
      hospitalId,
      doctorId: staffId,
      status: { in: [...OPEN_STATUSES] },
      startsAt: { gte: dayRangeIn(today, timezone).gte },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      appointmentNo: true,
      startsAt: true,
      status: true,
      patient: { select: { firstName: true, lastName: true } },
      visitor: { select: { name: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    appointmentNo: row.appointmentNo,
    startsAt: row.startsAt,
    status: row.status,
    patient: row.patient
      ? `${row.patient.firstName} ${row.patient.lastName}`.trim()
      : (row.visitor?.name ?? 'Walk-in'),
  }))
}

/** The 409 body for a deactivation that needs confirming. */
export function openAppointmentsRefusal(name: string, appointments: OpenAppointment[]) {
  const count = appointments.length
  return {
    error: `${name} still has ${count} appointment${count === 1 ? '' : 's'} today or later. Reassign or cancel them, or confirm to deactivate anyway.`,
    code: 'HAS_OPEN_APPOINTMENTS',
    count,
    appointments,
  }
}
