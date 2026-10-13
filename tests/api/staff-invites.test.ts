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
    checkStaffLimit: vi.fn(),
    generateToken: vi.fn(),
    requireAuthAndRole,
    requirePermission: vi.fn((p: string) => decide([p])),
    requireAllPermissions: vi.fn((p: string[]) => decide(p)),
  }
})

const mockEmailHelpers = vi.hoisted(() => ({
  sendInviteEmail: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/email-helpers', () => mockEmailHelpers)
vi.mock('@prisma/client', () => ({
  Role: {
    ADMIN: 'ADMIN',
    DOCTOR: 'DOCTOR',
    RECEPTIONIST: 'RECEPTIONIST',
    LAB_TECH: 'LAB_TECH',
    ACCOUNTANT: 'ACCOUNTANT',
  },
}))

const invitesListModule = await import('@/app/api/staff-invites/route')
const inviteDetailModule = await import('@/app/api/staff-invites/[id]/route')

/**
 * An invitation is a `User` row with no password — see lib/invitations.ts.
 * There is no separate table, so these fixtures are users.
 */
function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    hospitalId: 'hospital-1',
    email: 'doc@clinic.com',
    name: 'Dr John',
    role: 'DOCTOR',
    password: null,
    inviteToken: 'old-token',
    inviteExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    invitedById: 'admin-1',
    createdAt: new Date(),
    ...overrides,
  }
}

/** Somebody who already works here, which is not an invitation. */
function account(overrides: Record<string, unknown> = {}) {
  return invitation({ password: 'hashed', inviteToken: null, inviteExpiresAt: null, ...overrides })
}

function makeListRequest(method: string, body?: any) {
  return new Request('http://localhost/api/staff-invites', {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  }) as any
}

function makeDetailRequest(method: string, body?: any) {
  return new Request('http://localhost/api/staff-invites/inv-1', {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  }) as any
}

const detailCtx = { params: Promise.resolve({ id: 'inv-1' }) }

describe('Staff Invites API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      user: { id: 'admin-1', name: 'Admin User' },
      session: { user: { id: 'admin-1', role: 'ADMIN' } },
    })
    mockAuth.checkStaffLimit.mockResolvedValue({ allowed: true, current: 3, max: 10 })
    mockAuth.generateToken.mockReturnValue('mock-token-abc123')
    mockEmailHelpers.sendInviteEmail.mockResolvedValue(true)
  })

  // ─── GET /api/staff-invites ───────────────────────
  describe('GET /api/staff-invites', () => {
    it('returns all invites for the hospital', async () => {
      ;(prisma.user.findMany as any).mockResolvedValue([
        invitation(),
        invitation({
          id: 'inv-2',
          email: 'rec@clinic.com',
          name: 'Jane',
          role: 'RECEPTIONIST',
          inviteExpiresAt: new Date(Date.now() - 1000),
        }),
      ])

      const res = await invitesListModule.GET()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.invites).toHaveLength(2)

      // Only outstanding invitations are listed, and the status is worked out
      // from the expiry rather than read from a column nothing updates.
      expect(body.invites.map((i: any) => i.status)).toEqual(['PENDING', 'EXPIRED'])
      expect((prisma.user.findMany as any).mock.calls[0][0].where).toMatchObject({
        hospitalId: 'hospital-1',
        password: null,
      })

      // The password column is selected to decide the status and must not
      // leave the route, even as a null.
      expect(Object.keys(body.invites[0])).not.toContain('password')
      expect(Object.keys(body.invites[0])).not.toContain('inviteToken')
    })

    it('returns 401 when not authenticated', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
        hospitalId: null,
      })

      const res = await invitesListModule.GET()
      expect(res.status).toBe(401)
    })
  })

  // ─── POST /api/staff-invites ──────────────────────
  describe('POST /api/staff-invites', () => {
    // The existing-address lookup ignores case (finding 29), so it is a
    // `findFirst` on an insensitive match rather than the unique index.
    it('creates a new invite and sends email', async () => {
      ;(prisma.user.findFirst as any).mockResolvedValue(null)
      ;(prisma.user.create as any).mockResolvedValue(
        invitation({ id: 'inv-new', email: 'newdoc@clinic.com', name: 'New Doc' })
      )
      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic' })

      const res = await invitesListModule.POST(
        makeListRequest('POST', { email: 'newdoc@clinic.com', name: 'New Doc', role: 'DOCTOR' })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.emailSent).toBe(true)
      expect(mockEmailHelpers.sendInviteEmail).toHaveBeenCalled()

      // The row exists from the moment of the invitation, but cannot be signed
      // in to and is nobody's colleague until the link is used.
      expect((prisma.user.create as any).mock.calls[0][0].data).toMatchObject({
        email: 'newdoc@clinic.com',
        hospitalId: 'hospital-1',
        password: null,
        isActive: false,
        inviteToken: 'mock-token-abc123',
      })
    })

    it('stores the address lower-cased', async () => {
      ;(prisma.user.findFirst as any).mockResolvedValue(null)
      ;(prisma.user.create as any).mockResolvedValue(invitation({ id: 'inv-new' }))
      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic' })

      const res = await invitesListModule.POST(
        makeListRequest('POST', { email: ' NewDoc@Clinic.COM ', name: 'New Doc', role: 'DOCTOR' })
      )
      expect(res.status).toBe(200)
      expect((prisma.user.create as any).mock.calls[0][0].data.email).toBe('newdoc@clinic.com')
    })

    it('returns 400 for invalid email', async () => {
      const res = await invitesListModule.POST(
        makeListRequest('POST', { email: 'bad-email', name: 'Test', role: 'DOCTOR' })
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid role', async () => {
      const res = await invitesListModule.POST(
        makeListRequest('POST', { email: 'test@test.com', name: 'Test', role: 'SUPERADMIN' })
      )
      expect(res.status).toBe(400)
    })

    it('returns 403 when staff limit reached', async () => {
      mockAuth.checkStaffLimit.mockResolvedValue({ allowed: false, current: 10, max: 10 })

      const res = await invitesListModule.POST(
        makeListRequest('POST', { email: 'test@test.com', name: 'Test', role: 'DOCTOR' })
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toContain('limit')
    })

    it('returns 409 when user already exists', async () => {
      ;(prisma.user.findFirst as any).mockResolvedValue(account({ id: 'existing-user' }))

      const res = await invitesListModule.POST(
        makeListRequest('POST', { email: 'existing@clinic.com', name: 'Existing', role: 'DOCTOR' })
      )
      expect(res.status).toBe(409)
    })

    it('returns 409 when pending invite exists', async () => {
      ;(prisma.user.findFirst as any).mockResolvedValue(invitation({ id: 'inv-pending' }))

      const res = await invitesListModule.POST(
        makeListRequest('POST', { email: 'pending@clinic.com', name: 'Pending', role: 'DOCTOR' })
      )
      expect(res.status).toBe(409)
      expect(prisma.user.create).not.toHaveBeenCalled()
    })

    // Asking again for exactly what the lapsed invitation was for is not an
    // error; it is the clinic saying the link should work again.
    it('re-issues an invitation that has expired instead of refusing it', async () => {
      ;(prisma.user.findFirst as any).mockResolvedValue(
        invitation({ inviteExpiresAt: new Date(Date.now() - 1000) })
      )
      ;(prisma.user.update as any).mockResolvedValue(invitation())
      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic' })

      const res = await invitesListModule.POST(
        makeListRequest('POST', { email: 'doc@clinic.com', name: 'Dr John', role: 'DOCTOR' })
      )
      expect(res.status).toBe(200)
      expect((prisma.user.update as any).mock.calls[0][0].data).toMatchObject({
        inviteToken: 'mock-token-abc123',
      })
      expect(prisma.user.create).not.toHaveBeenCalled()
    })
  })

  // ─── DELETE /api/staff-invites/[id] ───────────────
  describe('DELETE /api/staff-invites/[id]', () => {
    it('cancels a pending invite', async () => {
      ;(prisma.user.findUnique as any).mockResolvedValue(invitation())
      ;(prisma.user.delete as any).mockResolvedValue({})

      const res = await inviteDetailModule.DELETE(makeDetailRequest('DELETE'), detailCtx)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      // The row goes, rather than being marked cancelled — otherwise the
      // address it was sent to could never be invited again.
      expect((prisma.user.delete as any).mock.calls[0][0]).toEqual({ where: { id: 'inv-1' } })
    })

    // An invitation and an account are now rows in the same table, so this
    // endpoint must not be usable to delete a colleague's login.
    it('refuses an id that turns out to be a real account', async () => {
      ;(prisma.user.findUnique as any).mockResolvedValue(account())

      const res = await inviteDetailModule.DELETE(makeDetailRequest('DELETE'), detailCtx)
      expect(res.status).toBe(404)
      expect(prisma.user.delete).not.toHaveBeenCalled()
    })

    it('cancels an invitation that has already lapsed', async () => {
      ;(prisma.user.findUnique as any).mockResolvedValue(
        invitation({ inviteExpiresAt: new Date(Date.now() - 1000) })
      )
      ;(prisma.user.delete as any).mockResolvedValue({})

      const res = await inviteDetailModule.DELETE(makeDetailRequest('DELETE'), detailCtx)
      expect(res.status).toBe(200)
    })

    it('returns 404 when invite not found', async () => {
      ;(prisma.user.findUnique as any).mockResolvedValue(null)

      const res = await inviteDetailModule.DELETE(makeDetailRequest('DELETE'), detailCtx)
      expect(res.status).toBe(404)
    })

    it('returns 404 when invite belongs to different hospital', async () => {
      ;(prisma.user.findUnique as any).mockResolvedValue(
        invitation({ hospitalId: 'other-hospital' })
      )

      const res = await inviteDetailModule.DELETE(makeDetailRequest('DELETE'), detailCtx)
      expect(res.status).toBe(404)
      expect(prisma.user.delete).not.toHaveBeenCalled()
    })
  })

  // ─── POST /api/staff-invites/[id] (resend) ───────
  describe('POST /api/staff-invites/[id] (resend)', () => {
    it('resends an invite and extends expiry', async () => {
      ;(prisma.user.findUnique as any)
        .mockResolvedValueOnce(invitation())
        .mockResolvedValueOnce({ name: 'Admin User' })
      ;(prisma.user.update as any).mockResolvedValue({})
      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic' })

      const res = await inviteDetailModule.POST(makeDetailRequest('POST'), detailCtx)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.emailSent).toBe(true)
      expect(body.status).toBe('PENDING')
      expect((prisma.user.update as any).mock.calls[0][0].data.inviteExpiresAt).toBeInstanceOf(Date)
    })

    // Reviving a lapsed invitation is the whole point of the button; the old
    // version refused anything not marked PENDING, which is exactly the case
    // somebody presses it for.
    it('resends an invitation that has already lapsed', async () => {
      ;(prisma.user.findUnique as any)
        .mockResolvedValueOnce(invitation({ inviteExpiresAt: new Date(Date.now() - 1000) }))
        .mockResolvedValueOnce({ name: 'Admin User' })
      ;(prisma.user.update as any).mockResolvedValue({})
      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic' })

      const res = await inviteDetailModule.POST(makeDetailRequest('POST'), detailCtx)
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ status: 'PENDING' })
    })

    it('refuses an id that turns out to be a real account', async () => {
      ;(prisma.user.findUnique as any).mockResolvedValue(account())

      const res = await inviteDetailModule.POST(makeDetailRequest('POST'), detailCtx)
      expect(res.status).toBe(404)
      expect(mockEmailHelpers.sendInviteEmail).not.toHaveBeenCalled()
    })

    it('returns 404 when invite not found', async () => {
      ;(prisma.user.findUnique as any).mockResolvedValue(null)

      const res = await inviteDetailModule.POST(makeDetailRequest('POST'), detailCtx)
      expect(res.status).toBe(404)
    })
  })
})
