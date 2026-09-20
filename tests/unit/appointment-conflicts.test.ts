/**
 * FR-004 — overlap detection.
 *
 * The bug this replaces was narrow and easy to miss: the old check compared
 * `scheduledTime` for string equality, so it only ever caught two appointments
 * starting in the same minute. Most of the cases below would have passed the
 * old check and produced a real double-booking, so they are written as the
 * clash they represent rather than as arithmetic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import {
  intervalsOverlap,
  findAppointmentConflicts,
  getDoubleBookingPolicy,
  conflictResponseBody,
  DEFAULT_APPOINTMENT_DURATION,
} from '@/lib/appointment-conflicts'
import { instantAt } from '@/lib/appointment-time'
import { prisma } from '@/lib/prisma'

const KARACHI = 'Asia/Karachi'

/** A wall-clock time on the test's day, as the instant it refers to. */
const at = (time: string) => instantAt('2026-10-01', time, KARACHI)!

describe('intervalsOverlap', () => {
  // The exact case the old equality check missed.
  it('catches an appointment starting inside another', () => {
    expect(intervalsOverlap(at('09:15'), 30, at('09:00'), 60)).toBe(true)
  })

  it('catches an appointment the other starts inside of', () => {
    expect(intervalsOverlap(at('09:00'), 60, at('09:15'), 30)).toBe(true)
  })

  it('catches identical slots', () => {
    expect(intervalsOverlap(at('09:00'), 30, at('09:00'), 30)).toBe(true)
  })

  it('catches one slot wholly containing another', () => {
    expect(intervalsOverlap(at('09:00'), 120, at('09:30'), 15)).toBe(true)
  })

  // Booking back-to-back is the normal way to fill a day; treating it as a
  // clash would make the schedule unusable.
  it('allows back-to-back appointments', () => {
    expect(intervalsOverlap(at('09:00'), 30, at('09:30'), 30)).toBe(false)
    expect(intervalsOverlap(at('09:30'), 30, at('09:00'), 30)).toBe(false)
  })

  it('allows appointments with a gap', () => {
    expect(intervalsOverlap(at('09:00'), 30, at('11:00'), 30)).toBe(false)
  })

  it('catches an overlap of a single minute', () => {
    expect(intervalsOverlap(at('09:29'), 30, at('09:00'), 30)).toBe(true)
  })
})

function existingAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apt-existing',
    appointmentNo: 'APT00010',
    startsAt: at('09:00'),
    duration: 60,
    doctorId: 'doc-1',
    patient: { firstName: 'Sana', lastName: 'Khalid' },
    visitor: null,
    doctor: { firstName: 'Imran', lastName: 'Shah' },
    ...overrides,
  }
}

describe('findAppointmentConflicts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports an overlap on the doctor', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([existingAppointment()] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:15'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].resource).toBe('doctor')
    expect(conflicts[0].appointmentNo).toBe('APT00010')
    // The message has to say who and until when, or the front desk cannot act
    // on it without going to look the appointment up.
    expect(conflicts[0].message).toContain('Dr. Imran Shah')
    expect(conflicts[0].message).toContain('Sana Khalid')
    expect(conflicts[0].endTime).toBe('10:00')
  })

  // Chairs are gone: the clinic runs a token queue, not numbered operatories,
  // and a chair clash could only ever happen where a dentist clash already had.
  // What remains is that a *different* dentist in the same slot is not a clash.
  it('ignores an overlap on a different dentist', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ doctorId: 'doc-2' }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:30'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    expect(conflicts).toEqual([])
  })

  // A walk-in has no patient record, and the clash message still has to name
  // whoever is in the chair.
  it('names a walk-in in the clash message', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ patient: null, visitor: { name: 'Bilal Ahmed' } }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:30'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].message).toContain('Bilal Ahmed')
  })

  it('returns nothing when the slots merely touch', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ duration: 30 }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:30'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    expect(conflicts).toEqual([])
  })

  // The overlap test runs in memory, so the SQL window has to be wide enough to
  // hand it every appointment that could overlap. The widest miss is a long
  // appointment that began well before this one: a 480-minute booking starting
  // at 09:00 still occupies 16:30, and a window of "starts after this one
  // starts" would never have fetched it.
  it('catches a long appointment that started hours earlier', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ duration: 480 }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('16:30'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].endTime).toBe('17:00')

    const where = vi.mocked(prisma.appointment.findMany).mock.calls[0][0]!.where as any
    expect(where.startsAt.gte.toISOString()).toBe(at('08:30').toISOString())
    expect(where.startsAt.lt.toISOString()).toBe(at('17:00').toISOString())
  })

  // An appointment crossing clinic midnight would report an end time of
  // "24:30" if the end were computed as minutes since midnight.
  it('words an overnight clash with a real time', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ startsAt: at('23:45'), duration: 60 }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('23:50'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    expect(conflicts[0].endTime).toBe('00:45')
  })

  it('excludes the appointment being rescheduled', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)

    await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:15'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
      excludeAppointmentId: 'apt-existing',
    })

    expect(vi.mocked(prisma.appointment.findMany).mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({ id: { not: 'apt-existing' } }),
    })
  })

  it('ignores cancelled, no-show and rescheduled appointments', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)

    await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:00'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    const where = vi.mocked(prisma.appointment.findMany).mock.calls[0][0]!.where as any
    expect(where.status.notIn).toEqual(['CANCELLED', 'NO_SHOW', 'RESCHEDULED'])
  })

  it('scopes the search to the clinic', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)

    await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:00'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    expect((vi.mocked(prisma.appointment.findMany).mock.calls[0][0]!.where as any).hospitalId).toBe(
      'h1'
    )
  })

  // Without a doctor or a chair there is no resource to contend for, and the
  // query would otherwise return the clinic's whole day.
  it('does not query at all when neither resource is given', async () => {
    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:00'),
      timezone: KARACHI,
      duration: 30,
    })

    expect(conflicts).toEqual([])
    expect(prisma.appointment.findMany).not.toHaveBeenCalled()
  })

  // A clash is worded from the appointment it clashes with, and that
  // appointment may belong to a walk-in with no name on file at all.
  it('survives an appointment with neither a patient nor a named visitor', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ patient: null, visitor: null }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      startsAt: at('09:15'),
      timezone: KARACHI,
      duration: 30,
      doctorId: 'doc-1',
    })

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].message).toContain('Unknown')
  })
})

describe('getDoubleBookingPolicy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('blocks by default when the clinic has never configured it', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue(null as never)
    await expect(getDoubleBookingPolicy('h1')).resolves.toBe('BLOCK')
  })

  it('warns when the clinic has chosen to allow overbooking', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: 'WARN' } as never)
    await expect(getDoubleBookingPolicy('h1')).resolves.toBe('WARN')
  })

  // A typo in the settings table must not silently disable the protection.
  it('blocks on any unrecognised value', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: 'allow' } as never)
    await expect(getDoubleBookingPolicy('h1')).resolves.toBe('BLOCK')
  })
})

describe('conflictResponseBody', () => {
  it('uses the single clash as the error message', () => {
    const body = conflictResponseBody([{ message: 'Dr. X is busy' } as never])
    expect(body.error).toBe('Dr. X is busy')
  })

  it('counts multiple clashes', () => {
    const body = conflictResponseBody([{ message: 'a' }, { message: 'b' }] as never)
    expect(body.error).toContain('2 existing appointments')
    expect(body.conflicts).toHaveLength(2)
  })
})

describe('DEFAULT_APPOINTMENT_DURATION', () => {
  // Self-service bookings are checked against this length and then created with
  // it. If the two ever diverge, the portal validates a slot it does not book.
  it('is the 30 minutes the schema defaults to', () => {
    expect(DEFAULT_APPOINTMENT_DURATION).toBe(30)
  })
})
