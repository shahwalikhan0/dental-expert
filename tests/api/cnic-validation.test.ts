/**
 * CNIC on the way into the database.
 *
 * The field was previously a free-text Aadhaar number with no validation at
 * all, so anything typed was stored. A national identity number that is wrong
 * is worse than one that is absent — it is what tells two patients of the same
 * name apart — so the routes now check it and store it in one canonical shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

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
  // The route reads `.allowed` off these, not `.error`.
  helpers.checkPatientLimit = vi.fn(async () => ({ allowed: true, current: 0, max: -1 }))
  helpers.checkStaffLimit = vi.fn(async () => ({ allowed: true, current: 0, max: -1 }))
  return helpers
})

import { POST as CREATE_PATIENT } from '@/app/api/patients/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function signedInAs(role: string) {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: 'u1', role },
    session: { user: { id: 'u1', role } },
  } as any)
}

function newPatient(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Sana',
      lastName: 'Khalid',
      phone: '3001234567',
      gender: 'FEMALE',
      ...overrides,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('RECEPTIONIST')
  vi.mocked(prisma.patient.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.patient.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.patient.create).mockResolvedValue({ id: 'p1' } as never)
})

describe('POST /api/patients — CNIC', () => {
  // Stored without punctuation so the same person typed three different ways
  // is one record.
  it('stores the digits alone, however they were typed', async () => {
    const res = await CREATE_PATIENT(newPatient({ cnic: '35202-1234567-1' }))

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.patient.create).mock.calls[0][0].data).toMatchObject({
      cnic: '3520212345671',
    })
  })

  it('accepts one typed with spaces', async () => {
    await CREATE_PATIENT(newPatient({ cnic: '35202 1234567 1' }))
    expect(vi.mocked(prisma.patient.create).mock.calls[0][0].data).toMatchObject({
      cnic: '3520212345671',
    })
  })

  // 12 digits is Aadhaar. Accepting it would let Indian data through as if it
  // were a Pakistani identity number.
  it('refuses a 12-digit Aadhaar number', async () => {
    const res = await CREATE_PATIENT(newPatient({ cnic: '123456789012' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('13 digits'),
    })
    expect(prisma.patient.create).not.toHaveBeenCalled()
  })

  it('refuses an impossible province code', async () => {
    expect((await CREATE_PATIENT(newPatient({ cnic: '9520212345671' }))).status).toBe(400)
    expect(prisma.patient.create).not.toHaveBeenCalled()
  })

  it('refuses letters', async () => {
    expect((await CREATE_PATIENT(newPatient({ cnic: 'not-a-cnic' }))).status).toBe(400)
  })

  // Children hold a B-Form rather than a CNIC, and plenty of adults arrive
  // without theirs — registration must not depend on it.
  it('registers a patient with no CNIC at all', async () => {
    const res = await CREATE_PATIENT(newPatient())

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.patient.create).mock.calls[0][0].data).toMatchObject({ cnic: null })
  })

  it('treats an empty string as absent rather than invalid', async () => {
    const res = await CREATE_PATIENT(newPatient({ cnic: '' }))

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.patient.create).mock.calls[0][0].data).toMatchObject({ cnic: null })
  })

  // The upstream schema defaulted this to "Tamil Nadu", stamping an Indian
  // state onto every Pakistani patient who left it blank.
  it('does not invent a province', async () => {
    await CREATE_PATIENT(newPatient())
    expect(vi.mocked(prisma.patient.create).mock.calls[0][0].data.state).toBeFalsy()
  })
})
