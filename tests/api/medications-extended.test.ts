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
  GET as medDetailGET,
  PUT as medDetailPUT,
  DELETE as medDetailDELETE,
} from '@/app/api/medications/[id]/route'
import { GET as categoriesGET } from '@/app/api/medications/categories/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
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

function makeReq(path: string, method = 'GET', body?: any): NextRequest {
  const url = `http://localhost${path}`
  const init: any = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(url, init)
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/medications/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/medications/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await medDetailGET(makeReq('/api/medications/m1'), makeParams('m1') as any)
    expect(res.status).toBe(401)
  })

  it('returns 404 when medication not found', async () => {
    mockAuth()
    vi.mocked(prisma.medication.findFirst).mockResolvedValue(null)
    const res = await medDetailGET(makeReq('/api/medications/m1'), makeParams('m1') as any)
    expect(res.status).toBe(404)
  })

  it('returns medication detail', async () => {
    mockAuth()
    vi.mocked(prisma.medication.findFirst).mockResolvedValue({
      id: 'm1',
      name: 'Amoxicillin',
      genericName: 'Amoxicillin',
      category: 'Antibiotic',
      form: 'CAPSULE',
      strength: '500mg',
      manufacturer: 'Cipla',
    } as any)

    const res = await medDetailGET(makeReq('/api/medications/m1'), makeParams('m1') as any)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.name).toBe('Amoxicillin')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. PUT /api/medications/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /api/medications/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await medDetailPUT(
      makeReq('/api/medications/m1', 'PUT', { name: 'X' }),
      makeParams('m1') as any
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when medication not found', async () => {
    mockAuth()
    vi.mocked(prisma.medication.findFirst).mockResolvedValue(null)
    const res = await medDetailPUT(
      makeReq('/api/medications/m1', 'PUT', { name: 'X' }),
      makeParams('m1') as any
    )
    expect(res.status).toBe(404)
  })

  it('updates medication fields', async () => {
    mockAuth()
    const existing = {
      id: 'm1',
      name: 'Amoxicillin',
      genericName: 'Amoxicillin',
      category: 'Antibiotic',
      form: 'CAPSULE',
      strength: '500mg',
      manufacturer: 'Cipla',
      defaultDosage: '1 cap',
      defaultFrequency: 'TID',
      defaultDuration: '5 days',
      contraindications: null,
      sideEffects: null,
      isActive: true,
    }
    vi.mocked(prisma.medication.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.medication.findMany).mockResolvedValue([])
    vi.mocked(prisma.medication.update).mockResolvedValue({
      ...existing,
      strength: '250mg',
    } as any)

    const res = await medDetailPUT(
      makeReq('/api/medications/m1', 'PUT', { strength: '250mg' }),
      makeParams('m1') as any
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.strength).toBe('250mg')
  })

  it('preserves existing fields on partial update', async () => {
    mockAuth()
    const existing = {
      id: 'm1',
      name: 'Amoxicillin',
      genericName: 'Amoxicillin',
      category: 'Antibiotic',
      form: 'CAPSULE',
      strength: '500mg',
      manufacturer: 'Cipla',
      defaultDosage: '1 cap',
      defaultFrequency: 'TID',
      defaultDuration: '5 days',
      contraindications: 'Penicillin allergy',
      sideEffects: 'Nausea',
      isActive: true,
    }
    vi.mocked(prisma.medication.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.medication.findMany).mockResolvedValue([])
    vi.mocked(prisma.medication.update).mockResolvedValue({
      ...existing,
      name: 'Amox Updated',
    } as any)

    await medDetailPUT(
      makeReq('/api/medications/m1', 'PUT', { name: 'Amox Updated' }),
      makeParams('m1') as any
    )

    const updateCall = vi.mocked(prisma.medication.update).mock.calls[0][0]
    expect(updateCall.data.genericName).toBe('Amoxicillin')
    expect(updateCall.data.contraindications).toBe('Penicillin allergy')
  })

  it('refuses an edit that makes it a duplicate of another active entry (finding 56)', async () => {
    mockAuth()
    vi.mocked(prisma.medication.findFirst).mockResolvedValue({
      id: 'm2',
      name: 'Amoxil',
      genericName: 'Amoxicillin',
      form: 'Capsule',
      strength: '250mg',
      isActive: true,
    } as any)
    vi.mocked(prisma.medication.findMany).mockResolvedValue([
      { id: 'm1', name: 'Amoxil', genericName: 'Amoxicillin', strength: '500mg', form: 'Capsule' },
    ] as any)

    const res = await medDetailPUT(
      makeReq('/api/medications/m2', 'PUT', { strength: '500MG' }),
      makeParams('m2') as any
    )

    expect(res.status).toBe(409)
    expect(prisma.medication.update).not.toHaveBeenCalled()
    // The entry being edited is not compared with itself.
    expect(prisma.medication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ NOT: { id: 'm2' } }),
      })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. DELETE /api/medications/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/medications/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await medDetailDELETE(
      makeReq('/api/medications/m1', 'DELETE'),
      makeParams('m1') as any
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when medication not found', async () => {
    mockAuth()
    vi.mocked(prisma.medication.findFirst).mockResolvedValue(null)
    const res = await medDetailDELETE(
      makeReq('/api/medications/m1', 'DELETE'),
      makeParams('m1') as any
    )
    expect(res.status).toBe(404)
  })

  it('soft deletes (deactivates) medication', async () => {
    mockAuth()
    vi.mocked(prisma.medication.findFirst).mockResolvedValue({ id: 'm1' } as any)
    vi.mocked(prisma.medication.update).mockResolvedValue({ id: 'm1', isActive: false } as any)

    const res = await medDetailDELETE(
      makeReq('/api/medications/m1', 'DELETE'),
      makeParams('m1') as any
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(prisma.medication.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { isActive: false },
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. GET /api/medications/categories
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/medications/categories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await categoriesGET(makeReq('/api/medications/categories'))
    expect(res.status).toBe(401)
  })

  it('returns distinct categories', async () => {
    mockAuth()
    vi.mocked(prisma.medication.findMany).mockResolvedValue([
      { category: 'Antibiotic' },
      { category: 'Analgesic' },
      { category: 'Antiseptic' },
    ] as any)

    const res = await categoriesGET(makeReq('/api/medications/categories'))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data).toEqual(['Antibiotic', 'Analgesic', 'Antiseptic'])
  })

  it('filters out null categories', async () => {
    mockAuth()
    vi.mocked(prisma.medication.findMany).mockResolvedValue([
      { category: 'Antibiotic' },
      { category: null },
    ] as any)

    const res = await categoriesGET(makeReq('/api/medications/categories'))
    const body = await res.json()

    expect(body.data).toEqual(['Antibiotic'])
  })
})
