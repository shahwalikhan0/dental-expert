/**
 * PUT /api/appointments/[id] — FR-004 on the reschedule path.
 *
 * The reschedule check had the same exact-start-time flaw as booking, plus one
 * of its own: it re-checked only when the date, time or doctor changed. Making
 * an appointment longer, or moving it into a different chair, moves the
 * interval just as much and went entirely unchecked.
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

const params = { params: Promise.resolve({ id: 'apt-1' }) }

const KARACHI = 'Asia/Karachi'

/** A wall-clock time on the fixtures' day, as the instant it refers to. */
const at = (time: string) => instantAt('2030-06-15', time, KARACHI)!

const EXISTING = {
  id: 'apt-1',
  hospitalId: 'h1',
  doctorId: 'doc-1',
  chairId: 'chair-1',
  startsAt: at('09:00'),
  duration: 30,
  status: 'SCHEDULED',
}

/**
 * Another patient occupying 09:45–10:15 with the same doctor, in a different
 * chair — so these fixtures exercise the doctor clash on its own. The chair
 * test below puts the clash in the chair instead.
 */
const COLLEAGUE = {
  id: 'apt-2',
  appointmentNo: 'APT00002',
  startsAt: at('09:45'),
  duration: 30,
  doctorId: 'doc-1',
  chairId: 'chair-3',
  patient: { firstName: 'Nadia', lastName: 'Aslam' },
  doctor: { firstName: 'Imran', lastName: 'Shah' },
  chair: { name: 'Chair 3' },
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

  it('re-checks when only the chair changes', async () => {
    vi.mocked(prisma.chair.findFirst).mockResolvedValue({
      id: 'chair-2',
      isActive: true,
    } as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      {
        ...COLLEAGUE,
        doctorId: 'doc-9',
        chairId: 'chair-2',
        chair: { name: 'Chair 2' },
        startsAt: at('09:15'),
      },
    ] as never)

    const res = await PUT(put({ chairId: 'chair-2' }), params)

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ conflicts: [{ resource: 'chair' }] })
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

describe('PUT /api/appointments/[id] — chair validation', () => {
  it('404s for a chair belonging to another clinic', async () => {
    vi.mocked(prisma.chair.findFirst).mockResolvedValue(null as never)

    const res = await PUT(put({ chairId: 'someone-elses' }), params)

    expect(res.status).toBe(404)
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  it('refuses to move an appointment into a retired chair', async () => {
    vi.mocked(prisma.chair.findFirst).mockResolvedValue({
      id: 'chair-9',
      isActive: false,
    } as never)

    const res = await PUT(put({ chairId: 'chair-9' }), params)

    expect(res.status).toBe(400)
  })

  // An appointment already sitting in a chair that has since been retired must
  // still be editable — otherwise retiring a chair freezes its history.
  it('lets an appointment stay in a chair retired under it', async () => {
    vi.mocked(prisma.chair.findFirst).mockResolvedValue({
      id: 'chair-1',
      isActive: false,
    } as never)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as never)

    const res = await PUT(put({ chairId: 'chair-1', notes: 'Running late' }), params)

    expect(res.status).toBe(200)
  })
})
