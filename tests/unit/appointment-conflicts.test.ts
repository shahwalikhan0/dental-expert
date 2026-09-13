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
  timeToMinutes,
  minutesToTime,
  findAppointmentConflicts,
  getDoubleBookingPolicy,
  conflictResponseBody,
  DEFAULT_APPOINTMENT_DURATION,
} from '@/lib/appointment-conflicts'
import { prisma } from '@/lib/prisma'

describe('timeToMinutes / minutesToTime', () => {
  it('converts a time to minutes since midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('23:59')).toBe(1439)
  })

  it('round-trips', () => {
    expect(minutesToTime(timeToMinutes('14:45'))).toBe('14:45')
  })

  it('pads single-digit hours and minutes', () => {
    expect(minutesToTime(545)).toBe('09:05')
  })

  // An appointment that runs past midnight would otherwise report an end time
  // like "24:30", which is not a time.
  it('wraps an end time past midnight', () => {
    expect(minutesToTime(timeToMinutes('23:45') + 60)).toBe('00:45')
  })
})

describe('intervalsOverlap', () => {
  // The exact case the old equality check missed.
  it('catches an appointment starting inside another', () => {
    expect(intervalsOverlap('09:15', 30, '09:00', 60)).toBe(true)
  })

  it('catches an appointment the other starts inside of', () => {
    expect(intervalsOverlap('09:00', 60, '09:15', 30)).toBe(true)
  })

  it('catches identical slots', () => {
    expect(intervalsOverlap('09:00', 30, '09:00', 30)).toBe(true)
  })

  it('catches one slot wholly containing another', () => {
    expect(intervalsOverlap('09:00', 120, '09:30', 15)).toBe(true)
  })

  // Booking back-to-back is the normal way to fill a day; treating it as a
  // clash would make the schedule unusable.
  it('allows back-to-back appointments', () => {
    expect(intervalsOverlap('09:00', 30, '09:30', 30)).toBe(false)
    expect(intervalsOverlap('09:30', 30, '09:00', 30)).toBe(false)
  })

  it('allows appointments with a gap', () => {
    expect(intervalsOverlap('09:00', 30, '11:00', 30)).toBe(false)
  })

  it('catches an overlap of a single minute', () => {
    expect(intervalsOverlap('09:29', 30, '09:00', 30)).toBe(true)
  })
})

const DATE = new Date('2026-10-01T00:00:00.000Z')

function existingAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apt-existing',
    appointmentNo: 'APT00010',
    scheduledTime: '09:00',
    duration: 60,
    doctorId: 'doc-1',
    chairId: 'chair-1',
    patient: { firstName: 'Sana', lastName: 'Khalid' },
    doctor: { firstName: 'Imran', lastName: 'Shah' },
    chair: { name: 'Chair 1' },
    ...overrides,
  }
}

describe('findAppointmentConflicts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports an overlap on the doctor', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([existingAppointment()] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      scheduledDate: DATE,
      scheduledTime: '09:15',
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

  it('reports an overlap on the chair even with a different doctor', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ doctorId: 'doc-2' }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      scheduledDate: DATE,
      scheduledTime: '09:30',
      duration: 30,
      doctorId: 'doc-1',
      chairId: 'chair-1',
    })

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].resource).toBe('chair')
    expect(conflicts[0].message).toContain('Chair 1')
  })

  // Booking the same dentist into the same chair twice is one appointment but
  // two distinct problems, and a message naming only one of them is confusing.
  it('reports the doctor and the chair separately when both clash', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([existingAppointment()] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      scheduledDate: DATE,
      scheduledTime: '09:30',
      duration: 30,
      doctorId: 'doc-1',
      chairId: 'chair-1',
    })

    expect(conflicts.map((c) => c.resource).sort()).toEqual(['chair', 'doctor'])
  })

  it('returns nothing when the slots merely touch', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ duration: 30 }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      scheduledDate: DATE,
      scheduledTime: '09:30',
      duration: 30,
      doctorId: 'doc-1',
      chairId: 'chair-1',
    })

    expect(conflicts).toEqual([])
  })

  it('excludes the appointment being rescheduled', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)

    await findAppointmentConflicts({
      hospitalId: 'h1',
      scheduledDate: DATE,
      scheduledTime: '09:15',
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
      scheduledDate: DATE,
      scheduledTime: '09:00',
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
      scheduledDate: DATE,
      scheduledTime: '09:00',
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
      scheduledDate: DATE,
      scheduledTime: '09:00',
      duration: 30,
    })

    expect(conflicts).toEqual([])
    expect(prisma.appointment.findMany).not.toHaveBeenCalled()
  })

  it('survives an appointment whose chair record is missing', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      existingAppointment({ chair: null }),
    ] as never)

    const conflicts = await findAppointmentConflicts({
      hospitalId: 'h1',
      scheduledDate: DATE,
      scheduledTime: '09:15',
      duration: 30,
      chairId: 'chair-1',
    })

    expect(conflicts[0].message).toContain('This chair')
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
