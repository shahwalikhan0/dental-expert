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

const mockVideoService = vi.hoisted(() => ({
  createRoom: vi.fn(),
  deleteRoom: vi.fn(),
  getRoomToken: vi.fn(),
  getVideoProvider: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/services/video.service', () => mockVideoService)

const roomModule = await import('@/app/api/video/room/route')
const tokenModule = await import('@/app/api/video/token/route')

function makeRoomRequest(method: string, params: Record<string, string> = {}, body?: any) {
  const url = new URL('http://localhost/api/video/room')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new Request(url.toString(), {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  }) as any
}

function makeTokenRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/video/token')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new Request(url.toString()) as any
}

describe('Video Room & Token API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      user: { id: 'user-1', name: 'Dr. Smith' },
      session: { user: { id: 'user-1', role: 'DOCTOR' } },
    })
  })

  // ─── POST /api/video/room ─────────────────────────
  describe('POST /api/video/room', () => {
    it('creates a video room', async () => {
      mockVideoService.createRoom.mockResolvedValue({
        roomName: 'consult-123',
        roomUrl: 'https://daily.co/consult-123',
      })

      const res = await roomModule.POST(
        makeRoomRequest('POST', {}, { consultationId: 'consult-123' })
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.roomName).toBe('consult-123')
      expect(mockVideoService.createRoom).toHaveBeenCalledWith('consult-123')
    })

    it('returns 400 when consultationId missing', async () => {
      const res = await roomModule.POST(makeRoomRequest('POST', {}, {}))
      expect(res.status).toBe(400)
    })

    it('returns auth error when not authorized', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: Response.json({ error: 'Forbidden' }, { status: 403 }),
        hospitalId: null,
      })

      const res = await roomModule.POST(makeRoomRequest('POST', {}, { consultationId: 'c1' }))
      expect(res.status).toBe(403)
    })
  })

  // ─── DELETE /api/video/room ───────────────────────
  describe('DELETE /api/video/room', () => {
    it('deletes a video room', async () => {
      mockVideoService.deleteRoom.mockResolvedValue(undefined)

      const res = await roomModule.DELETE(makeRoomRequest('DELETE', { roomName: 'room-abc' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(mockVideoService.deleteRoom).toHaveBeenCalledWith('room-abc')
    })

    it('returns 400 when roomName missing', async () => {
      const res = await roomModule.DELETE(makeRoomRequest('DELETE'))
      expect(res.status).toBe(400)
    })
  })

  // ─── GET /api/video/token ─────────────────────────
  describe('GET /api/video/token', () => {
    it('returns Daily token for doctor', async () => {
      ;(prisma.videoConsultation.findFirst as any).mockResolvedValue({
        id: 'consult-1',
        roomName: 'room-xyz',
        roomUrl: 'https://daily.co/room-xyz',
        doctor: { userId: 'user-1', firstName: 'John', lastName: 'Smith' },
        patient: { firstName: 'Jane', lastName: 'Doe' },
      })
      mockVideoService.getVideoProvider.mockReturnValue('daily')
      mockVideoService.getRoomToken.mockResolvedValue('daily-token-abc')

      const res = await tokenModule.GET(makeTokenRequest({ consultationId: 'consult-1' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.token).toBe('daily-token-abc')
      expect(body.provider).toBe('daily')
      expect(body.isDoctor).toBe(true)
      expect(mockVideoService.getRoomToken).toHaveBeenCalledWith('room-xyz', 'Dr. John Smith', true)
    })

    it('returns Jitsi response (no token needed)', async () => {
      ;(prisma.videoConsultation.findFirst as any).mockResolvedValue({
        id: 'consult-1',
        roomName: 'room-jitsi',
        roomUrl: 'https://meet.jit.si/room-jitsi',
        doctor: { userId: 'other-user', firstName: 'Doc', lastName: 'Jones' },
        patient: { firstName: 'Jane', lastName: 'Doe' },
      })
      mockVideoService.getVideoProvider.mockReturnValue('jitsi')

      const res = await tokenModule.GET(makeTokenRequest({ consultationId: 'consult-1' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.token).toBeNull()
      expect(body.provider).toBe('jitsi')
      expect(body.isDoctor).toBe(false)
    })

    it('returns 400 when consultationId missing', async () => {
      const res = await tokenModule.GET(makeTokenRequest())
      expect(res.status).toBe(400)
    })

    it('returns 404 when consultation not found', async () => {
      ;(prisma.videoConsultation.findFirst as any).mockResolvedValue(null)

      const res = await tokenModule.GET(makeTokenRequest({ consultationId: 'not-found' }))
      expect(res.status).toBe(404)
    })
  })
})
