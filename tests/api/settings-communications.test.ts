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

const mod = await import('@/app/api/settings/communications/route')

function makeGetRequest() {
  return new Request('http://localhost/api/settings/communications') as any
}

function makePostRequest(body: any) {
  return new Request('http://localhost/api/settings/communications', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as any
}

describe('Settings Communications API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
    })
  })

  describe('GET /api/settings/communications', () => {
    it('returns organized settings from JSON records', async () => {
      ;(prisma.setting.findMany as any).mockResolvedValue([])
      ;(prisma.setting.findUnique as any)
        .mockResolvedValueOnce({ value: JSON.stringify({ gateway: 'twilio', apiKey: 'key123' }) }) // sms_settings
        .mockResolvedValueOnce({ value: JSON.stringify({ smtp_host: 'smtp.test.com' }) }) // email_settings
        .mockResolvedValueOnce({
          value: JSON.stringify({ google_review_url: 'https://g.co/review' }),
        }) // reviews_settings

      const res = await mod.GET(makeGetRequest())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.sms.gateway).toBe('twilio')
      expect(body.email.smtp_host).toBe('smtp.test.com')
      expect(body.reviews.google_review_url).toBe('https://g.co/review')
    })

    it('falls back to individual settings when no JSON record', async () => {
      ;(prisma.setting.findMany as any).mockResolvedValue([
        { category: 'sms', key: 'sms.gateway', value: 'msg91' },
        { category: 'email', key: 'email.smtp.host', value: 'smtp.example.com' },
      ])
      ;(prisma.setting.findUnique as any)
        .mockResolvedValueOnce(null) // sms_settings
        .mockResolvedValueOnce(null) // email_settings
        .mockResolvedValueOnce(null) // reviews_settings

      const res = await mod.GET(makeGetRequest())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.sms.gateway).toBe('msg91')
      expect(body.email.smtp_host).toBe('smtp.example.com')
      expect(body.reviews).toEqual({})
    })

    it('returns 401 when not authenticated', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
        hospitalId: null,
      })
      const res = await mod.GET(makeGetRequest())
      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/settings/communications', () => {
    it('saves SMS settings with upsert', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})

      const res = await mod.POST(
        makePostRequest({
          type: 'sms',
          settings: { gateway: 'twilio', apiKey: 'key123', senderId: 'CLINIC', enabled: true },
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('SMS')
      // Main JSON upsert + individual settings upserts
      expect(prisma.setting.upsert).toHaveBeenCalled()
    })

    /**
     * Twilio needs two credentials — an Account SID and an Auth Token — and
     * only one of them was ever written. `sendViaTwilio` reads the SID from
     * `sms.authKey`, which nothing set, so the one gateway that delivers to
     * Pakistani numbers could not in fact be configured.
     */
    it('writes both Twilio credentials, not just the token', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})

      await mod.POST(
        makePostRequest({
          type: 'sms',
          settings: {
            gateway: 'TWILIO',
            apiKey: 'auth-token',
            authKey: 'ACxxxxxxxx',
            senderId: '+923001234567',
          },
        })
      )

      const written = Object.fromEntries(
        (prisma.setting.upsert as any).mock.calls
          .map((c: any) => c[0].create)
          .filter((d: any) => d?.category === 'sms')
          .map((d: any) => [d.key, d.value])
      )

      expect(written['sms.apiKey']).toBe('auth-token')
      expect(written['sms.authKey']).toBe('ACxxxxxxxx')
      expect(written['sms.senderId']).toBe('+923001234567')
    })

    // The window is the clinic's, not a hardcoded IST rule — so it has to be
    // stored per clinic like every other configurable.
    it('stores the send window, defaulting to nine until nine', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})

      await mod.POST(makePostRequest({ type: 'sms', settings: { gateway: 'TWILIO' } }))

      const written = Object.fromEntries(
        (prisma.setting.upsert as any).mock.calls
          .map((c: any) => c[0].create)
          .filter((d: any) => d?.category === 'sms')
          .map((d: any) => [d.key, d.value])
      )

      expect(written['sms.sendWindowStart']).toBe('09:00')
      expect(written['sms.sendWindowEnd']).toBe('21:00')
    })

    it('keeps a send window the clinic has set', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})

      await mod.POST(
        makePostRequest({
          type: 'sms',
          settings: { gateway: 'TWILIO', sendWindowStart: '08:00', sendWindowEnd: '18:00' },
        })
      )

      const written = Object.fromEntries(
        (prisma.setting.upsert as any).mock.calls
          .map((c: any) => c[0].create)
          .filter((d: any) => d?.category === 'sms')
          .map((d: any) => [d.key, d.value])
      )

      expect(written['sms.sendWindowStart']).toBe('08:00')
      expect(written['sms.sendWindowEnd']).toBe('18:00')
    })

    it('saves email settings', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})

      const res = await mod.POST(
        makePostRequest({
          type: 'email',
          settings: { smtp_host: 'smtp.test.com', smtp_port: '587', from_name: 'Clinic' },
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toContain('EMAIL')
    })

    it('saves reviews settings', async () => {
      ;(prisma.setting.upsert as any).mockResolvedValue({})

      const res = await mod.POST(
        makePostRequest({
          type: 'reviews',
          settings: { google_review_url: 'https://g.co/review', auto_review_requests: true },
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toContain('REVIEWS')
    })

    it('returns 400 when type or settings missing', async () => {
      const res = await mod.POST(makePostRequest({ type: 'sms' }))
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid type', async () => {
      const res = await mod.POST(makePostRequest({ type: 'invalid', settings: {} }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain("'sms', 'email', or 'reviews'")
    })

    it('returns 401 when not authenticated', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
        hospitalId: null,
      })
      const res = await mod.POST(makePostRequest({ type: 'sms', settings: {} }))
      expect(res.status).toBe(401)
    })
  })
})
