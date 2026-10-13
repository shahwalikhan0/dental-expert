/**
 * PUT /api/appointments/[id] — FR-004 on the reschedule path.
 *
 * The reschedule check had the same exact-start-time flaw as booking, plus one
 * of its own: it re-checked only when the date, time or doctor changed. Making
 * an appointment longer moves the interval just as much and went entirely
 * unchecked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/services/smart-scheduler', () => ({
  handleCancellationWaitlist: vi.fn().mockResolvedValue({ matchedPatients: [] }),
}))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = { requireAuthAndRole: vi.fn() }
  const decide = async (perms: string[]) => {
    const res = await helpers.requireAuthAndRole()
    if (!res || res.error) return res
    const roles = [res.user?.role, res.session?.user?.role].filter(Boolean)
    if (roles.length === 0) return res
    if (!roles.every((r: string) => perms.every((p) => can(r, p)))) {
      return {
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return res
  }
  helpers.requirePermission = vi.fn((p: string) => decide([p]))
  helpers.requireAllPermissions = vi.fn((p: string[]) => decide(p))
  return helpers
})

import { PUT } from '@/app/api/appointments/[id]/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { instantAt } from '@/lib/appointment-time'
import { NOT_A_DENTIST } from '@/lib/clinicians'
import { INACTIVE_PATIENT } from '@/lib/appointment-status'

const params = { params: Promise.resolve({ id: 'apt-1' }) }

const KARACHI = 'Asia/Karachi'

/** A wall-clock time on the fixtures' day, as the instant it refers to. */
const at = (time: string) => instantAt('2030-06-15', time, KARACHI)!

const EXISTING = {
  id: 'apt-1',
  hospitalId: 'h1',
  doctorId: 'doc-1',
  startsAt: at('09:00'),
  duration: 30,
  status: 'SCHEDULED',
}

/** Another patient occupying 09:45–10:15 with the same doctor. */
const COLLEAGUE = {
  id: 'apt-2',
  appointmentNo: 'APT00002',
  startsAt: at('09:45'),
  duration: 30,
  doctorId: 'doc-1',
  patient: { firstName: 'Nadia', lastName: 'Aslam' },
  visitor: null,
  doctor: { firstName: 'Imran', lastName: 'Shah' },
}

function put(body: unknown) {
  return new NextRequest('http://localhost/api/appointments/apt-1', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: 'u1', role: 'RECEPTIONIST' },
  } as any)
  vi.mocked(prisma.appointment.findFirst).mockResolvedValue(EXISTING as never)
  vi.mocked(prisma.appointment.update).mockResolvedValue({ id: 'apt-1' } as never)
  vi.mocked(prisma.setting.findUnique).mockResolvedValue(null as never)
  // A move or a new dentist is checked like a booking: an active dentist, the
  // clinic open, no holiday (lib/appointment-availability.ts).
  vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'doc-1' } as never)
  vi.mocked(prisma.availability.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
    id: 'h1',
    timezone: KARACHI,
  } as never)
})

describe('PUT /api/appointments/[id] — conflicts', () => {
  it('refuses a new time that overlaps an existing appointment', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([COLLEAGUE] as never)

    const res = await PUT(put({ scheduledTime: '10:00', duration: 30 }), params)

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      conflicts: [{ resource: 'doctor' }],
    })
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  // The old check ignored duration entirely, so stretching an appointment over
  // a colleague's slot was accepted without a word.
  it('re-checks when only the duration is extended', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([COLLEAGUE] as never)

    const res = await PUT(put({ duration: 90 }), params)

    expect(res.status).toBe(409)
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  it('re-checks when only the dentist changes', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { ...COLLEAGUE, doctorId: 'doc-9', startsAt: at('09:15') },
    ] as never)

    const res = await PUT(put({ doctorId: 'doc-9' }), params)

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ conflicts: [{ resource: 'doctor' }] })
  })

  it('does not clash with itself when nothing really moves', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)

    const res = await PUT(put({ scheduledTime: '09:00' }), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.appointment.findMany).mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({ id: { not: 'apt-1' } }),
    })
  })

  it('allows a move to a genuinely free slot', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)

    const res = await PUT(put({ scheduledTime: '14:00' }), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.appointment.update).mock.calls[0][0].data).toMatchObject({
      startsAt: at('14:00'),
    })
  })

  // Cancelling must never be blocked by the slot it is vacating.
  it('skips the check when cancelling', async () => {
    const res = await PUT(put({ status: 'CANCELLED' }), params)

    expect(res.status).toBe(200)
    expect(prisma.appointment.findMany).not.toHaveBeenCalled()
  })

  it('does not re-check when only the notes change', async () => {
    const res = await PUT(put({ notes: 'Patient called ahead' }), params)

    expect(res.status).toBe(200)
    expect(prisma.appointment.findMany).not.toHaveBeenCalled()
  })
})

describe('PUT /api/appointments/[id] — WARN policy', () => {
  it('accepts the clashing booking but returns what it clashes with', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: 'WARN' } as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([COLLEAGUE] as never)

    const res = await PUT(put({ scheduledTime: '10:00' }), params)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.conflicts).toHaveLength(1)
    expect(body.conflicts[0].message).toContain('Nadia Aslam')
    expect(prisma.appointment.update).toHaveBeenCalled()
  })
})

/**
 * The rest of PUT's rules (bug report 12 Oct, findings 2, 8, 22, 24 and 32).
 */
describe('PUT /api/appointments/[id] — rules', () => {
  beforeEach(() => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)
  })

  // Finding 2: another clinic's administrator was accepted as the dentist.
  it('refuses a dentist who is not an active dentist of this clinic', async () => {
    vi.mocked(prisma.staff.findFirst).mockResolvedValue(null as never)

    const res = await PUT(put({ doctorId: 'other-clinic-admin' }), params)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: NOT_A_DENTIST })
    expect(vi.mocked(prisma.staff.findFirst).mock.calls[0][0]).toMatchObject({
      where: { id: 'other-clinic-admin', hospitalId: 'h1', isActive: true },
    })
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  it('refuses a move into the past', async () => {
    const res = await PUT(put({ scheduledDate: '2020-09-01' }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('past')
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  it('refuses a move into the lunch break', async () => {
    const res = await PUT(put({ scheduledTime: '13:15' }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('lunch')
  })

  it('refuses a move onto a clinic holiday', async () => {
    vi.mocked(prisma.availability.findMany).mockResolvedValue([
      {
        id: 'hol-1',
        staffId: null,
        dayOfWeek: null,
        date: new Date('2030-06-16T00:00:00.000Z'),
        startTime: null,
        endTime: null,
        isAvailable: false,
        name: 'QA closure day',
        isRecurring: false,
      },
    ] as never)

    const res = await PUT(put({ scheduledDate: '2030-06-16' }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('QA closure day')
  })

  // Finding 22: rebooking a deactivated patient is booking them.
  it('refuses to move an inactive patient', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      ...EXISTING,
      patientId: 'pat-1',
    } as never)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({ isActive: false } as never)

    const res = await PUT(put({ scheduledTime: '14:00' }), params)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: INACTIVE_PATIENT })
  })

  it('keeps notes editable on an appointment whose day has passed', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      ...EXISTING,
      startsAt: instantAt('2020-09-01', '09:00', KARACHI),
      status: 'COMPLETED',
    } as never)

    // What the edit screen sends: everything, unchanged, plus the new note.
    const res = await PUT(
      put({ scheduledDate: '2020-09-01', scheduledTime: '09:00', notes: 'Follow up by phone' }),
      params
    )

    expect(res.status).toBe(200)
  })

  it('refuses an unknown status with a 400 naming the valid ones', async () => {
    const res = await PUT(put({ status: 'FOO' }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('SCHEDULED')
  })

  it('refuses an unknown appointment type with a 400', async () => {
    const res = await PUT(put({ appointmentType: 'TREATMENT' }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('CONSULTATION')
  })

  // Finding 8: SCHEDULED → COMPLETED skipped check-in and check-out.
  it('does not complete an appointment that was never checked in', async () => {
    const res = await PUT(put({ status: 'COMPLETED' }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Check Out')
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  it('does not reopen a completed appointment', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      ...EXISTING,
      status: 'COMPLETED',
    } as never)

    const res = await PUT(put({ status: 'SCHEDULED' }), params)

    expect(res.status).toBe(400)
  })

  it('does not record a no-show before the appointment has started', async () => {
    const res = await PUT(put({ status: 'NO_SHOW' }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('no-show')
  })

  it('records a no-show once the appointment has started', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      ...EXISTING,
      startsAt: new Date(Date.now() - 60 * 60000),
    } as never)

    const res = await PUT(put({ status: 'NO_SHOW' }), params)

    expect(res.status).toBe(200)
  })

  // Findings 8 and 24.
  it('stamps and audits a cancellation', async () => {
    const res = await PUT(
      put({ status: 'CANCELLED', cancellationReason: ' Patient unwell ' }),
      params
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.appointment.update).mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: expect.any(Date),
      cancellationReason: 'Patient unwell',
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'appointment.cancelled',
          entityType: 'Appointment',
          entityId: 'apt-1',
          userId: 'u1',
        }),
      })
    )
  })

  // Finding 32: the wait ends when the patient is called in.
  it('records the wait as check-in until called in', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      ...EXISTING,
      status: 'CHECKED_IN',
      checkedInAt: new Date(Date.now() - 25 * 60000),
    } as never)

    const res = await PUT(put({ status: 'IN_PROGRESS' }), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.appointment.update).mock.calls[0][0].data).toMatchObject({
      status: 'IN_PROGRESS',
      waitTime: 25,
    })
  })

  it('calls in only a checked-in patient', async () => {
    const res = await PUT(put({ status: 'IN_PROGRESS' }), params)

    expect(res.status).toBe(400)
  })
})
