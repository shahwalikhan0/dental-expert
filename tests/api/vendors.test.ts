/**
 * Suppliers and dental laboratories in one table.
 *
 * They were `Supplier` and `LabVendor` — twenty-seven columns in common,
 * differing in two fields that only a laboratory uses. A dental laboratory *is*
 * a supplier, of crowns rather than composite.
 *
 * What the merge introduces is the one thing that can now go wrong: a query
 * that forgets `kind`. Forget it on the suppliers screen and the clinic's
 * laboratories appear among its materials suppliers; forget it on a lab order
 * and a case can be sent to a glove wholesaler. Every one of those queries is
 * asserted here.
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

import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { GET as LIST_SUPPLIERS, POST as CREATE_SUPPLIER } from '@/app/api/inventory/suppliers/route'
import { GET as GET_SUPPLIER } from '@/app/api/inventory/suppliers/[id]/route'
import { GET as LIST_LABS, POST as CREATE_LAB } from '@/app/api/lab-vendors/route'
import { GET as GET_LAB } from '@/app/api/lab-vendors/[id]/route'

function signedInAs(role: string) {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: 'u1', role },
    session: { user: { id: 'u1', role } },
  } as never)
}

const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('ADMIN')
  vi.mocked(prisma.vendor.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.vendor.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.vendor.create).mockResolvedValue({ id: 'v1' } as never)
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.purchaseOrder.findMany).mockResolvedValue([] as never)
})

describe('the suppliers screen', () => {
  it('lists suppliers and not laboratories', async () => {
    await LIST_SUPPLIERS(req('/api/inventory/suppliers'))

    expect(vi.mocked(prisma.vendor.findMany).mock.calls[0][0]!.where).toMatchObject({
      hospitalId: 'h1',
      kind: 'SUPPLIER',
      deletedAt: null,
    })
  })

  it('creates a supplier, not an unlabelled vendor', async () => {
    const res = await CREATE_SUPPLIER(
      req('/api/inventory/suppliers', 'POST', {
        code: 'SUP009',
        name: 'Lahore Dental Depot',
        phone: '3211012345',
      })
    )

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.vendor.create).mock.calls[0][0].data).toMatchObject({
      kind: 'SUPPLIER',
      code: 'SUP009',
    })
  })

  /**
   * The unique index is on (hospitalId, kind, code), so a supplier and a
   * laboratory may each be "V001". The duplicate check has to be narrowed the
   * same way or it refuses a code that the database would have accepted.
   */
  it('checks a duplicate code among suppliers only', async () => {
    await CREATE_SUPPLIER(
      req('/api/inventory/suppliers', 'POST', { code: 'V001', name: 'X', phone: '3001234567' })
    )

    expect(vi.mocked(prisma.vendor.findFirst).mock.calls[0][0]!.where).toMatchObject({
      kind: 'SUPPLIER',
      code: 'V001',
    })
  })

  // Opening a laboratory's id on the suppliers screen would show a record that
  // screen cannot edit correctly — it has no field for turnaround.
  it('does not open a laboratory by id', async () => {
    await GET_SUPPLIER(req('/api/inventory/suppliers/v-lab'), params('v-lab'))

    expect(vi.mocked(prisma.vendor.findFirst).mock.calls[0][0]!.where).toMatchObject({
      id: 'v-lab',
      kind: 'SUPPLIER',
    })
  })
})

describe('the laboratories screen', () => {
  it('lists laboratories and not suppliers', async () => {
    await LIST_LABS(req('/api/lab-vendors'))

    expect(vi.mocked(prisma.vendor.findMany).mock.calls[0][0]!.where).toMatchObject({
      hospitalId: 'h1',
      kind: 'LAB',
      deletedAt: null,
    })
  })

  it('creates a laboratory with its turnaround and specialisations', async () => {
    const res = await CREATE_LAB(
      req('/api/lab-vendors', 'POST', {
        name: 'Precision Dental Lab',
        phone: '3211011222',
        specializations: 'Crowns, Bridges',
        avgTurnaround: 5,
      })
    )

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.vendor.create).mock.calls[0][0].data).toMatchObject({
      kind: 'LAB',
      specializations: 'Crowns, Bridges',
      avgTurnaround: 5,
    })
  })

  it('starts a laboratory ACTIVE, on the one lifecycle field', async () => {
    await CREATE_LAB(req('/api/lab-vendors', 'POST', { name: 'L', phone: '3001234567' }))

    const data = vi.mocked(prisma.vendor.create).mock.calls[0][0].data
    expect(data.status).toBe('ACTIVE')
    // `isActive` and `status` both existed and could disagree, with nothing
    // deciding which one won.
    expect(data).not.toHaveProperty('isActive')
  })

  it('does not open a supplier by id', async () => {
    await GET_LAB(req('/api/lab-vendors/v-sup'), params('v-sup'))

    expect(vi.mocked(prisma.vendor.findFirst).mock.calls[0][0]!.where).toMatchObject({
      id: 'v-sup',
      kind: 'LAB',
    })
  })
})
