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
vi.mock('@/lib/prisma', () => ({ default: prisma }))

const mod = await import('@/app/api/patients/[id]/documents/[documentId]/annotations/route')

function makeJsonRequest(method: string, body?: any) {
  return new Request('http://localhost/api/patients/p1/documents/doc-1/annotations', {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  }) as any
}

const ctx = { params: Promise.resolve({ id: 'p1', documentId: 'doc-1' }) }

describe('PUT /api/patients/[id]/documents/[documentId]/annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'DOCTOR' } },
    })
  })

  it('saves annotations to a document', async () => {
    const annotations = [
      { x: 10, y: 20, text: 'Cavity observed', type: 'marker' },
      { x: 50, y: 60, text: 'Discoloration', type: 'highlight' },
    ]
    ;(prisma.document.findFirst as any).mockResolvedValue({
      id: 'doc-1',
      patientId: 'p1',
      hospitalId: 'hospital-1',
    })
    ;(prisma.document.update as any).mockResolvedValue({
      annotations,
      annotatedBy: 'user-1',
      annotatedAt: new Date(),
    })

    const req = makeJsonRequest('PUT', { annotations })
    const res = await mod.PUT(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.annotations).toHaveLength(2)
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ annotations, annotatedBy: 'user-1' }),
      })
    )
  })

  it('returns 403 without patients:write', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'LAB_TECH' } },
    })

    const req = makeJsonRequest('PUT', { annotations: [] })
    const res = await mod.PUT(req, ctx)
    expect(res.status).toBe(403)
  })

  it('returns 400 when annotations is not an array', async () => {
    const req = makeJsonRequest('PUT', { annotations: 'not an array' })
    const res = await mod.PUT(req, ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('array')
  })

  it('returns 404 when document not found', async () => {
    ;(prisma.document.findFirst as any).mockResolvedValue(null)

    const req = makeJsonRequest('PUT', { annotations: [] })
    const res = await mod.PUT(req, ctx)
    expect(res.status).toBe(404)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      hospitalId: null,
      session: null,
    })

    const req = makeJsonRequest('PUT', { annotations: [] })
    const res = await mod.PUT(req, ctx)
    expect(res.status).toBe(401)
  })
})

describe('GET /api/patients/[id]/documents/[documentId]/annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'DOCTOR' } },
    })
  })

  it('returns annotations for a document', async () => {
    ;(prisma.document.findFirst as any).mockResolvedValue({
      annotations: [{ x: 10, y: 20, text: 'Note' }],
      annotatedBy: 'user-1',
      annotatedAt: new Date('2026-01-15'),
    })

    const req = makeJsonRequest('GET')
    const res = await mod.GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.annotations).toHaveLength(1)
    expect(body.annotatedBy).toBe('user-1')
  })

  it('returns empty array when no annotations', async () => {
    ;(prisma.document.findFirst as any).mockResolvedValue({
      annotations: null,
      annotatedBy: null,
      annotatedAt: null,
    })

    const req = makeJsonRequest('GET')
    const res = await mod.GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.annotations).toEqual([])
  })

  it('returns 404 when document not found', async () => {
    ;(prisma.document.findFirst as any).mockResolvedValue(null)

    const req = makeJsonRequest('GET')
    const res = await mod.GET(req, ctx)
    expect(res.status).toBe(404)
  })
})
