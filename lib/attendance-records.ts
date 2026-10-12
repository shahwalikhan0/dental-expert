import { prisma } from '@/lib/prisma'
import type { AttendanceStatus, Prisma, Role } from '@prisma/client'
import { DEFAULT_TIMEZONE, clinicTimezone, localDay } from '@/lib/appointment-time'
import { ALL_ROLES } from '@/lib/rbac'
import { appliesOn, closureOn, type AvailabilityRow } from '@/lib/availability'
import {
  daysBetween,
  summarise,
  type AttendanceMark,
  type AttendanceSummary,
  type RegisterCell,
} from '@/lib/attendance'

/**
 * The attendance register, read and written.
 *
 * Server-only — this opens the database. Client components take their labels
 * and day arithmetic from `lib/attendance.ts`.
 *
 * A cell's state is worked out here, once, from three facts: the clinic's
 * holidays and each person's booked leave (both `Availability` rows), when the
 * person joined, and whatever has been saved.
 * The screens and the exports all read the result, so a day that is Off on the
 * register is Off in the spreadsheet too.
 */

// ────────────────────────────────────────────────────────────────────────────
// Who is on the register
// ────────────────────────────────────────────────────────────────────────────

/**
 * People whose attendance is kept.
 *
 * Active accounts that have been claimed. An invitation (no password yet) is
 * not somebody who works here yet, and the platform's own staff are not the
 * clinic's.
 */
function onRegister(hospitalId: string): Prisma.UserWhereInput {
  return { hospitalId, isActive: true, isPlatformAdmin: false, password: { not: null } }
}

/**
 * Everyone a report over a range should name: the people on the register now,
 * and anybody since deactivated who has days saved inside the range. A report
 * for March that silently dropped the receptionist who left in April would be
 * a report about the wrong clinic.
 */
function inReport(hospitalId: string, from: string, to: string): Prisma.UserWhereInput {
  return {
    hospitalId,
    isPlatformAdmin: false,
    password: { not: null },
    OR: [{ isActive: true }, { attendance: { some: { date: dateRange(from, to) } } }],
  }
}

export interface RegisterFilters {
  search?: string
  roles?: Role[]
}

/** Roles from a `?role=DOCTOR,RECEPTIONIST` parameter, ignoring anything that is not one. */
export function rolesFrom(value: string | null): Role[] {
  if (!value) return []
  const known = new Set<string>(ALL_ROLES)
  return value.split(',').filter((role): role is Role => known.has(role))
}

function filtered(base: Prisma.UserWhereInput, filters: RegisterFilters): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [base]
  const search = filters.search?.trim()
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { staff: { employeeId: { contains: search, mode: 'insensitive' } } },
      ],
    })
  }
  if (filters.roles && filters.roles.length > 0) {
    // A person holding the role as their second one is still somebody the
    // manager filtering for "Dentist" is looking for.
    and.push({ OR: [{ role: { in: filters.roles } }, { clinicalRole: { in: filters.roles } }] })
  }
  return { AND: and }
}

const PERSON = {
  id: true,
  name: true,
  email: true,
  role: true,
  clinicalRole: true,
  isActive: true,
  createdAt: true,
  staff: { select: { id: true, employeeId: true, joiningDate: true } },
} satisfies Prisma.UserSelect

type Person = Prisma.UserGetPayload<{ select: typeof PERSON }>

export interface RegisterPerson {
  id: string
  name: string
  email: string
  role: Role
  clinicalRole: Role | null
  isActive: boolean
  employeeId: string | null
  /** The first day this person can be marked. */
  joinedOn: string
}

/**
 * The first day somebody can be marked.
 *
 * Their joining date when the staff record has one, else the day the account
 * was made. A joining date entered through a date field is stored as UTC
 * midnight and is read as the calendar day it names; anything else is an
 * instant and is read on the clinic's clock.
 */
function joinedOnOf(person: Person, timezone: string): string {
  const joined = person.staff?.joiningDate
  if (joined) {
    const iso = joined.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : localDay(joined, timezone)
  }
  return localDay(person.createdAt, timezone)
}

function toRegisterPerson(person: Person, timezone: string): RegisterPerson {
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    clinicalRole: person.clinicalRole,
    isActive: person.isActive,
    employeeId: person.staff?.employeeId ?? null,
    joinedOn: joinedOnOf(person, timezone),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// The clinic's calendar
// ────────────────────────────────────────────────────────────────────────────

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

function dateRange(from: string, to: string) {
  return { gte: utcDay(from), lte: utcDay(to) }
}

const AVAILABILITY = {
  id: true,
  staffId: true,
  dayOfWeek: true,
  date: true,
  startTime: true,
  endTime: true,
  isAvailable: true,
  name: true,
  isRecurring: true,
} satisfies Prisma.AvailabilitySelect

export interface ClinicDay {
  date: string
  /** Why the clinic is shut, or null on a working day. */
  closed: string | null
}

export interface ClinicCalendar {
  timezone: string
  /** Today on the clinic's clock — the last day anybody can be marked. */
  today: string
  days: ClinicDay[]
}

/**
 * Which days in the range the clinic was open.
 *
 * Every day of the week is a working day — the clinic has no weekly day off,
 * Sunday included — so the weekday's hours in the clinic's settings play no
 * part here. Those hours govern when appointments can be booked, not whether
 * staff are on the register. Only a whole-day holiday on the calendar for
 * everybody closes a day; a holiday with times narrows the day rather than
 * closing it and does not count.
 */
export async function clinicCalendar(
  hospitalId: string,
  from: string,
  to: string
): Promise<ClinicCalendar> {
  const [hospital, holidays] = await Promise.all([
    prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { timezone: true },
    }),
    prisma.availability.findMany({
      where: {
        hospitalId,
        staffId: null,
        isAvailable: false,
        startTime: null,
        endTime: null,
        OR: [{ date: dateRange(from, to) }, { isRecurring: true }],
      },
      select: AVAILABILITY,
    }),
  ])
  const timezone = hospital?.timezone || DEFAULT_TIMEZONE

  const days = daysBetween(from, to).map((date) => {
    const holiday = closureOn(holidays as AvailabilityRow[], date)
    return { date, closed: holiday ? holiday.reason : null }
  })

  return { timezone, today: localDay(new Date(), timezone), days }
}

/**
 * Leave already booked in the staff calendar, by person and day.
 *
 * The appointment book records a dentist's day off as a whole-day
 * `Availability` row so nobody books them. The register uses the same row to
 * default that day to Absent — with the leave named as the reason — so the
 * register does not suggest Present for somebody the clinic knows is away,
 * and the manager is not asked to record twice
 * what the clinic already knows.
 */
async function bookedLeave(
  hospitalId: string,
  staffIds: string[],
  days: string[]
): Promise<Map<string, Map<string, string>>> {
  const byStaff = new Map<string, Map<string, string>>()
  if (staffIds.length === 0 || days.length === 0) return byStaff

  const rows = await prisma.availability.findMany({
    where: {
      hospitalId,
      staffId: { in: staffIds },
      isAvailable: false,
      startTime: null,
      endTime: null,
      OR: [{ date: dateRange(days[0], days[days.length - 1]) }, { isRecurring: true }],
    },
    select: AVAILABILITY,
  })

  for (const row of rows as AvailabilityRow[]) {
    if (!row.staffId || row.date === null) continue
    for (const day of days) {
      if (!appliesOn(row, day)) continue
      let theirs = byStaff.get(row.staffId)
      if (!theirs) byStaff.set(row.staffId, (theirs = new Map()))
      theirs.set(day, row.name ? `Leave: ${row.name}` : 'Leave booked in the staff calendar')
    }
  }
  return byStaff
}

// ────────────────────────────────────────────────────────────────────────────
// Cells
// ────────────────────────────────────────────────────────────────────────────

export interface SavedDay {
  status: AttendanceStatus
  note: string | null
  markedBy: string | null
  markedAt: Date
}

function cellFor(
  day: ClinicDay,
  today: string,
  joinedOn: string,
  saved: SavedDay | undefined,
  leave: string | undefined
): RegisterCell {
  const { date } = day
  if (date > today) return { date, state: 'FUTURE', status: null }
  if (date < joinedOn) return { date, state: 'NOT_JOINED', status: null }
  // A saved day wins over everything, including a closed one: somebody who
  // came in on a holiday was present on a holiday.
  if (saved) {
    return {
      date,
      state: 'MARKED',
      status: saved.status,
      note: saved.note,
      ...(day.closed ? { reason: day.closed } : {}),
    }
  }
  if (day.closed) return { date, state: 'OFF', status: null, reason: day.closed }
  if (leave) return { date, state: 'DEFAULT', status: 'ABSENT', reason: leave }
  return { date, state: 'DEFAULT', status: 'PRESENT' }
}

async function savedDays(
  hospitalId: string,
  userIds: string[],
  from: string,
  to: string
): Promise<Map<string, SavedDay>> {
  const saved = new Map<string, SavedDay>()
  if (userIds.length === 0) return saved

  const rows = await prisma.attendance.findMany({
    where: { hospitalId, userId: { in: userIds }, date: dateRange(from, to) },
    select: {
      userId: true,
      date: true,
      status: true,
      note: true,
      updatedAt: true,
      markedBy: { select: { name: true } },
    },
  })
  for (const row of rows) {
    saved.set(key(row.userId, row.date.toISOString().slice(0, 10)), {
      status: row.status,
      note: row.note,
      markedBy: row.markedBy?.name ?? null,
      markedAt: row.updatedAt,
    })
  }
  return saved
}

function key(userId: string, day: string): string {
  return `${userId}|${day}`
}

// ────────────────────────────────────────────────────────────────────────────
// Reading
// ────────────────────────────────────────────────────────────────────────────

export interface RegisterRow extends RegisterPerson {
  cells: RegisterCell[]
  summary: AttendanceSummary
}

export interface Register {
  calendar: ClinicCalendar
  rows: RegisterRow[]
  total: number
}

interface RegisterQuery {
  hospitalId: string
  from: string
  to: string
  filters?: RegisterFilters
  /** Leave out this person — the manager does not mark themselves. */
  excludeUserId?: string
  /** `register` is who can be marked now; `report` adds leavers with days in the range. */
  scope: 'register' | 'report'
  /** Omit for every row, which is what an export wants. */
  page?: { page: number; limit: number }
}

/**
 * One page of people, with a cell for every day in the range.
 */
export async function loadRegister(query: RegisterQuery): Promise<Register> {
  const { hospitalId, from, to, filters = {}, excludeUserId, scope, page } = query

  const base = scope === 'register' ? onRegister(hospitalId) : inReport(hospitalId, from, to)
  const where = filtered(
    excludeUserId ? { AND: [base, { id: { not: excludeUserId } }] } : base,
    filters
  )

  const [calendar, people, total] = await Promise.all([
    clinicCalendar(hospitalId, from, to),
    prisma.user.findMany({
      where,
      select: PERSON,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...(page ? { skip: (page.page - 1) * page.limit, take: page.limit } : {}),
    }),
    prisma.user.count({ where }),
  ])

  const days = calendar.days.map((day) => day.date)
  const [saved, leave] = await Promise.all([
    savedDays(
      hospitalId,
      people.map((person) => person.id),
      from,
      to
    ),
    bookedLeave(
      hospitalId,
      people.flatMap((person) => (person.staff ? [person.staff.id] : [])),
      days
    ),
  ])

  const rows = people.map((person) => {
    const who = toRegisterPerson(person, calendar.timezone)
    const theirLeave = person.staff ? leave.get(person.staff.id) : undefined
    const cells = calendar.days.map((day) =>
      cellFor(
        day,
        calendar.today,
        who.joinedOn,
        saved.get(key(person.id, day.date)),
        theirLeave?.get(day.date)
      )
    )
    return { ...who, cells, summary: summarise(cells) }
  })

  return { calendar, rows, total }
}

export interface PersonalRecordDay extends RegisterCell {
  markedBy: string | null
  markedAt: string | null
}

export interface PersonalRecord {
  person: RegisterPerson
  calendar: ClinicCalendar
  days: PersonalRecordDay[]
  summary: AttendanceSummary
}

/**
 * One person's days over a range, with who marked each one.
 *
 * Null when the person is not somebody in this clinic whose attendance is kept
 * — an unknown id, another clinic's user, an unclaimed invitation.
 */
export async function personalRecord(
  hospitalId: string,
  userId: string,
  from: string,
  to: string
): Promise<PersonalRecord | null> {
  const person = await prisma.user.findFirst({
    where: { id: userId, hospitalId, isPlatformAdmin: false, password: { not: null } },
    select: PERSON,
  })
  if (!person) return null

  const calendar = await clinicCalendar(hospitalId, from, to)
  const days = calendar.days.map((day) => day.date)
  const [saved, leave] = await Promise.all([
    savedDays(hospitalId, [person.id], from, to),
    person.staff
      ? bookedLeave(hospitalId, [person.staff.id], days)
      : Promise.resolve(new Map<string, Map<string, string>>()),
  ])

  const who = toRegisterPerson(person, calendar.timezone)
  const theirLeave = person.staff ? leave.get(person.staff.id) : undefined
  const records = calendar.days.map((day) => {
    const mark = saved.get(key(person.id, day.date))
    return {
      ...cellFor(day, calendar.today, who.joinedOn, mark, theirLeave?.get(day.date)),
      markedBy: mark?.markedBy ?? null,
      markedAt: mark?.markedAt.toISOString() ?? null,
    }
  })

  return { person: who, calendar, days: records, summary: summarise(records) }
}

// ────────────────────────────────────────────────────────────────────────────
// Writing
// ────────────────────────────────────────────────────────────────────────────

export interface MarkInput {
  userId: string
  date: string
  /** Null clears the day back to its default — Present, or Off on a closed day. */
  status: AttendanceMark | null
  /** Undefined leaves the note as it is; null clears it. */
  note?: string | null
}

export interface MarkRefusal {
  userId: string
  date: string
  reason: string
}

export interface MarkChange {
  userId: string
  name: string
  date: string
  from: AttendanceStatus | null
  to: AttendanceStatus | null
}

export type MarkResult =
  | { ok: false; refused: MarkRefusal[] }
  | {
      ok: true
      created: number
      updated: number
      cleared: number
      unchanged: number
      /** Days that already held a mark and now hold a different one, or none. */
      altered: MarkChange[]
      /** New marks that are not Present — the exceptions worth an auditor's eye. */
      exceptions: MarkChange[]
    }

/**
 * Save a batch of marks, all or nothing.
 *
 * Every mark is checked before anything is written. A manager saving a week
 * for fifty people who gets back "saved, except for three" has to work out
 * which three, and a register that is partly the old week and partly the new
 * one is worse than either.
 */
export async function applyMarks(
  hospitalId: string,
  markerId: string,
  marks: MarkInput[]
): Promise<MarkResult> {
  if (marks.length === 0) {
    return {
      ok: true,
      created: 0,
      updated: 0,
      cleared: 0,
      unchanged: 0,
      altered: [],
      exceptions: [],
    }
  }

  const userIds = [...new Set(marks.map((mark) => mark.userId))]
  const sorted = marks.map((mark) => mark.date).sort()
  const from = sorted[0]
  const to = sorted[sorted.length - 1]

  const [timezone, people, existing] = await Promise.all([
    clinicTimezone(prisma, hospitalId),
    prisma.user.findMany({
      where: { AND: [onRegister(hospitalId), { id: { in: userIds } }] },
      select: PERSON,
    }),
    prisma.attendance.findMany({
      where: { hospitalId, userId: { in: userIds }, date: dateRange(from, to) },
      select: { id: true, userId: true, date: true, status: true, note: true },
    }),
  ])
  const today = localDay(new Date(), timezone)

  const byId = new Map(people.map((person) => [person.id, toRegisterPerson(person, timezone)]))
  const held = new Map(
    existing.map((row) => [key(row.userId, row.date.toISOString().slice(0, 10)), row])
  )

  const refused: MarkRefusal[] = []
  const seen = new Set<string>()
  for (const mark of marks) {
    const person = byId.get(mark.userId)
    const at = key(mark.userId, mark.date)
    if (seen.has(at)) {
      refused.push({ ...mark, reason: 'The same day appears twice in one save' })
    } else if (mark.userId === markerId) {
      refused.push({ ...mark, reason: 'Your own attendance is marked by somebody else' })
    } else if (!person) {
      refused.push({ ...mark, reason: 'Not somebody on this clinic’s register' })
    } else if (mark.date > today) {
      refused.push({ ...mark, reason: 'That day has not happened yet' })
    } else if (mark.date < person.joinedOn) {
      refused.push({ ...mark, reason: `${person.name} had not joined yet` })
    }
    seen.add(at)
  }
  if (refused.length > 0) return { ok: false, refused }

  const creates: Prisma.AttendanceCreateManyInput[] = []
  const updatesByStatus = new Map<AttendanceStatus, string[]>()
  const noteUpdates: { id: string; status: AttendanceStatus; note: string | null }[] = []
  const clears: string[] = []
  const altered: MarkChange[] = []
  const exceptions: MarkChange[] = []
  let unchanged = 0

  for (const mark of marks) {
    const row = held.get(key(mark.userId, mark.date))
    const name = byId.get(mark.userId)!.name
    const note = mark.note === undefined ? undefined : mark.note?.trim() || null

    if (mark.status === null) {
      if (row) {
        clears.push(row.id)
        altered.push({ userId: mark.userId, name, date: mark.date, from: row.status, to: null })
      } else unchanged += 1
      continue
    }

    if (!row) {
      creates.push({
        hospitalId,
        userId: mark.userId,
        date: utcDay(mark.date),
        status: mark.status,
        note: note ?? null,
        markedById: markerId,
      })
      if (mark.status !== 'PRESENT') {
        exceptions.push({ userId: mark.userId, name, date: mark.date, from: null, to: mark.status })
      }
      continue
    }

    const statusChanged = row.status !== mark.status
    const noteChanged = note !== undefined && note !== row.note
    if (!statusChanged && !noteChanged) {
      unchanged += 1
      continue
    }
    if (statusChanged) {
      altered.push({
        userId: mark.userId,
        name,
        date: mark.date,
        from: row.status,
        to: mark.status,
      })
    }
    if (noteChanged) {
      noteUpdates.push({ id: row.id, status: mark.status, note: note ?? null })
    } else {
      const ids = updatesByStatus.get(mark.status) ?? []
      ids.push(row.id)
      updatesByStatus.set(mark.status, ids)
    }
  }

  // Grouped rather than one statement per cell: a week for fifty people is 350
  // marks, and a transaction of 350 round trips is a save button that hangs.
  await prisma.$transaction([
    ...(creates.length > 0
      ? [prisma.attendance.createMany({ data: creates, skipDuplicates: true })]
      : []),
    ...[...updatesByStatus].map(([status, ids]) =>
      prisma.attendance.updateMany({
        where: { id: { in: ids } },
        data: { status, markedById: markerId },
      })
    ),
    ...noteUpdates.map((update) =>
      prisma.attendance.update({
        where: { id: update.id },
        data: { status: update.status, note: update.note, markedById: markerId },
      })
    ),
    ...(clears.length > 0 ? [prisma.attendance.deleteMany({ where: { id: { in: clears } } })] : []),
  ])

  return {
    ok: true,
    created: creates.length,
    updated:
      noteUpdates.length + [...updatesByStatus.values()].reduce((n, ids) => n + ids.length, 0),
    cleared: clears.length,
    unchanged,
    altered,
    exceptions,
  }
}
