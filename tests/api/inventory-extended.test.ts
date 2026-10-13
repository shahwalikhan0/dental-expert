// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { StockAlertType, VendorStatus } from '@prisma/client'

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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { GET as categoriesGET } from '@/app/api/inventory/categories/route'
import { GET as suppliersGET, POST as suppliersPOST } from '@/app/api/inventory/suppliers/route'
import {
  GET as transactionsGET,
  POST as transactionsPOST,
} from '@/app/api/inventory/transactions/route'
import { GET as alertsGET, POST as alertsPOST } from '@/app/api/inventory/alerts/route'
import { POST as itemsPOST } from '@/app/api/inventory/items/route'
import { DELETE as itemDELETE } from '@/app/api/inventory/items/[id]/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// ── Auth helpers ─────────────────────────────────────────────────────────────

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    session: { user: { id: 'u1', name: 'Admin', role: 'ADMIN' } },
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

/** Runs interactive $transaction callbacks against the mock client. */
function passthroughTransaction() {
  vi.mocked(prisma.$transaction).mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/inventory/categories
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/inventory/categories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await categoriesGET(makeReq('/api/inventory/categories'))
    expect(res.status).toBe(401)
  })

  // The categories are the distinct labels on the items, not a table.
  // `InventoryCategory` was eleven columns and a self-referencing hierarchy in
  // support of a free-text field on a form — with no screen to create, rename
  // or nest one.
  it('returns categories with item counts', async () => {
    mockAuth()
    vi.mocked(prisma.inventoryItem.groupBy).mockResolvedValue([
      { category: 'Dental Materials', _count: { _all: 15 } },
      { category: 'Equipment', _count: { _all: 8 } },
    ] as any)

    const res = await categoriesGET(makeReq('/api/inventory/categories'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(body.data[0].item_count).toBe(15)
    expect(body.data[1].item_count).toBe(8)
  })

  it('returns empty array when no categories', async () => {
    mockAuth()
    vi.mocked(prisma.inventoryItem.groupBy).mockResolvedValue([] as any)

    const res = await categoriesGET(makeReq('/api/inventory/categories'))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET /api/inventory/suppliers
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/inventory/suppliers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await suppliersGET(makeReq('/api/inventory/suppliers'))
    expect(res.status).toBe(401)
  })

  it('returns suppliers with pagination', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.count).mockResolvedValue(1)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([
      {
        id: 's1',
        name: 'Acme Dental',
        code: 'SUP001',
        _count: { preferredForItems: 3, purchaseOrders: 2 },
        purchaseOrders: [{ totalAmount: 1000 }, { totalAmount: 250 }],
      },
    ] as any)

    const res = await suppliersGET(makeReq('/api/inventory/suppliers'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].itemsSupplied).toBe(3)
    expect(body.data[0].totalOrders).toBe(2)
    expect(body.data[0].totalBusiness).toBe(1250)
    expect(body.pagination.total).toBe(1)
  })

  it('applies search filter to the where clause', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.count).mockResolvedValue(0)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([])

    await suppliersGET(makeReq('/api/inventory/suppliers?search=acme'))

    const where = vi.mocked(prisma.vendor.findMany).mock.calls[0][0].where
    expect(where.OR).toEqual([
      { name: { contains: 'acme', mode: 'insensitive' } },
      { code: { contains: 'acme', mode: 'insensitive' } },
      { contactPerson: { contains: 'acme', mode: 'insensitive' } },
    ])
  })

  it('maps the legacy lowercase status filter onto the enum', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.count).mockResolvedValue(0)
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([])

    await suppliersGET(makeReq('/api/inventory/suppliers?status=blocked'))

    const where = vi.mocked(prisma.vendor.findMany).mock.calls[0][0].where
    expect(where.status).toBe(VendorStatus.BLOCKED)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /api/inventory/suppliers
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/inventory/suppliers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await suppliersPOST(makeReq('/api/inventory/suppliers', 'POST', {}))
    expect(res.status).toBe(401)
  })

  it('returns 400 when required fields missing', async () => {
    mockAuth()
    const res = await suppliersPOST(makeReq('/api/inventory/suppliers', 'POST', { name: 'X' }))
    expect(res.status).toBe(400)
  })

  it('returns 409 for duplicate supplier code', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({ id: 'existing' } as any)

    const res = await suppliersPOST(
      makeReq('/api/inventory/suppliers', 'POST', {
        code: 'SUP001',
        name: 'Acme',
        phone: '9876543210',
      })
    )
    expect(res.status).toBe(409)
  })

  it('creates supplier successfully', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.vendor.create).mockResolvedValue({ id: 'new-id' } as any)

    const res = await suppliersPOST(
      makeReq('/api/inventory/suppliers', 'POST', {
        code: 'SUP002',
        name: 'New Supplier',
        phone: '9876543210',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('new-id')
    expect(vi.mocked(prisma.vendor.create).mock.calls[0][0].data.hospitalId).toBe('h1')
  })

  // Finding 49: the column is text, and `paymentTerms: 30` was a 500.
  it('reads payment terms sent as a number as days, rather than failing', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.vendor.create).mockResolvedValue({ id: 'new-id' } as any)

    const res = await suppliersPOST(
      makeReq('/api/inventory/suppliers', 'POST', {
        code: 'SUP003',
        name: 'Numbers Ltd',
        phone: '9876543210',
        paymentTerms: 30,
      })
    )

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.vendor.create).mock.calls[0][0].data.paymentTerms).toBe('Net 30')
  })

  it('refuses payment terms that are neither text nor a number with a 400', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null)

    const res = await suppliersPOST(
      makeReq('/api/inventory/suppliers', 'POST', {
        code: 'SUP004',
        name: 'Objects Ltd',
        phone: '9876543210',
        paymentTerms: { days: 30 },
      })
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Payment terms')
    expect(prisma.vendor.create).not.toHaveBeenCalled()
  })

  it('stores no rating as null, not zero', async () => {
    mockAuth()
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.vendor.create).mockResolvedValue({ id: 'new-id' } as any)

    await suppliersPOST(
      makeReq('/api/inventory/suppliers', 'POST', {
        code: 'SUP005',
        name: 'Unrated',
        phone: '9876543210',
        rating: 0,
      })
    )

    expect(vi.mocked(prisma.vendor.create).mock.calls[0][0].data.rating).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. GET /api/inventory/transactions
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/inventory/transactions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await transactionsGET(makeReq('/api/inventory/transactions'))
    expect(res.status).toBe(401)
  })

  it('returns transactions with pagination', async () => {
    mockAuth()
    vi.mocked(prisma.stockTransaction.count).mockResolvedValue(1)
    vi.mocked(prisma.stockTransaction.findMany).mockResolvedValue([
      {
        id: 't1',
        type: 'PURCHASE',
        quantity: 5,
        performedBy: 'u1',
        batchNumber: null,
        item: { name: 'Composite', sku: 'IT1' },
        supplier: { name: 'Acme' },
        batch: null,
      },
    ] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'u1', name: 'Admin' }] as any)

    const res = await transactionsGET(makeReq('/api/inventory/transactions'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data[0].itemName).toBe('Composite')
    expect(body.data[0].supplierName).toBe('Acme')
    expect(body.data[0].performedByName).toBe('Admin')
    expect(body.pagination.total).toBe(1)
  })

  it('filters by item and type', async () => {
    mockAuth()
    vi.mocked(prisma.stockTransaction.count).mockResolvedValue(0)
    vi.mocked(prisma.stockTransaction.findMany).mockResolvedValue([])

    await transactionsGET(makeReq('/api/inventory/transactions?itemId=i1&type=purchase'))

    const where = vi.mocked(prisma.stockTransaction.findMany).mock.calls[0][0].where
    expect(where.itemId).toBe('i1')
    expect(where.type).toBe('PURCHASE')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. POST /api/inventory/transactions
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/inventory/transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    passthroughTransaction()
    // Stock and batch writes are conditional on what was read, so a lost
    // update shows up as a count of 0. One row written is the normal case.
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.inventoryBatch.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.inventoryBatch.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.inventoryBatch.findMany).mockResolvedValue([])
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([])
    vi.mocked(prisma.stockAlert.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.stockAlert.create).mockResolvedValue({ id: 'a1' } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'log-1' } as any)
  })

  /** Lignocaine: batch-tracked, 89 on the shelf. */
  function batchTrackedItem() {
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
      id: 'lig',
      name: 'Lignocaine',
      currentStock: 89,
      minimumStock: 10,
      purchasePrice: 20,
      batchTracking: true,
    } as any)
    vi.mocked(prisma.stockTransaction.create).mockResolvedValue({ id: 'tx1' } as any)
  }

  it('returns 400 when required fields missing', async () => {
    mockAuth()
    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', { type: 'PURCHASE' })
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when item not found', async () => {
    mockAuth()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null)

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'PURCHASE',
        itemId: 'missing',
        quantity: 5,
        transactionDate: '2026-01-01',
      })
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 for insufficient stock on sale', async () => {
    mockAuth()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
      id: 'i1',
      currentStock: 2,
      minimumStock: 1,
      purchasePrice: 10,
    } as any)

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'SALE',
        itemId: 'i1',
        quantity: 5,
        transactionDate: '2026-01-01',
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Insufficient stock')
  })

  it('creates purchase transaction and updates stock', async () => {
    mockAuth()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
      id: 'i1',
      currentStock: 10,
      minimumStock: 5,
      purchasePrice: 20,
    } as any)
    vi.mocked(prisma.stockTransaction.create).mockResolvedValue({ id: 'tx1' } as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.stockAlert.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'PURCHASE',
        itemId: 'i1',
        quantity: 5,
        transactionDate: '2026-01-01',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.newStock).toBe(15)

    const created = vi.mocked(prisma.stockTransaction.create).mock.calls[0][0].data
    expect(created.previousStock).toBe(10)
    expect(created.newStock).toBe(15)
    expect(created.totalPrice).toBe(100)

    const write = vi.mocked(prisma.inventoryItem.updateMany).mock.calls[0][0]
    expect(write.data.currentStock).toBe(15)
    // Conditional on the level that was read, so a concurrent movement is not lost.
    expect(write.where).toMatchObject({ id: 'i1', currentStock: 10 })
    // Stock is healthy again, so open shortage alerts are cleared.
    expect(prisma.stockAlert.deleteMany).toHaveBeenCalled()
  })

  it('raises a low stock alert when the new level is at or below the minimum', async () => {
    mockAuth()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
      id: 'i1',
      currentStock: 6,
      minimumStock: 5,
      purchasePrice: 20,
    } as any)
    vi.mocked(prisma.stockTransaction.create).mockResolvedValue({ id: 'tx1' } as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.stockAlert.create).mockResolvedValue({ id: 'a1' } as any)

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'CONSUMPTION',
        itemId: 'i1',
        quantity: 2,
        transactionDate: '2026-01-01',
      })
    )
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.stockAlert.create).mock.calls[0][0].data.alertType).toBe(
      StockAlertType.LOW_STOCK
    )
  })

  // Finding 19: consumption of a batch-tracked item with no batch was accepted.
  it('refuses to consume a batch-tracked item without naming a batch', async () => {
    mockAuth()
    batchTrackedItem()

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'CONSUMPTION',
        itemId: 'lig',
        quantity: 5,
        transactionDate: '2026-10-12',
      })
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('batch')
    expect(prisma.stockTransaction.create).not.toHaveBeenCalled()
  })

  it('refuses a batch that belongs to another item', async () => {
    mockAuth()
    batchTrackedItem()
    // The lookup is scoped to the item, so another item's batch is not found.
    vi.mocked(prisma.inventoryBatch.findFirst).mockResolvedValue(null)

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'ADJUSTMENT_IN',
        itemId: 'lig',
        batchId: 'gloves-batch',
        quantity: 1,
        transactionDate: '2026-10-12',
      })
    )

    expect(res.status).toBe(400)
    expect(vi.mocked(prisma.inventoryBatch.findFirst).mock.calls[0][0].where).toMatchObject({
      id: 'gloves-batch',
      itemId: 'lig',
      hospitalId: 'h1',
    })
    expect(prisma.inventoryBatch.updateMany).not.toHaveBeenCalled()
  })

  it('refuses to take a batch below zero', async () => {
    mockAuth()
    batchTrackedItem()
    vi.mocked(prisma.inventoryBatch.findFirst).mockResolvedValue({
      id: 'b1',
      batchNumber: 'LIG-2610',
      remainingQty: 50,
    } as any)

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'CONSUMPTION',
        itemId: 'lig',
        batchId: 'b1',
        quantity: 60,
        transactionDate: '2026-10-12',
      })
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('LIG-2610 holds only 50')
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled()
  })

  it('moves the item and the batch together, and audits the adjustment', async () => {
    mockAuth()
    batchTrackedItem()
    vi.mocked(prisma.inventoryBatch.findFirst).mockResolvedValue({
      id: 'b1',
      batchNumber: 'LIG-2610',
      remainingQty: 50,
    } as any)

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'CONSUMPTION',
        itemId: 'lig',
        batchId: 'b1',
        quantity: 10,
        transactionDate: '2026-10-12',
      })
    )

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.inventoryItem.updateMany).mock.calls[0][0].data.currentStock).toBe(79)
    const batchWrite = vi.mocked(prisma.inventoryBatch.updateMany).mock.calls[0][0]
    expect(batchWrite.where).toMatchObject({ id: 'b1', remainingQty: { gte: 10 } })
    expect(batchWrite.data).toEqual({ remainingQty: { decrement: 10 } })
    expect(vi.mocked(prisma.stockTransaction.create).mock.calls[0][0].data).toMatchObject({
      batchId: 'b1',
      batchNumber: 'LIG-2610',
    })

    // Finding 24.
    const entry = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data
    expect(entry).toMatchObject({ action: 'stock.adjusted', entityId: 'lig', userId: 'u1' })
  })

  it('refuses the movement if the batch was emptied in the meantime', async () => {
    mockAuth()
    batchTrackedItem()
    vi.mocked(prisma.inventoryBatch.findFirst).mockResolvedValue({
      id: 'b1',
      batchNumber: 'LIG-2610',
      remainingQty: 50,
    } as any)
    vi.mocked(prisma.inventoryBatch.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await transactionsPOST(
      makeReq('/api/inventory/transactions', 'POST', {
        type: 'CONSUMPTION',
        itemId: 'lig',
        batchId: 'b1',
        quantity: 10,
        transactionDate: '2026-10-12',
      })
    )

    expect(res.status).toBe(409)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. GET /api/inventory/alerts
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/inventory/alerts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await alertsGET(makeReq('/api/inventory/alerts'))
    expect(res.status).toBe(401)
  })

  it('returns alerts with summary', async () => {
    mockAuth()
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([
      {
        id: 'a1',
        alertType: StockAlertType.LOW_STOCK,
        isAcknowledged: false,
        item: {
          sku: 'IT1',
          name: 'Composite',
          currentStock: 2,
          minimumStock: 5,
          unit: 'box',
          category: 'Materials',
        },
        acknowledgedByUser: null,
      },
    ] as any)
    vi.mocked(prisma.stockAlert.groupBy).mockResolvedValue([
      { alertType: StockAlertType.LOW_STOCK, _count: { _all: 2 } },
      { alertType: StockAlertType.OUT_OF_STOCK, _count: { _all: 1 } },
    ] as any)

    const res = await alertsGET(makeReq('/api/inventory/alerts'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data[0].itemName).toBe('Composite')
    expect(body.data[0].categoryName).toBe('Materials')
    expect(body.summary.totalAlerts).toBe(3)
    expect(body.summary.lowStock).toBe(2)
    expect(body.summary.outOfStock).toBe(1)
  })

  it('defaults to unacknowledged alerts', async () => {
    mockAuth()
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([])
    vi.mocked(prisma.stockAlert.groupBy).mockResolvedValue([])

    await alertsGET(makeReq('/api/inventory/alerts'))

    const where = vi.mocked(prisma.stockAlert.findMany).mock.calls[0][0].where
    expect(where.isAcknowledged).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. POST /api/inventory/alerts
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/inventory/alerts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 when alert id missing', async () => {
    mockAuth()
    const res = await alertsPOST(makeReq('/api/inventory/alerts', 'POST', {}))
    expect(res.status).toBe(400)
  })

  it('returns 404 when alert not found', async () => {
    mockAuth()
    vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue(null)

    const res = await alertsPOST(makeReq('/api/inventory/alerts', 'POST', { alertId: 'nope' }))
    expect(res.status).toBe(404)
  })

  it('acknowledges alert successfully', async () => {
    mockAuth()
    vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue({ id: 'a1' } as any)
    vi.mocked(prisma.stockAlert.update).mockResolvedValue({ id: 'a1' } as any)

    const res = await alertsPOST(
      makeReq('/api/inventory/alerts', 'POST', { alertId: 'a1', notes: 'Ordered more stock' })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)

    const data = vi.mocked(prisma.stockAlert.update).mock.calls[0][0].data
    expect(data.isAcknowledged).toBe(true)
    expect(data.acknowledgedBy).toBe('u1')
    expect(data.notes).toBe('Ordered more stock')
  })

  it('still accepts the legacy alert_id key', async () => {
    mockAuth()
    vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue({ id: 'a1' } as any)
    vi.mocked(prisma.stockAlert.update).mockResolvedValue({ id: 'a1' } as any)

    const res = await alertsPOST(makeReq('/api/inventory/alerts', 'POST', { alert_id: 'a1' }))
    expect(res.status).toBe(200)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Items: creation rules (finding 57) and deletion (findings 24 and 44)
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/inventory/items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    passthroughTransaction()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'i-new' } as any)
    vi.mocked(prisma.stockTransaction.create).mockResolvedValue({ id: 'tx1' } as any)
    vi.mocked(prisma.stockAlert.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.stockAlert.create).mockResolvedValue({ id: 'a1' } as any)
  })

  const body = { sku: 'cmp-a2', name: 'Composite A2', unit: 'syringe', purchasePrice: 1500 }

  it('stores the SKU upper-cased and checks it case-insensitively', async () => {
    mockAuth()

    const res = await itemsPOST(makeReq('/api/inventory/items', 'POST', body))

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.inventoryItem.findFirst).mock.calls[0][0].where).toMatchObject({
      hospitalId: 'h1',
      sku: { equals: 'CMP-A2', mode: 'insensitive' },
    })
    expect(vi.mocked(prisma.inventoryItem.create).mock.calls[0][0].data.sku).toBe('CMP-A2')
  })

  it('refuses a SKU that differs from an existing one only in case', async () => {
    mockAuth()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
      id: 'i1',
      deletedAt: null,
    } as any)

    const res = await itemsPOST(makeReq('/api/inventory/items', 'POST', body))

    expect(res.status).toBe(409)
  })

  it('refuses a negative price or opening stock', async () => {
    mockAuth()

    const price = await itemsPOST(
      makeReq('/api/inventory/items', 'POST', { ...body, purchasePrice: -5 })
    )
    const stock = await itemsPOST(
      makeReq('/api/inventory/items', 'POST', { ...body, currentStock: -10 })
    )

    expect(price.status).toBe(400)
    expect(stock.status).toBe(400)
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled()
  })

  it('raises the low-stock alert for an item created at its minimum', async () => {
    mockAuth()

    await itemsPOST(
      makeReq('/api/inventory/items', 'POST', { ...body, currentStock: 3, minimumStock: 5 })
    )

    expect(vi.mocked(prisma.stockAlert.create).mock.calls[0][0].data).toMatchObject({
      itemId: 'i-new',
      alertType: StockAlertType.LOW_STOCK,
    })
  })
})

describe('DELETE /api/inventory/items/[id]', () => {
  const params = { params: Promise.resolve({ id: 'i1' }) }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
      id: 'i1',
      sku: 'GIC-01',
      name: 'GIC restorative',
      currentStock: 12,
    } as any)
    vi.mocked(prisma.purchaseOrder.findMany).mockResolvedValue([])
    vi.mocked(prisma.purchaseOrder.count).mockResolvedValue(0)
    vi.mocked(prisma.stockTransaction.count).mockResolvedValue(0)
    vi.mocked(prisma.inventoryBatch.count).mockResolvedValue(0)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'log-1' } as any)
  })

  // GIC restorative was deleted while on draft order PO20260002.
  it('refuses while the item is on an open purchase order', async () => {
    mockAuth()
    vi.mocked(prisma.purchaseOrder.findMany).mockResolvedValue([
      { orderNumber: 'PO20260002' },
    ] as any)

    const res = await itemDELETE(makeReq('/api/inventory/items/i1', 'DELETE'), params)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('PO20260002')
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled()
    expect(prisma.inventoryItem.delete).not.toHaveBeenCalled()
  })

  it('keeps an item with history, and audits the deletion', async () => {
    mockAuth()
    vi.mocked(prisma.stockTransaction.count).mockResolvedValue(4)

    const res = await itemDELETE(makeReq('/api/inventory/items/i1', 'DELETE'), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.inventoryItem.update).mock.calls[0][0].data.deletedAt).toBeInstanceOf(
      Date
    )
    expect(prisma.inventoryItem.delete).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.auditLog.create).mock.calls[0][0].data).toMatchObject({
      action: 'inventory_item.deleted',
      entityId: 'i1',
      userId: 'u1',
    })
  })
})
