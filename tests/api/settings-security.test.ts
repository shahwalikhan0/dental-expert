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

const securityModule = await import('@/app/api/settings/security/route')

function makeSecurityRequest(method: string, body?: any) {
  return new Request('http://localhost/api/settings/security', {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  }) as any
}

describe('Settings Security & Subscription API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
    })
  })

  // ─── GET /api/settings/security ───────────────────
  describe('GET /api/settings/security', () => {
    it('returns what is stored, merged over the defaults', async () => {
      ;(prisma.setting.findMany as any).mockResolvedValue([
        { key: 'sessionTimeoutMinutes', value: '30', category: 'security' },
        { key: 'maxLoginAttempts', value: '3', category: 'security' },
      ])

      const res = await securityModule.GET(makeSecurityRequest('GET'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.sessionTimeoutMinutes).toBe(30)
      expect(body.data.maxLoginAttempts).toBe(3)
      // Not stored, so the default — and the screen renders what is enforced
      // rather than a default of its own invention.
      expect(body.data.lockoutDurationMinutes).toBe(30)
      expect(body.data.passwordExpiryDays).toBe(0)
    })

    it('returns the defaults, not an empty object, when nothing is stored', async () => {
      ;(prisma.setting.findMany as any).mockResolvedValue([])

      const res = await securityModule.GET(makeSecurityRequest('GET'))
      expect(res.status).toBe(200)
      const body = await res.json()

      // An empty object would leave the page free to invent its own defaults,
      // which is how it came to display a 60-minute session timeout for an
      // application that issued 8-hour ones.
      expect(body.data.sessionTimeoutMinutes).toBe(480)
      expect(body.data.restrictToOwnPatients).toBe(false)
    })

    it('does not offer two-factor authentication', async () => {
      ;(prisma.setting.findMany as any).mockResolvedValue([
        // A row left behind by an older version, which the migration deletes.
        { key: 'requireTwoFactor', value: 'true', category: 'security' },
      ])

      const res = await securityModule.GET(makeSecurityRequest('GET'))
      const body = await res.json()

      // The switch never did anything. Reporting it would go on telling a
      // clinic it has a second factor that does not exist.
      expect(body.data.requireTwoFactor).toBeUndefined()
    })

    it('does not offer password rules — the 8-to-32 rule is fixed', async () => {
      ;(prisma.setting.findMany as any).mockResolvedValue([
        // Rows left behind by an older version, which the migration deletes.
        { key: 'passwordMinLength', value: '12', category: 'security' },
        { key: 'passwordRequireUppercase', value: 'true', category: 'security' },
      ])

      const body = await (await securityModule.GET(makeSecurityRequest('GET'))).json()
      expect(body.data.passwordMinLength).toBeUndefined()
      expect(body.data.passwordRequireUppercase).toBeUndefined()
    })

    it('returns 403 when the role may not read settings', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: Response.json({ error: 'Forbidden' }, { status: 403 }),
        hospitalId: null,
      })

      const res = await securityModule.GET(makeSecurityRequest('GET'))
      expect(res.status).toBe(403)
    })
  })

  // ─── POST /api/settings/security ──────────────────
  describe('POST /api/settings/security', () => {
    it('stores each setting', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})
      ;(prisma.setting.findMany as any).mockResolvedValue([])

      const res = await securityModule.POST(
        makeSecurityRequest('POST', {
          passwordExpiryDays: 90,
          sessionTimeoutMinutes: 60,
          maxLoginAttempts: 3,
          restrictToOwnPatients: true,
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(prisma.setting.upsert).toHaveBeenCalledTimes(4)
    })

    it('will not store a password rule', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})
      ;(prisma.setting.findMany as any).mockResolvedValue([])

      const res = await securityModule.POST(
        makeSecurityRequest('POST', { passwordMinLength: 12, passwordRequireUppercase: true })
      )
      expect(res.status).toBe(200)
      expect(prisma.setting.upsert).not.toHaveBeenCalled()
    })

    it('refuses a session timeout under five minutes', async () => {
      const res = await securityModule.POST(
        makeSecurityRequest('POST', { sessionTimeoutMinutes: 1 })
      )
      expect(res.status).toBe(400)
    })

    it('will not store a two-factor setting', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})
      ;(prisma.setting.findMany as any).mockResolvedValue([])

      const res = await securityModule.POST(
        makeSecurityRequest('POST', { requireTwoFactor: true, maxLoginAttempts: 4 })
      )
      expect(res.status).toBe(200)

      const keys = (prisma.setting.upsert as any).mock.calls.map(
        (call: any[]) => call[0].create.key
      )
      expect(keys).toContain('maxLoginAttempts')
      expect(keys).not.toContain('requireTwoFactor')
    })
  })

  // ─── GET /api/settings/subscription ───────────────
})
