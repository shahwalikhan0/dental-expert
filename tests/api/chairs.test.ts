/**
 * /api/chairs — the chair master behind FR-004's chair conflict and FR-025's
 * "maintain … chairs" requirement.
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
  return helpers
})

import { GET, POST } from '@/app/api/chairs/route'
import { PATCH, DELETE } from '@/app/api/chairs/[id]/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function signedInAs(role: string) {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: 'u1', role },
  } as any)
}

function req(path: string, method = 'GET', body?: unknown) {
  const init: any = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(`http://localhost${path}`, init)
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/chairs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the clinic chairs in display order', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findMany).mockResolvedValue([{ id: 'c1', name: 'Chair 1' }] as never)

    const res = await GET(req('/api/chairs'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ count: 1 })
    expect(vi.mocked(prisma.chair.findMany).mock.calls[0][0]).toMatchObject({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
  })

  // Reception books patients into chairs but cannot open clinic settings, so
  // gating the list on settings:read would leave them with an empty dropdown.
  it('is available to reception, who book appointments', async () => {
    signedInAs('RECEPTIONIST')
    vi.mocked(prisma.chair.findMany).mockResolvedValue([] as never)
    expect((await GET(req('/api/chairs'))).status).toBe(200)
  })

  it('is refused to a role with no appointment access', async () => {
    signedInAs('INVENTORY_STAFF')
    expect((await GET(req('/api/chairs'))).status).toBe(403)
    expect(prisma.chair.findMany).not.toHaveBeenCalled()
  })

  it('hides out-of-service chairs by default', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findMany).mockResolvedValue([] as never)

    await GET(req('/api/chairs'))
    expect((vi.mocked(prisma.chair.findMany).mock.calls[0][0]!.where as any).isActive).toBe(true)
  })

  it('includes them when asked, for the settings screen', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findMany).mockResolvedValue([] as never)

    await GET(req('/api/chairs?includeInactive=true'))
    expect(
      (vi.mocked(prisma.chair.findMany).mock.calls[0][0]!.where as any).isActive
    ).toBeUndefined()
  })

  it('scopes the list to the signed-in clinic', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findMany).mockResolvedValue([] as never)

    await GET(req('/api/chairs'))
    expect((vi.mocked(prisma.chair.findMany).mock.calls[0][0]!.where as any).hospitalId).toBe('h1')
  })
})

describe('POST /api/chairs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds a chair', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.chair.create).mockResolvedValue({ id: 'c1', name: 'Operatory A' } as never)

    const res = await POST(req('/api/chairs', 'POST', { name: 'Operatory A', room: 'Upstairs' }))
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.chair.create).mock.calls[0][0].data).toMatchObject({
      hospitalId: 'h1',
      name: 'Operatory A',
      room: 'Upstairs',
    })
  })

  // Two chairs with the same name make the booking dropdown meaningless.
  it('refuses a duplicate name regardless of case', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findFirst).mockResolvedValue({ id: 'c1' } as never)

    const res = await POST(req('/api/chairs', 'POST', { name: 'chair 1' }))
    expect(res.status).toBe(409)
    expect(prisma.chair.create).not.toHaveBeenCalled()
    expect((vi.mocked(prisma.chair.findFirst).mock.calls[0][0]!.where as any).name).toMatchObject({
      mode: 'insensitive',
    })
  })

  it('rejects an empty name', async () => {
    signedInAs('ADMIN')
    expect((await POST(req('/api/chairs', 'POST', { name: '   ' }))).status).toBe(400)
  })

  // Reception may read the list but must not edit the master.
  it('is refused to reception', async () => {
    signedInAs('RECEPTIONIST')
    expect((await POST(req('/api/chairs', 'POST', { name: 'Chair 9' }))).status).toBe(403)
  })
})

describe('PATCH /api/chairs/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('takes a chair out of service', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findFirst).mockResolvedValue({ id: 'c1' } as never)
    vi.mocked(prisma.chair.update).mockResolvedValue({ id: 'c1', isActive: false } as never)

    const res = await PATCH(req('/api/chairs/c1', 'PATCH', { isActive: false }), params('c1'))
    expect(res.status).toBe(200)
  })

  // Without the hospitalId in the lookup, one clinic could rename another's.
  it('404s for a chair belonging to another clinic', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findFirst).mockResolvedValue(null as never)

    const res = await PATCH(req('/api/chairs/other', 'PATCH', { name: 'Mine' }), params('other'))
    expect(res.status).toBe(404)
    expect(prisma.chair.update).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/chairs/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes a chair that has never been used', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findFirst).mockResolvedValue({
      id: 'c1',
      _count: { appointments: 0 },
    } as never)
    vi.mocked(prisma.chair.delete).mockResolvedValue({ id: 'c1' } as never)

    const res = await DELETE(req('/api/chairs/c1', 'DELETE'), params('c1'))
    await expect(res.json()).resolves.toMatchObject({ deactivated: false })
    expect(prisma.chair.delete).toHaveBeenCalled()
  })

  // Deleting would null the chair on every past appointment, erasing where
  // those treatments happened.
  it('retires rather than deletes a chair with history', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.chair.findFirst).mockResolvedValue({
      id: 'c1',
      _count: { appointments: 12 },
    } as never)
    vi.mocked(prisma.chair.update).mockResolvedValue({ id: 'c1', isActive: false } as never)

    const res = await DELETE(req('/api/chairs/c1', 'DELETE'), params('c1'))
    await expect(res.json()).resolves.toMatchObject({ deactivated: true })
    expect(prisma.chair.delete).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.chair.update).mock.calls[0][0].data).toMatchObject({ isActive: false })
  })

  it('is refused to reception', async () => {
    signedInAs('RECEPTIONIST')
    expect((await DELETE(req('/api/chairs/c1', 'DELETE'), params('c1'))).status).toBe(403)
  })
})
