/**
 * Goods receipt (§5.7, FR-016, FR-017).
 *
 * `PurchaseOrder`, `PurchaseOrderItem` and `InventoryBatch` sat in the schema
 * since the fork with nothing writing to them. These routes are what fills
 * them, and receipt is the one that moves stock: the assertions here are mostly
 * about what a delivery does to the stock level, the batch and the audit trail,
 * because those three going out of step is the failure nobody notices until a
 * stock take.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PurchaseOrderStatus, StockTransactionType } from '@prisma/client'

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

vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit')
  return { ...actual, recordAudit: vi.fn() }
})

import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'
import { GET as LIST, POST as CREATE } from '@/app/api/inventory/purchase-orders/route'
import { PATCH, DELETE } from '@/app/api/inventory/purchase-orders/[id]/route'
import { POST as RECEIVE } from '@/app/api/inventory/purchase-orders/[id]/receive/route'

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

/** An order for 10 gloves, placed with the supplier and nothing received. */
function placedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po1',
    orderNumber: 'PO20260001',
    status: PurchaseOrderStatus.ORDERED,
    supplierId: 'v1',
    items: [
      {
        id: 'line1',
        itemId: 'i1',
        quantity: 10,
        receivedQty: 0,
        unitPrice: 250,
        item: {
          id: 'i1',
          name: 'Latex gloves',
          currentStock: 4,
          minimumStock: 5,
          batchTracking: false,
          expiryTracking: false,
        },
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('ADMIN')
  vi.mocked(prisma.purchaseOrder.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.purchaseOrder.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.purchaseOrder.create).mockResolvedValue({
    id: 'po1',
    orderNumber: 'PO20260001',
  } as never)
  vi.mocked(prisma.purchaseOrder.update).mockResolvedValue({} as never)
  vi.mocked(prisma.purchaseOrderItem.update).mockResolvedValue({} as never)
  vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.vendor.findFirst).mockResolvedValue({
    id: 'v1',
    name: 'Dental Depot',
    status: 'ACTIVE',
  } as never)
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
    { id: 'i1', name: 'Latex gloves', isActive: true, purchasePrice: 250, taxPercentage: 0 },
  ] as never)
  vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
    currentStock: 4,
    minimumStock: 5,
  } as never)
  vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as never)
  vi.mocked(prisma.inventoryBatch.upsert).mockResolvedValue({ id: 'b1' } as never)
  vi.mocked(prisma.stockTransaction.create).mockResolvedValue({ id: 't1' } as never)
  vi.mocked(prisma.stockTransaction.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.stockAlert.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.stockAlert.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.stockAlert.create).mockResolvedValue({ id: 'a1' } as never)
  // Expiry alerts for the batches a receipt touched are raised there and then.
  vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.inventoryBatch.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.inventoryBatch.findUnique).mockResolvedValue(null as never)
  vi.mocked(prisma.setting.findUnique).mockResolvedValue(null as never)
})

describe('listing orders', () => {
  it('is scoped to the clinic and hides deleted drafts', async () => {
    await LIST(req('/api/inventory/purchase-orders'))

    expect(vi.mocked(prisma.purchaseOrder.findMany).mock.calls[0][0]!.where).toMatchObject({
      hospitalId: 'h1',
      deletedAt: null,
    })
  })

  it('reports what is still outstanding on each order', async () => {
    vi.mocked(prisma.purchaseOrder.findMany).mockResolvedValue([
      {
        id: 'po1',
        orderNumber: 'PO20260001',
        totalAmount: 2500,
        status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        supplier: { id: 'v1', name: 'Acme' },
        items: [
          { quantity: 10, receivedQty: 4 },
          { quantity: 5, receivedQty: 5 },
        ],
      },
    ] as never)

    const body = await (await LIST(req('/api/inventory/purchase-orders'))).json()

    expect(body.data[0].outstanding).toBe(6)
    expect(body.data[0].lineCount).toBe(2)
  })
})

describe('raising an order', () => {
  it('refuses an order with no lines', async () => {
    const res = await CREATE(req('/api/inventory/purchase-orders', 'POST', { supplierId: 'v1' }))
    expect(res.status).toBe(400)
  })

  it('refuses a laboratory as the supplier', async () => {
    // Suppliers and laboratories share one table. A dental laboratory does not
    // sell gloves, and the `kind` filter is what keeps it off this list.
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null as never)

    const res = await CREATE(
      req('/api/inventory/purchase-orders', 'POST', {
        supplierId: 'lab1',
        items: [{ itemId: 'i1', quantity: 5 }],
      })
    )

    expect(res.status).toBe(404)
    expect(vi.mocked(prisma.vendor.findFirst).mock.calls[0][0]!.where).toMatchObject({
      kind: 'SUPPLIER',
      hospitalId: 'h1',
    })
  })

  it('refuses an item belonging to another clinic', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never)

    const res = await CREATE(
      req('/api/inventory/purchase-orders', 'POST', {
        supplierId: 'v1',
        items: [{ itemId: 'someone-elses', quantity: 5 }],
      })
    )

    expect(res.status).toBe(404)
    expect(vi.mocked(prisma.inventoryItem.findMany).mock.calls[0][0]!.where).toMatchObject({
      hospitalId: 'h1',
    })
  })

  it("defaults a line's price to what the clinic already pays", async () => {
    await CREATE(
      req('/api/inventory/purchase-orders', 'POST', {
        supplierId: 'v1',
        items: [{ itemId: 'i1', quantity: 4 }],
      })
    )

    const data = vi.mocked(prisma.purchaseOrder.create).mock.calls[0][0]!.data as any
    expect(data.items.create[0].unitPrice).toBe(250)
    expect(data.totalAmount).toBe(1000)
  })

  it('starts as a draft', async () => {
    await CREATE(
      req('/api/inventory/purchase-orders', 'POST', {
        supplierId: 'v1',
        items: [{ itemId: 'i1', quantity: 4 }],
      })
    )

    const data = vi.mocked(prisma.purchaseOrder.create).mock.calls[0][0]!.data as any
    expect(data.status).toBe(PurchaseOrderStatus.DRAFT)
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it('audits an order that is placed straight away', async () => {
    await CREATE(
      req('/api/inventory/purchase-orders', 'POST', {
        supplierId: 'v1',
        status: 'ORDERED',
        items: [{ itemId: 'i1', quantity: 4 }],
      })
    )

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.PURCHASE_ORDER_PLACED,
        entityType: 'PurchaseOrder',
        hospitalId: 'h1',
      })
    )
  })

  it('numbers the order for this clinic only', async () => {
    await CREATE(
      req('/api/inventory/purchase-orders', 'POST', {
        supplierId: 'v1',
        items: [{ itemId: 'i1', quantity: 1 }],
      })
    )

    expect(vi.mocked(prisma.purchaseOrder.findFirst).mock.calls[0][0]!.where).toMatchObject({
      hospitalId: 'h1',
    })
  })
})

describe('who and what an order can name', () => {
  // Finding 44: draft PO20260002 was sent to a deleted supplier for a deleted item.
  it('refuses an inactive supplier', async () => {
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({
      id: 'v1',
      name: 'MedSupply Karachi',
      status: 'INACTIVE',
    } as never)

    const res = await CREATE(
      req('/api/inventory/purchase-orders', 'POST', {
        supplierId: 'v1',
        items: [{ itemId: 'i1', quantity: 5 }],
      })
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('MedSupply Karachi is inactive')
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled()
  })

  it('refuses an inactive item', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'i1', name: 'GIC restorative', isActive: false, purchasePrice: 250 },
    ] as never)

    const res = await CREATE(
      req('/api/inventory/purchase-orders', 'POST', {
        supplierId: 'v1',
        items: [{ itemId: 'i1', quantity: 5 }],
      })
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('GIC restorative is inactive')
  })

  it('refuses to place a draft whose supplier has since been deleted', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: 'po2',
      status: PurchaseOrderStatus.DRAFT,
      orderNumber: 'PO20260002',
      supplierId: 'v-gone',
      items: [{ itemId: 'i1' }],
    } as never)
    // Deleted suppliers are not found: the lookup filters on deletedAt.
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null as never)

    const res = await PATCH(
      req('/api/inventory/purchase-orders/po2', 'PATCH', { status: 'ORDERED' }),
      params('po2')
    )

    expect(res.status).toBe(404)
    expect(vi.mocked(prisma.vendor.findFirst).mock.calls[0][0]!.where).toMatchObject({
      id: 'v-gone',
      deletedAt: null,
    })
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('refuses to place a draft for an item that has since been deleted', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: 'po2',
      status: PurchaseOrderStatus.DRAFT,
      orderNumber: 'PO20260002',
      supplierId: 'v1',
      items: [{ itemId: 'i-gone' }],
    } as never)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never)

    const res = await PATCH(
      req('/api/inventory/purchase-orders/po2', 'PATCH', { status: 'ORDERED' }),
      params('po2')
    )

    expect(res.status).toBe(404)
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled()
  })
})

describe('placing and cancelling', () => {
  it('will not cancel an order goods have arrived against', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      orderNumber: 'PO20260001',
    } as never)

    const res = await PATCH(
      req('/api/inventory/purchase-orders/po1', 'PATCH', { status: 'CANCELLED' }),
      params('po1')
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('stock adjustment')
  })

  it('cancels an order that has received nothing', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.ORDERED,
      orderNumber: 'PO20260001',
    } as never)

    const res = await PATCH(
      req('/api/inventory/purchase-orders/po1', 'PATCH', { status: 'CANCELLED' }),
      params('po1')
    )

    expect(res.status).toBe(200)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.PURCHASE_ORDER_CANCELLED })
    )
  })

  it('refuses to edit the lines of an order already with the supplier', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.ORDERED,
      orderNumber: 'PO20260001',
    } as never)

    const res = await PATCH(
      req('/api/inventory/purchase-orders/po1', 'PATCH', {
        items: [{ itemId: 'i1', quantity: 99 }],
      }),
      params('po1')
    )

    expect(res.status).toBe(409)
  })

  it('deletes a draft but refuses to delete a placed order', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.ORDERED,
    } as never)

    expect(
      (await DELETE(req('/api/inventory/purchase-orders/po1', 'DELETE'), params('po1'))).status
    ).toBe(409)

    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.DRAFT,
    } as never)

    expect(
      (await DELETE(req('/api/inventory/purchase-orders/po1', 'DELETE'), params('po1'))).status
    ).toBe(200)
    // Soft, not hard: a draft that was deleted is still a thing that happened.
    expect(vi.mocked(prisma.purchaseOrder.update).mock.calls[0][0]!.data).toHaveProperty(
      'deletedAt'
    )
  })
})

describe('receiving goods', () => {
  const receive = (body: unknown) =>
    RECEIVE(req('/api/inventory/purchase-orders/po1/receive', 'POST', body), params('po1'))

  it('raises the stock level and records the movement', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 10 },
    ] as never)

    const res = await receive({ items: [{ lineId: 'line1', quantity: 10 }] })
    expect(res.status).toBe(200)

    expect(vi.mocked(prisma.inventoryItem.update).mock.calls[0][0]!.data).toMatchObject({
      currentStock: 14,
    })

    const movement = vi.mocked(prisma.stockTransaction.create).mock.calls[0][0]!.data as any
    expect(movement).toMatchObject({
      type: StockTransactionType.PURCHASE,
      quantity: 10,
      previousStock: 4,
      newStock: 14,
      // FR-017: the movement carries who it came from and what it was against.
      supplierId: 'v1',
      referenceType: 'PurchaseOrder',
      referenceId: 'po1',
      performedBy: 'u1',
    })
  })

  it('credits the line so the order knows what is left', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 4 },
    ] as never)

    await receive({ items: [{ lineId: 'line1', quantity: 4 }] })

    expect(vi.mocked(prisma.purchaseOrderItem.update).mock.calls[0][0]!.data).toMatchObject({
      receivedQty: { increment: 4 },
    })
  })

  it('closes the order when the last line completes', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 10 },
    ] as never)

    const body = await (await receive({ items: [{ lineId: 'line1', quantity: 10 }] })).json()

    expect(body.data.status).toBe(PurchaseOrderStatus.RECEIVED)
    const update = vi.mocked(prisma.purchaseOrder.update).mock.calls.at(-1)![0]!.data as any
    expect(update.status).toBe(PurchaseOrderStatus.RECEIVED)
    expect(update.receivedDate).toBeInstanceOf(Date)
  })

  it('leaves a part-delivered order open and dates nothing', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 4 },
    ] as never)

    const body = await (await receive({ items: [{ lineId: 'line1', quantity: 4 }] })).json()

    expect(body.data.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED)
    const update = vi.mocked(prisma.purchaseOrder.update).mock.calls.at(-1)![0]!.data as any
    expect(update.receivedDate).toBeUndefined()
  })

  it('creates the batch that carries the expiry date', async () => {
    // The only place in the application where an expiry date enters the system.
    // Without it FR-016 has nothing to raise a near-expiry alert about.
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(
      placedOrder({
        items: [
          {
            id: 'line1',
            itemId: 'i1',
            quantity: 10,
            receivedQty: 0,
            unitPrice: 250,
            item: {
              id: 'i1',
              name: 'Composite',
              currentStock: 4,
              minimumStock: 5,
              batchTracking: true,
              expiryTracking: true,
            },
          },
        ],
      }) as never
    )
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 10 },
    ] as never)

    await receive({
      items: [{ lineId: 'line1', quantity: 10, batchNumber: 'B-77', expiryDate: '2027-06-30' }],
    })

    const call = vi.mocked(prisma.inventoryBatch.upsert).mock.calls[0][0]! as any
    expect(call.where.hospitalId_itemId_batchNumber).toMatchObject({
      hospitalId: 'h1',
      itemId: 'i1',
      batchNumber: 'B-77',
    })
    expect(call.create.expiryDate).toEqual(new Date('2027-06-30'))
    expect(call.create.remainingQty).toBe(10)
    // A second delivery of the same batch adds to it rather than colliding.
    expect(call.update).toMatchObject({
      quantity: { increment: 10 },
      remainingQty: { increment: 10 },
    })

    expect(vi.mocked(prisma.stockTransaction.create).mock.calls[0][0]!.data).toMatchObject({
      batchId: 'b1',
      batchNumber: 'B-77',
    })
  })

  // Finding 43: fifty cartridges went into LIG-OLD, expired since January 2025.
  it('refuses a delivery into a batch that has already expired', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(
      placedOrder({
        items: [
          {
            id: 'line1',
            itemId: 'i1',
            quantity: 50,
            receivedQty: 0,
            unitPrice: 20,
            item: {
              id: 'i1',
              name: 'Lignocaine',
              currentStock: 39,
              minimumStock: 10,
              batchTracking: true,
              expiryTracking: false,
            },
          },
        ],
      }) as never
    )
    vi.mocked(prisma.inventoryBatch.findUnique).mockResolvedValue({
      expiryDate: new Date('2025-01-01'),
    } as never)

    const res = await receive({
      items: [{ lineId: 'line1', quantity: 50, batchNumber: 'LIG-OLD' }],
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('LIG-OLD expired')
    expect(prisma.inventoryBatch.upsert).not.toHaveBeenCalled()
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled()
  })

  it('refuses a new batch whose expiry date has already passed', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)

    const res = await receive({
      items: [{ lineId: 'line1', quantity: 10, batchNumber: 'B-OLD', expiryDate: '2025-01-01' }],
    })

    expect(res.status).toBe(400)
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled()
  })

  it('raises the expiry alert for a delivery close to its date at once', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 10 },
    ] as never)
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    vi.mocked(prisma.inventoryBatch.findMany).mockResolvedValue([
      { id: 'b1', itemId: 'i1', expiryDate: soon, remainingQty: 10 },
    ] as never)

    const res = await receive({
      items: [
        {
          lineId: 'line1',
          quantity: 10,
          batchNumber: 'B-SOON',
          expiryDate: soon.toISOString().slice(0, 10),
        },
      ],
    })

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.inventoryBatch.findMany).mock.calls[0][0]!.where).toMatchObject({
      id: { in: ['b1'] },
    })
    expect(prisma.stockAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ batchId: 'b1', alertType: 'EXPIRING_SOON' }),
      })
    )
  })

  it('makes no batch for an item nobody tracks by batch', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 10 },
    ] as never)

    await receive({ items: [{ lineId: 'line1', quantity: 10 }] })

    expect(prisma.inventoryBatch.upsert).not.toHaveBeenCalled()
  })

  it('clears the low-stock alert the delivery answers', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 10 },
    ] as never)

    await receive({ items: [{ lineId: 'line1', quantity: 10 }] })

    // 4 in stock against a minimum of 5 was a LOW_STOCK alert; 14 is not, so
    // both shortage types are cleared and nothing new is raised.
    expect(prisma.stockAlert.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ itemId: 'i1', isAcknowledged: false }),
      })
    )
    expect(prisma.stockAlert.create).not.toHaveBeenCalled()
  })

  it('refuses to receive against a draft', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(
      placedOrder({ status: PurchaseOrderStatus.DRAFT }) as never
    )

    const res = await receive({ items: [{ lineId: 'line1', quantity: 1 }] })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Place this order')
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled()
  })

  it('refuses more than was ordered, and moves no stock doing so', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)

    const res = await receive({ items: [{ lineId: 'line1', quantity: 11 }] })

    expect(res.status).toBe(400)
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled()
    expect(prisma.stockTransaction.create).not.toHaveBeenCalled()
    expect(prisma.purchaseOrderItem.update).not.toHaveBeenCalled()
  })

  it('scopes the stock re-read to the clinic, not just the item id', async () => {
    // The order was already checked, but this is the query that decides which
    // row gets more stock. It should not be the one place taking an id on trust.
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 10 },
    ] as never)

    await receive({ items: [{ lineId: 'line1', quantity: 10 }] })

    expect(vi.mocked(prisma.inventoryItem.findFirst).mock.calls[0][0]!.where).toMatchObject({
      id: 'i1',
      hospitalId: 'h1',
      deletedAt: null,
    })
  })

  it('refuses an order belonging to another clinic', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(null as never)

    const res = await receive({ items: [{ lineId: 'line1', quantity: 1 }] })

    expect(res.status).toBe(404)
    expect(vi.mocked(prisma.purchaseOrder.findFirst).mock.calls[0][0]!.where).toMatchObject({
      hospitalId: 'h1',
    })
  })

  it('audits the receipt', async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(placedOrder() as never)
    vi.mocked(prisma.purchaseOrderItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQty: 10 },
    ] as never)

    await receive({ items: [{ lineId: 'line1', quantity: 10 }] })

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.GOODS_RECEIVED,
        entityType: 'PurchaseOrder',
        entityId: 'po1',
        userId: 'u1',
      })
    )
  })

  it('will not let a receptionist book stock in', async () => {
    signedInAs('RECEPTIONIST')

    const res = await receive({ items: [{ lineId: 'line1', quantity: 1 }] })

    expect(res.status).toBe(403)
  })
})
