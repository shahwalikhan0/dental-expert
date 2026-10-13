import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma, PurchaseOrderStatus } from '@prisma/client'
import { checkOrderParties, nextOrderNumber, orderTotals } from '@/lib/purchase-orders'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

const ORDER_STATUSES = Object.values(PurchaseOrderStatus) as string[]

function parseStatus(value: unknown): PurchaseOrderStatus | null {
  if (typeof value !== 'string') return null
  const upper = value.toUpperCase()
  return ORDER_STATUSES.includes(upper) ? (upper as PurchaseOrderStatus) : null
}

interface LineInput {
  itemId: string
  quantity: number
  unitPrice?: number
}

/** GET — the clinic's purchase orders, newest first. */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('inventory:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const search = searchParams.get('search')?.trim()
    const supplierId = searchParams.get('supplierId')
    const status = parseStatus(searchParams.get('status'))

    const where: Prisma.PurchaseOrderWhereInput = { hospitalId, deletedAt: null }
    if (status) where.status = status
    if (supplierId) where.supplierId = supplierId
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { orderDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          expectedDate: true,
          receivedDate: true,
          totalAmount: true,
          status: true,
          supplier: { select: { id: true, name: true } },
          items: { select: { quantity: true, receivedQty: true } },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: orders.map(({ items, ...order }) => ({
        ...order,
        lineCount: items.length,
        // What the order screen leads with: how much of it is still to come.
        outstanding: items.reduce((sum, l) => sum + Math.max(0, l.quantity - l.receivedQty), 0),
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err: any) {
    console.error('Error fetching purchase orders:', err)
    return NextResponse.json({ error: 'Failed to fetch purchase orders' }, { status: 500 })
  }
}

/**
 * POST — raise a purchase order.
 *
 * It starts as a DRAFT unless the caller says `status: 'ORDERED'`, which is the
 * "save and place" button. Only a placed order can receive goods, so that the
 * act of telling the supplier is recorded rather than implied.
 */
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('inventory:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { supplierId, expectedDate, notes } = body
    const lines: LineInput[] = Array.isArray(body.items) ? body.items : []

    if (!supplierId) {
      return NextResponse.json({ error: 'A supplier is required' }, { status: 400 })
    }

    if (lines.length === 0) {
      return NextResponse.json({ error: 'An order needs at least one item' }, { status: 400 })
    }

    for (const line of lines) {
      if (!line.itemId) {
        return NextResponse.json({ error: 'Every line needs an item' }, { status: 400 })
      }
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        return NextResponse.json(
          { error: 'Every line needs a quantity of at least one' },
          { status: 400 }
        )
      }
      if (
        line.unitPrice != null &&
        (!Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0)
      ) {
        return NextResponse.json({ error: 'A line price cannot be negative' }, { status: 400 })
      }
    }

    // A live, active supplier — `kind` on the lookup, because suppliers and
    // laboratories share one table and a laboratory does not sell gloves — and
    // live, active items, all this clinic's (finding 44).
    const parties = await checkOrderParties(prisma, {
      hospitalId,
      supplierId,
      itemIds: lines.map((l) => l.itemId),
    })
    if (!parties.ok) {
      return NextResponse.json({ error: parties.error }, { status: parties.status })
    }

    // One query rather than one per line, and scoped to the clinic — an item id
    // from another clinic must not become an order line here.
    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: lines.map((l) => l.itemId) }, hospitalId, deletedAt: null },
      select: { id: true, purchasePrice: true, taxPercentage: true },
    })
    const itemById = new Map(items.map((item) => [item.id, item]))

    const missing = lines.find((line) => !itemById.has(line.itemId))
    if (missing) {
      return NextResponse.json({ error: 'An item on this order was not found' }, { status: 404 })
    }

    const priced = lines.map((line) => {
      const item = itemById.get(line.itemId)!
      // The item's own purchase price is the default, so a clerk raising a
      // routine reorder does not have to retype what the clinic already knows.
      const unitPrice = line.unitPrice ?? Number(item.purchasePrice)
      return { ...line, unitPrice, taxPercentage: Number(item.taxPercentage ?? 0) }
    })

    const totals = orderTotals(priced)
    const status =
      parseStatus(body.status) === PurchaseOrderStatus.ORDERED
        ? PurchaseOrderStatus.ORDERED
        : PurchaseOrderStatus.DRAFT

    // Two clinics raising an order in the same second can read the same last
    // number. The unique index is what actually decides it; this retries.
    let created: { id: string; orderNumber: string } | null = null
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const orderNumber = await nextOrderNumber(prisma, hospitalId)
      try {
        created = await prisma.purchaseOrder.create({
          data: {
            hospitalId,
            orderNumber,
            supplierId,
            expectedDate: expectedDate ? new Date(expectedDate) : null,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            status,
            notes: notes || null,
            items: {
              create: priced.map((line, index) => ({
                itemId: line.itemId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                amount: totals.lines[index].amount,
              })),
            },
          },
          select: { id: true, orderNumber: true },
        })
      } catch (err) {
        const collision =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
        if (!collision) throw err
      }
    }

    if (!created) {
      return NextResponse.json(
        { error: 'Could not allocate an order number, please try again' },
        { status: 409 }
      )
    }

    if (status === PurchaseOrderStatus.ORDERED) {
      await recordAudit({
        hospitalId,
        userId: session?.user?.id,
        action: AUDIT_ACTIONS.PURCHASE_ORDER_PLACED,
        entityType: 'PurchaseOrder',
        entityId: created.id,
        newValues: { orderNumber: created.orderNumber, totalAmount: totals.totalAmount },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (err: any) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Error creating purchase order:', err)
    return NextResponse.json({ error: 'Failed to create purchase order' }, { status: 500 })
  }
}
