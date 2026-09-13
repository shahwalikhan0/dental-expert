// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = {
    requireAuthAndRole: vi.fn(),
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

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  GET as instrumentGET,
  PUT as instrumentPUT,
  DELETE as instrumentDELETE,
} from '@/app/api/sterilization/instruments/[id]/route'
import { requireAuthAndRole, requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    hospitalId: 'h1',
  }
  vi.mocked(requireAuthAndRole).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function mockAuthError() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  } as any)
}

function makeReq(path: string, method = 'GET', body?: any): Request {
  const url = `http://localhost${path}`
  const init: any = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new Request(url, init)
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/sterilization/instruments/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/sterilization/instruments/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await instrumentGET(
      makeReq('/api/sterilization/instruments/ins1'),
      makeParams('ins1') as any
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when instrument not found', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue(null)
    const res = await instrumentGET(
      makeReq('/api/sterilization/instruments/ins1'),
      makeParams('ins1') as any
    )
    expect(res.status).toBe(404)
  })

  it('returns instrument with sterilization logs', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue({
      id: 'ins1',
      name: 'Forceps #7',
      category: 'Extraction',
      serialNumber: 'SN001',
      status: 'AVAILABLE',
      sterilizationLogs: [{ id: 'sl1', startedAt: new Date(), status: 'COMPLETED' }],
    } as any)

    const res = await instrumentGET(
      makeReq('/api/sterilization/instruments/ins1'),
      makeParams('ins1') as any
    )
    const body = await res.json()

    expect(body.instrument.name).toBe('Forceps #7')
    expect(body.instrument.sterilizationLogs).toHaveLength(1)
  })

  it('requires the inventory:read capability', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue(null)
    await instrumentGET(makeReq('/api/sterilization/instruments/ins1'), makeParams('ins1') as any)
    expect(requirePermission).toHaveBeenCalledWith('inventory:read')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. PUT /api/sterilization/instruments/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /api/sterilization/instruments/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await instrumentPUT(
      makeReq('/api/sterilization/instruments/ins1', 'PUT', { name: 'X' }),
      makeParams('ins1') as any
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when instrument not found', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue(null)
    const res = await instrumentPUT(
      makeReq('/api/sterilization/instruments/ins1', 'PUT', { name: 'X' }),
      makeParams('ins1') as any
    )
    expect(res.status).toBe(404)
  })

  it('updates instrument fields', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue({ id: 'ins1' } as any)
    vi.mocked(prisma.instrument.update).mockResolvedValue({
      id: 'ins1',
      name: 'Updated Forceps',
      status: 'IN_USE',
    } as any)

    const res = await instrumentPUT(
      makeReq('/api/sterilization/instruments/ins1', 'PUT', {
        name: 'Updated Forceps',
        status: 'IN_USE',
      }),
      makeParams('ins1') as any
    )
    const body = await res.json()

    expect(body.instrument.name).toBe('Updated Forceps')
    const updateCall = vi.mocked(prisma.instrument.update).mock.calls[0][0]
    expect(updateCall.data.name).toBe('Updated Forceps')
    expect(updateCall.data.status).toBe('IN_USE')
  })

  it('handles date fields (purchaseDate, warrantyDate)', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue({ id: 'ins1' } as any)
    vi.mocked(prisma.instrument.update).mockResolvedValue({ id: 'ins1' } as any)

    await instrumentPUT(
      makeReq('/api/sterilization/instruments/ins1', 'PUT', {
        purchaseDate: '2025-01-15',
        warrantyDate: '2027-01-15',
      }),
      makeParams('ins1') as any
    )

    const updateCall = vi.mocked(prisma.instrument.update).mock.calls[0][0]
    expect(updateCall.data.purchaseDate).toBeInstanceOf(Date)
    expect(updateCall.data.warrantyDate).toBeInstanceOf(Date)
  })

  it('requires the inventory:write capability', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue(null)
    await instrumentPUT(
      makeReq('/api/sterilization/instruments/ins1', 'PUT', { name: 'X' }),
      makeParams('ins1') as any
    )
    expect(requirePermission).toHaveBeenCalledWith('inventory:write')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. DELETE /api/sterilization/instruments/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/sterilization/instruments/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await instrumentDELETE(
      makeReq('/api/sterilization/instruments/ins1', 'DELETE'),
      makeParams('ins1') as any
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when instrument not found', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue(null)
    const res = await instrumentDELETE(
      makeReq('/api/sterilization/instruments/ins1', 'DELETE'),
      makeParams('ins1') as any
    )
    expect(res.status).toBe(404)
  })

  it('hard deletes instrument', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue({ id: 'ins1' } as any)
    vi.mocked(prisma.instrument.delete).mockResolvedValue({ id: 'ins1' } as any)

    const res = await instrumentDELETE(
      makeReq('/api/sterilization/instruments/ins1', 'DELETE'),
      makeParams('ins1') as any
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(prisma.instrument.delete).toHaveBeenCalledWith({ where: { id: 'ins1' } })
  })

  it('requires the inventory:write capability', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue(null)
    await instrumentDELETE(
      makeReq('/api/sterilization/instruments/ins1', 'DELETE'),
      makeParams('ins1') as any
    )
    expect(requirePermission).toHaveBeenCalledWith('inventory:write')
  })
})
