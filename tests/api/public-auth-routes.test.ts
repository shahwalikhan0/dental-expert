// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$10$hashedpassword'),
  },
}))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = {
    generateUniqueSlug: vi.fn().mockResolvedValue('test-dental-clinic'),
    generateToken: vi.fn().mockReturnValue('mock-verification-token-abc123'),
  }
  // Routes gate on capabilities now (lib/rbac). Rather than stub the check
  // away, run the real matrix against whatever role the test put on
  // requireAuthAndRole — so a "returns 403 for X" case exercises the actual
  // rules instead of a mock that always says yes.
  const decide = async (perms: string[]) => {
    const res = await helpers.requireAuthAndRole()
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
  helpers.requirePermission = vi.fn((p: string) => decide([p]))
  helpers.requireAllPermissions = vi.fn((p: string[]) => decide(p))
  return helpers
})

vi.mock('@/lib/email-helpers', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
}))

vi.mock('@prisma/client', () => ({
  Plan: { FREE: 'FREE', PROFESSIONAL: 'PROFESSIONAL', ENTERPRISE: 'ENTERPRISE' },
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR', STAFF: 'STAFF' },
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { POST as signupPOST } from '@/app/api/public/signup/route'
import { POST as verifyPOST, GET as verifyGET } from '@/app/api/public/verify-email/route'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/email-helpers'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(path: string, method = 'POST', body?: any): Request {
  const url = `http://localhost${path}`
  const init: any = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new Request(url, init)
}

const validSignup = {
  hospitalName: 'Test Dental Clinic',
  adminName: 'John Doe',
  email: 'admin@testdental.com',
  phone: '9876543210',
  password: 'secureP@ss123',
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. POST /api/public/signup
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/public/signup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 for validation errors', async () => {
    const res = await signupPOST(
      makeReq('/api/public/signup', 'POST', {
        hospitalName: 'A', // too short
        adminName: '',
        email: 'invalid',
        phone: '123',
        password: 'short',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(body.details).toBeDefined()
  })

  it('returns 400 for missing fields', async () => {
    const res = await signupPOST(
      makeReq('/api/public/signup', 'POST', {
        hospitalName: 'Test',
      })
    )
    expect(res.status).toBe(400)
  })

  // Checked against clinics, not users. A person who already has a staff
  // account somewhere on the platform may still register their own practice —
  // and must not be told about a clinic they cannot see.
  it('returns 409 when a clinic is already registered on that address', async () => {
    vi.mocked(prisma.hospital.findFirst).mockResolvedValue({
      id: 'h-existing',
      email: 'admin@testdental.com',
    } as any)

    const res = await signupPOST(makeReq('/api/public/signup', 'POST', validSignup))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toContain('already registered')
  })

  // Looked up without regard to case, and stored lower-cased (finding 29).
  it('matches an existing clinic address in any case', async () => {
    vi.mocked(prisma.hospital.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('stop here'))

    await signupPOST(
      makeReq('/api/public/signup', 'POST', { ...validSignup, email: ' Admin@TestDental.com ' })
    )
    expect(prisma.hospital.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: 'admin@testdental.com', mode: 'insensitive' } },
      })
    )
  })

  it('creates hospital, user, and staff in transaction', async () => {
    vi.mocked(prisma.hospital.findFirst).mockResolvedValue(null)

    const mockTx = {
      hospital: {
        create: vi.fn().mockResolvedValue({ id: 'h1', slug: 'test-dental-clinic' }),
      },
      user: {
        create: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@testdental.com' }),
      },
      // A new clinic gets the starter message templates. Without them every
      // automated message looks up a default template, finds none, and does
      // nothing — which is what happened to every clinic that signed up.
      communicationTemplate: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
      // A new clinic is provisioned with recall types too, or its recall list
      // sits inert with nothing to say why — see lib/recare.ts.
      recareType: { createMany: vi.fn().mockResolvedValue({ count: 3 }) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(mockTx as any))

    const res = await signupPOST(makeReq('/api/public/signup', 'POST', validSignup))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.hospitalId).toBe('h1')
    expect(body.emailSent).toBe(true)

    // A new clinic starts on the free tier, and gets a subscription row from
    // the moment it exists — "what is this tenant entitled to" is then never a
    // question anything has to guess the answer to.
    const created = mockTx.hospital.create.mock.calls[0][0].data
    expect(created).toMatchObject({ name: 'Test Dental Clinic', isActive: true })
    expect(created.subscription.create).toMatchObject({ plan: 'FREE' })
    expect(created).not.toHaveProperty('plan')
    expect(created).not.toHaveProperty('patientLimit')

    // Verify user created with ADMIN role and staff record
    expect(mockTx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'admin@testdental.com',
          role: 'ADMIN',
          isHospitalAdmin: true,
          staff: {
            create: expect.objectContaining({
              employeeId: 'EMP001',
              firstName: 'John',
            }),
          },
        }),
      })
    )
  })

  it('handles email sending failure gracefully', async () => {
    vi.mocked(prisma.hospital.findFirst).mockResolvedValue(null)
    vi.mocked(sendVerificationEmail).mockResolvedValue(false)

    const mockTx = {
      hospital: { create: vi.fn().mockResolvedValue({ id: 'h1' }) },
      user: { create: vi.fn().mockResolvedValue({ id: 'u1' }) },
      communicationTemplate: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
      // A new clinic is provisioned with recall types too, or its recall list
      // sits inert with nothing to say why — see lib/recare.ts.
      recareType: { createMany: vi.fn().mockResolvedValue({ count: 3 }) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(mockTx as any))

    const res = await signupPOST(makeReq('/api/public/signup', 'POST', validSignup))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.emailSent).toBe(false)
    expect(body.message).toContain('SMTP')
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(prisma.hospital.findFirst).mockRejectedValue(new Error('DB down'))

    const res = await signupPOST(makeReq('/api/public/signup', 'POST', validSignup))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain('error occurred during signup')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /api/public/verify-email
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/public/verify-email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 for missing token', async () => {
    const res = await verifyPOST(makeReq('/api/public/verify-email', 'POST', {}))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid token')
  })

  it('returns 400 for invalid/expired token', async () => {
    vi.mocked(prisma.hospital.findFirst).mockResolvedValue(null)

    const res = await verifyPOST(
      makeReq('/api/public/verify-email', 'POST', {
        token: 'expired-token-xyz',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Invalid or expired')
  })

  it('verifies email and clears token', async () => {
    vi.mocked(prisma.hospital.findFirst).mockResolvedValue({
      id: 'h1',
      slug: 'test-dental',
      emailVerificationToken: 'valid-token',
    } as any)
    vi.mocked(prisma.hospital.update).mockResolvedValue({} as any)

    const res = await verifyPOST(
      makeReq('/api/public/verify-email', 'POST', {
        token: 'valid-token',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.hospitalSlug).toBe('test-dental')
    expect(prisma.hospital.update).toHaveBeenCalledWith({
      where: { id: 'h1' },
      data: {
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      },
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. GET /api/public/verify-email
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/verify-email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 when token is missing', async () => {
    const res = await verifyGET(new Request('http://localhost/api/public/verify-email'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Token is required')
  })

  it('returns valid=false for invalid token', async () => {
    vi.mocked(prisma.hospital.findFirst).mockResolvedValue(null)

    const res = await verifyGET(new Request('http://localhost/api/public/verify-email?token=bad'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.valid).toBe(false)
  })

  it('returns hospital info for valid token', async () => {
    vi.mocked(prisma.hospital.findFirst).mockResolvedValue({
      id: 'h1',
      name: 'Test Dental',
      email: 'admin@test.com',
    } as any)

    const res = await verifyGET(
      new Request('http://localhost/api/public/verify-email?token=valid-token')
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.valid).toBe(true)
    expect(body.hospitalName).toBe('Test Dental')
    expect(body.email).toBe('admin@test.com')
  })
})
