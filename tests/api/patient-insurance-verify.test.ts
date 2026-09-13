import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => {
  const requireAuthAndRole = vi.fn()
  // Routes gate on capabilities now (lib/rbac). Rather than stub the check
  // away, run the real matrix against whatever role the test put on
  // requireAuthAndRole — so a "returns 403 for X" case exercises the actual
  // rules instead of a mock that always says yes.
  const decide = async (perms: string[]) => {
    const { can } = await import('@/lib/rbac')
    const { NextResponse } = await import('next/server')
    const res = await requireAuthAndRole()
    if (!res || res.error) return res
    // Fixtures shallow-spread their overrides, so a test that sets
    // `session.user.role` leaves the default `user.role` behind (and vice
    // versa). Reading just one of them would silently use the stale default,
    // so require the capability for every role the fixture names.
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
  return {
    requireAuthAndRole,
    requirePermission: vi.fn((p: string) => decide([p])),
    requireAllPermissions: vi.fn((p: string[]) => decide(p)),
  }
})

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

const mod = await import('@/app/api/patients/[id]/insurance/verify/route')

function makeRequest(body: any) {
  return new Request('http://localhost/api/patients/p1/insurance/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as any
}

describe('POST /api/patients/[id]/insurance/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
    })
  })

  it('verifies an insurance policy', async () => {
    ;(prisma.patientInsurance.updateMany as any).mockResolvedValue({ count: 1 })

    const ctx = { params: Promise.resolve({ id: 'p1' }) }
    const res = await mod.POST(makeRequest({ policyId: 'policy-1' }), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.verifiedAt).toBeDefined()
    expect(prisma.patientInsurance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'policy-1', hospitalId: 'hospital-1', patientId: 'p1' },
        data: expect.objectContaining({ verificationStatus: 'VERIFIED' }),
      })
    )
  })

  it('returns 400 when policyId missing', async () => {
    const ctx = { params: Promise.resolve({ id: 'p1' }) }
    const res = await mod.POST(makeRequest({}), ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Policy ID')
  })

  it('returns 404 when policy not found', async () => {
    ;(prisma.patientInsurance.updateMany as any).mockResolvedValue({ count: 0 })

    const ctx = { params: Promise.resolve({ id: 'p1' }) }
    const res = await mod.POST(makeRequest({ policyId: 'no-exist' }), ctx)
    expect(res.status).toBe(404)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      hospitalId: null,
    })

    const ctx = { params: Promise.resolve({ id: 'p1' }) }
    const res = await mod.POST(makeRequest({ policyId: 'policy-1' }), ctx)
    expect(res.status).toBe(401)
  })
})
