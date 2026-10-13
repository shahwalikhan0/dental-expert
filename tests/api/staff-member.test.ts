/**
 * One member of staff: GET, PATCH and DELETE on /api/staff/[id].
 *
 * Bug report 12 October 2026 — findings 21 (deactivating a dentist with
 * patients booked), 24 (staff changes audited), 42 (private fields only for
 * `staff:hr`), 47 (joining date) and 63 (reactivation counts against the
 * plan's staff limit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => {
  const requireAuthAndRole = vi.fn()
  const decide = async (perms: string[]) => {
    const { holderCan } = await import('@/lib/rbac')
    const { NextResponse } = await import('next/server')
    const res = await requireAuthAndRole()
    if (!res || res.error) return res
    if (!perms.every((p) => holderCan(res.user, p as any))) {
      return {
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return res
  }
  return {
    checkStaffLimit: vi.fn(),
    requireAuthAndRole,
    requirePermission: vi.fn((p: string) => decide([p])),
    requireAllPermissions: vi.fn((p: string[]) => decide(p)),
  }
})

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed') } }))

const mod = await import('@/app/api/staff/[id]/route')

const params = { params: Promise.resolve({ id: 'stf-1' }) }

function signedInAs(role: string) {
  const user = { id: 'actor-1', role, hospitalId: 'hospital-1' }
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    user,
    hospitalId: 'hospital-1',
    session: { user },
  })
}

function staffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stf-1',
    userId: 'u-1',
    hospitalId: 'hospital-1',
    employeeId: 'EMP260001',
    firstName: 'Sana',
    lastName: 'Malik',
    email: 'sana@clinic.test',
    phone: '0300 1234567',
    alternatePhone: null,
    gender: 'FEMALE',
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
    address: '12 Canal Road',
    city: 'Lahore',
    state: 'Punjab',
    postalCode: '54000',
    cnic: '3520212345671',
    nationalTaxNo: '1234567',
    qualification: 'BDS',
    specialization: null,
    licenseNumber: null,
    joiningDate: new Date('2026-10-01T00:00:00.000Z'),
    emergencyContact: 'Ali',
    emergencyPhone: '0301 7654321',
    isActive: true,
    user: {
      id: 'u-1',
      email: 'sana@clinic.test',
      role: 'DOCTOR',
      clinicalRole: null,
      isActive: true,
    },
    ...overrides,
  }
}

const json = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/staff/stf-1', {
    method,
    ...(body !== undefined && {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  })

const OPEN = [
  {
    id: 'apt-1',
    appointmentNo: 'APT20260002',
    startsAt: new Date(),
    status: 'CHECKED_IN',
    patient: { firstName: 'Fatima', lastName: 'Bibi' },
    visitor: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.checkStaffLimit.mockResolvedValue({ allowed: true, current: 1, max: 3 })
  ;(prisma.appointment.findMany as any).mockResolvedValue([])
  ;(prisma.attendance.count as any).mockResolvedValue(0)
  ;(prisma.user.update as any).mockResolvedValue({})
  ;(prisma.staff.update as any).mockImplementation(async ({ data }: any) => ({
    ...staffRow(),
    ...data,
  }))
})

describe('GET /api/staff/[id] — private fields (finding 42)', () => {
  it('gives the administrator the whole record', async () => {
    signedInAs('ADMIN')
    ;(prisma.staff.findUnique as any).mockResolvedValue({ ...staffRow(), availability: [] })
    const body = await (await mod.GET(json('GET'), params)).json()
    expect(body.cnic).toBe('3520212345671')
    expect(body.address).toBe('12 Canal Road')
  })

  it('leaves CNIC, birth date, address and emergency contact out for a dentist', async () => {
    signedInAs('DOCTOR')
    ;(prisma.staff.findUnique as any).mockResolvedValue({ ...staffRow(), availability: [] })
    const body = await (await mod.GET(json('GET'), params)).json()
    for (const field of ['cnic', 'dateOfBirth', 'address', 'emergencyContact', 'nationalTaxNo']) {
      expect(body).not.toHaveProperty(field)
    }
    expect(body.phone).toBe('0300 1234567')
  })
})

describe('DELETE /api/staff/[id] — patients still booked (finding 21)', () => {
  beforeEach(() => signedInAs('ADMIN'))

  it('refuses with 409 and lists them', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(staffRow())
    ;(prisma.appointment.findMany as any).mockResolvedValue(OPEN)

    const res = await mod.DELETE(json('DELETE'), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.appointments[0]).toMatchObject({
      appointmentNo: 'APT20260002',
      patient: 'Fatima Bibi',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('goes ahead when confirmed, reassigns nothing, and audits it', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(staffRow())
    ;(prisma.appointment.findMany as any).mockResolvedValue(OPEN)

    const res = await mod.DELETE(json('DELETE', { confirm: true }), params)
    expect(res.status).toBe(200)
    expect(prisma.appointment.update).not.toHaveBeenCalled()
    expect((prisma.auditLog.create as any).mock.calls[0][0].data.action).toBe('staff.deactivated')
  })
})

describe('PATCH /api/staff/[id]', () => {
  beforeEach(() => signedInAs('ADMIN'))

  it('refuses to switch a dentist off with patients booked unless confirmed', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(staffRow())
    ;(prisma.appointment.findMany as any).mockResolvedValue(OPEN)

    const res = await mod.PATCH(json('PATCH', { isActive: false }), params)
    expect(res.status).toBe(409)
  })

  it('counts a reactivation against the plan (finding 63)', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(
      staffRow({ isActive: false, user: { ...staffRow().user, isActive: false } })
    )
    mockAuth.checkStaffLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 })

    const res = await mod.PATCH(json('PATCH', { isActive: true }), params)
    expect(res.status).toBe(403)
    expect((await res.json()).upgradeUrl).toBe('/pricing')
  })

  it('refuses a joining date in the future (finding 47)', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(staffRow())
    const res = await mod.PATCH(json('PATCH', { joiningDate: '2999-01-01' }), params)
    expect(res.status).toBe(400)
  })

  it('refuses to move the joining date past recorded attendance', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(
      staffRow({ joiningDate: new Date('2026-09-01T00:00:00.000Z') })
    )
    ;(prisma.attendance.count as any).mockResolvedValue(4)
    const res = await mod.PATCH(json('PATCH', { joiningDate: '2026-10-01' }), params)
    expect(res.status).toBe(409)
  })

  it('moves the joining date earlier', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(staffRow())
    const res = await mod.PATCH(json('PATCH', { joiningDate: '2026-09-01' }), params)
    expect(res.status).toBe(200)
    expect((prisma.staff.update as any).mock.calls[0][0].data.joiningDate).toEqual(
      new Date('2026-09-01T00:00:00.000Z')
    )
  })

  it('refuses a phone that is not a number (finding 28)', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(staffRow())
    const res = await mod.PATCH(json('PATCH', { phone: 'abc' }), params)
    expect(res.status).toBe(400)
  })

  it('records what changed, without the CNIC itself (finding 24)', async () => {
    ;(prisma.staff.findUnique as any).mockResolvedValue(staffRow())
    await mod.PATCH(json('PATCH', { qualification: 'BDS, MDS', cnic: '35202-7654321-1' }), params)

    const entry = (prisma.auditLog.create as any).mock.calls
      .map((c: any) => c[0].data)
      .find((d: any) => d.action === 'staff.updated')
    expect(entry).toBeDefined()
    expect(entry.newValues).toContain('BDS, MDS')
    expect(entry.newValues).not.toContain('7654321')
  })
})
