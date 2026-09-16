/**
 * GET /api/cron/reminders — when a reminder is queued for.
 *
 * This route is why appointments became instants. It read `scheduledDate`, a
 * `@db.Date` column holding midnight, and subtracted an hour: a 15:00
 * appointment was reminded about at 23:00 the night before, sixteen hours early
 * and two hours after the send window had closed. Its window filter,
 * `scheduledDate >= now`, compared midnight against the current time, so every
 * appointment later today was skipped by any run after 00:00.
 *
 * Both are arithmetic on the start instant now, and the assertions below are
 * written as the moment the patient's phone should buzz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import { GET } from '@/app/api/cron/reminders/route'
import { prisma } from '@/lib/prisma'
import { instantAt } from '@/lib/appointment-time'

const KARACHI = 'Asia/Karachi'
const SECRET = 'test-cron-secret'

/** 15:00 on 20 September in Karachi — 10:00 UTC. */
const APPOINTMENT_AT = instantAt('2026-09-20', '15:00', KARACHI)!

function request(secret: string | null = SECRET) {
  return new Request('http://localhost/api/cron/reminders', {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  })
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apt-1',
    hospitalId: 'h1',
    patientId: 'p1',
    startsAt: APPOINTMENT_AT,
    status: 'SCHEDULED',
    patient: { id: 'p1', firstName: 'Ayesha', lastName: 'Khan', phone: '3001234567' },
    ...overrides,
  }
}

const queuedFor = () =>
  vi
    .mocked(prisma.messageLog.create)
    .mock.calls.map((c) => (c[0]!.data as any).scheduledFor as Date)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  process.env.CRON_SECRET = SECRET
  vi.mocked(prisma.appointment.findMany).mockResolvedValue([appointment()] as never)
  vi.mocked(prisma.appointment.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.messageLog.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'm1' } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('authentication', () => {
  it('refuses a caller without the secret', async () => {
    expect((await GET(request(null))).status).toBe(401)
    expect(prisma.appointment.findMany).not.toHaveBeenCalled()
  })

  it('refuses the wrong secret', async () => {
    expect((await GET(request('not-it'))).status).toBe(401)
  })
})

describe('when the reminder is queued for', () => {
  it('queues the day-before reminder 24 hours before the appointment', async () => {
    // Two days out, so the reminder is still ahead of `now`.
    vi.setSystemTime(new Date('2026-09-19T06:00:00Z'))

    const res = await GET(request())

    expect(res.status).toBe(200)
    expect(queuedFor()).toHaveLength(1)
    // 10:00 UTC on the 20th, less 24 hours — not an hour before midnight, and
    // not on the day before at 23:00.
    expect(queuedFor()[0].toISOString()).toBe('2026-09-19T10:00:00.000Z')
  })

  it('finds an appointment later today, which the date-column filter skipped', async () => {
    // 07:00 UTC on the day of a 10:00 UTC appointment: the old filter compared
    // the appointment's midnight against now and dropped it.
    vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))

    await GET(request())

    const where = vi.mocked(prisma.appointment.findMany).mock.calls[0][0]!.where as any
    expect(where.startsAt.gte.toISOString()).toBe('2026-09-20T07:00:00.000Z')
    expect(APPOINTMENT_AT >= where.startsAt.gte && APPOINTMENT_AT <= where.startsAt.lte).toBe(true)
  })

  it('does not queue a reminder whose moment has already gone', async () => {
    // Three hours before the appointment: the day-before reminder is in the
    // past, and queueing it would have the dispatcher send it immediately.
    vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))

    const body = await (await GET(request())).json()

    expect(prisma.messageLog.create).not.toHaveBeenCalled()
    expect(body.created).toBe(0)
  })

  it('adds a second nudge three hours before for a patient who does not turn up', async () => {
    vi.setSystemTime(new Date('2026-09-19T06:00:00Z'))
    vi.mocked(prisma.appointment.groupBy)
      // no-shows
      .mockResolvedValueOnce([{ patientId: 'p1', _count: 2 }] as never)
      // past appointments
      .mockResolvedValueOnce([{ patientId: 'p1', _count: 4 }] as never)

    const body = await (await GET(request())).json()

    expect(body.extraReminders).toBe(1)
    expect(
      queuedFor()
        .map((d) => d.toISOString())
        .sort()
    ).toEqual(['2026-09-19T10:00:00.000Z', '2026-09-20T07:00:00.000Z'])
  })

  it('does not queue the same reminder twice', async () => {
    vi.setSystemTime(new Date('2026-09-19T06:00:00Z'))
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      { relatedId: 'apt-1', scheduledFor: new Date('2026-09-19T10:00:00.000Z') },
    ] as never)

    await GET(request())

    expect(prisma.messageLog.create).not.toHaveBeenCalled()
  })

  // Keyed by appointment alone, any existing reminder suppressed every other
  // one — a sent 24-hour reminder cancelled the three-hour nudge behind it.
  it('does not let one reminder suppress a different one', async () => {
    vi.setSystemTime(new Date('2026-09-19T06:00:00Z'))
    vi.mocked(prisma.appointment.groupBy)
      .mockResolvedValueOnce([{ patientId: 'p1', _count: 2 }] as never)
      .mockResolvedValueOnce([{ patientId: 'p1', _count: 4 }] as never)
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      { relatedId: 'apt-1', scheduledFor: new Date('2026-09-19T10:00:00.000Z') },
    ] as never)

    await GET(request())

    expect(queuedFor().map((d) => d.toISOString())).toEqual(['2026-09-20T07:00:00.000Z'])
  })

  it('queues against the patient phone and says what the message is for', async () => {
    vi.setSystemTime(new Date('2026-09-19T06:00:00Z'))

    await GET(request())

    expect(vi.mocked(prisma.messageLog.create).mock.calls[0][0]!.data).toMatchObject({
      hospitalId: 'h1',
      recipient: '3001234567',
      relatedType: 'Appointment',
      relatedId: 'apt-1',
      status: 'PENDING',
      // The wording is rendered at send time, not frozen here.
      body: '',
      metadata: { kind: 'appointmentReminders' },
    })
  })
})
