import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { PurchaseOrderStatus } from '@prisma/client'
import {
  checkOrderParties,
  expectedDateRefusal,
  isEditable,
  orderTotals,
} from '@/lib/purchase-orders'
import { knownErrorResponse } from '@/lib/api-errors'
import { clinicTimezone, localDay } from '@/lib/appointment-time'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  orderDate: true,
  expectedDate: true,
  receivedDate: true,
  subtotal: true,
  taxAmount: true,
  totalAmount: true,
  status: true,
  notes: true,
  supplier: { select: { id: true, name: true, code: true, phone: true, email: true } },
  items: {
    select: {
      id: true,
      itemId: true,
      quantity: true,
      receivedQty: true,
      unitPrice: true,
      amount: true,
      item: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          currentStock: true,
          batchTracking: true,
          expiryTracking: true,
        },
      },
    },
  },
} as const

/**
 * A draft's delivery date and notes as an edit writes them: absent leaves
 * them alone, and null or blank clears them. Both used to be ignored when
 * blank, so a date or a note, once set on a draft, could not be taken off.
 */
const draftDate = (value: unknown) =>
  value === undefined ? undefined : value ? new Date(String(value)) : null
const draftNotes = (value: unknown) =>
  value === undefined ? undefined : typeof value === 'string' && value.trim() ? value : null

/** GET — one order with its lines and what is still outstanding on each. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('inventory:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const order = await prisma.purchaseOrder.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: ORDER_SELECT,
    })

    if (!order) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    // Batches received against this order, so the receipt history is readable
    // from the order rather than only from the item.
    const receipts = await prisma.stockTransaction.findMany({
      where: { hospitalId, referenceType: 'PurchaseOrder', referenceId: id },
      orderBy: { transactionDate: 'desc' },
      select: {
        id: true,
        itemId: true,
        quantity: true,
        transactionDate: true,
        batchNumber: true,
        notes: true,
        batch: { select: { batchNumber: true, expiryDate: true } },
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        ...order,
        items: order.items.map((line) => ({
          ...line,
          outstanding: Math.max(0, line.quantity - line.receivedQty),
        })),
        receipts,
      },
    })
  } catch (err: any) {
    console.error('Error fetching purchase order:', err)
    return NextResponse.json({ error: 'Failed to fetch purchase order' }, { status: 500 })
  }
}

/**
 * PATCH — edit a draft, place it, or cancel it.
 *
 * Lines can only be rewritten while the order is a DRAFT. Once it is with the
 * supplier, changing what was ordered would change what "outstanding" means
 * against goods that have already arrived.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('inventory:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.purchaseOrder.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        supplierId: true,
        expectedDate: true,
        items: { select: { itemId: true } },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    if (body.status === PurchaseOrderStatus.CANCELLED) {
      if (
        existing.status === PurchaseOrderStatus.PARTIALLY_RECEIVED ||
        existing.status === PurchaseOrderStatus.RECEIVED
      ) {
        return NextResponse.json(
          {
            error:
              'Goods have already been received against this order. Return them as a stock adjustment instead.',
          },
          { status: 409 }
        )
      }

      await prisma.purchaseOrder.update({
        where: { id },
        data: { status: PurchaseOrderStatus.CANCELLED },
      })

      await recordAudit({
        hospitalId,
        userId: session?.user?.id,
        action: AUDIT_ACTIONS.PURCHASE_ORDER_CANCELLED,
        entityType: 'PurchaseOrder',
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status: PurchaseOrderStatus.CANCELLED },
        ...requestContext(request.headers),
      })

      return NextResponse.json({ success: true, message: 'Purchase order cancelled' })
    }

    if (body.status === PurchaseOrderStatus.ORDERED) {
      if (existing.status !== PurchaseOrderStatus.DRAFT) {
        return NextResponse.json({ error: 'Only a draft can be placed' }, { status: 409 })
      }

      // The supplier and every item, as they stand now rather than when the
      // draft was saved (finding 44): PO20260002 was sent to a deleted
      // supplier for a deleted item.
      const parties = await checkOrderParties(prisma, {
        hospitalId,
        supplierId: existing.supplierId,
        itemIds: (existing.items ?? []).map((line) => line.itemId),
      })
      if (!parties.ok) {
        return NextResponse.json({ error: parties.error }, { status: parties.status })
      }

      // Placing makes today the order date, so a draft saved last week for
      // delivery yesterday would be overdue the moment it went out.
      const timezone = await clinicTimezone(prisma, hospitalId)
      const dateRefusal = expectedDateRefusal(
        existing.expectedDate,
        localDay(new Date(), timezone),
        timezone
      )
      if (dateRefusal) {
        return NextResponse.json(
          { error: `${dateRefusal}. Change the expected date before placing the order.` },
          { status: 400 }
        )
      }

      await prisma.purchaseOrder.update({
        where: { id },
        data: { status: PurchaseOrderStatus.ORDERED, orderDate: new Date() },
      })

      await recordAudit({
        hospitalId,
        userId: session?.user?.id,
        action: AUDIT_ACTIONS.PURCHASE_ORDER_PLACED,
        entityType: 'PurchaseOrder',
        entityId: id,
        newValues: { orderNumber: existing.orderNumber },
        ...requestContext(request.headers),
      })

      return NextResponse.json({ success: true, message: 'Purchase order placed' })
    }

    if (!isEditable(existing.status)) {
      return NextResponse.json({ error: 'Only a draft order can be edited' }, { status: 409 })
    }

    const lines: { itemId: string; quantity: number; unitPrice?: number }[] = Array.isArray(
      body.items
    )
      ? body.items
      : []

    for (const line of lines) {
      if (!line.itemId || !Number.isInteger(line.quantity) || line.quantity <= 0) {
        return NextResponse.json(
          { error: 'Every line needs an item and a quantity of at least one' },
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

    if (body.expectedDate) {
      const timezone = await clinicTimezone(prisma, hospitalId)
      const dateRefusal = expectedDateRefusal(
        body.expectedDate,
        localDay(new Date(), timezone),
        timezone
      )
      if (dateRefusal) {
        return NextResponse.json({ error: dateRefusal }, { status: 400 })
      }
    }

    // A changed supplier, or new lines, are checked the way a new order is:
    // this clinic's, not deleted, not inactive (finding 44). The supplier id
    // used to be written unchecked.
    if (body.supplierId || lines.length > 0) {
      const parties = await checkOrderParties(prisma, {
        hospitalId,
        supplierId: body.supplierId || existing.supplierId,
        itemIds: lines.map((l) => l.itemId),
      })
      if (!parties.ok) {
        return NextResponse.json({ error: parties.error }, { status: parties.status })
      }
    }

    if (lines.length > 0) {
      const items = await prisma.inventoryItem.findMany({
        where: { id: { in: lines.map((l) => l.itemId) }, hospitalId, deletedAt: null },
        select: { id: true, purchasePrice: true, taxPercentage: true },
      })
      const itemById = new Map(items.map((item) => [item.id, item]))

      if (lines.some((line) => !itemById.has(line.itemId))) {
        return NextResponse.json({ error: 'An item on this order was not found' }, { status: 404 })
      }

      const priced = lines.map((line) => {
        const item = itemById.get(line.itemId)!
        return {
          ...line,
          unitPrice: line.unitPrice ?? Number(item.purchasePrice),
          taxPercentage: Number(item.taxPercentage ?? 0),
        }
      })
      const totals = orderTotals(priced)

      // Replaced rather than reconciled: a draft's lines have no receipts
      // hanging off them, so there is nothing to preserve by matching them up.
      await prisma.$transaction([
        prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } }),
        prisma.purchaseOrder.update({
          where: { id },
          data: {
            supplierId: body.supplierId || undefined,
            expectedDate: draftDate(body.expectedDate),
            notes: draftNotes(body.notes),
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            items: {
              create: priced.map((line, index) => ({
                itemId: line.itemId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                amount: totals.lines[index].amount,
              })),
            },
          },
        }),
      ])
    } else {
      await prisma.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: body.supplierId || undefined,
          expectedDate: draftDate(body.expectedDate),
          notes: draftNotes(body.notes),
        },
      })
    }

    return NextResponse.json({ success: true, message: 'Purchase order updated' })
  } catch (err: any) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Error updating purchase order:', err)
    return NextResponse.json({ error: 'Failed to update purchase order' }, { status: 500 })
  }
}

/** DELETE — a draft only. Anything placed is cancelled, not removed. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('inventory:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const existing = await prisma.purchaseOrder.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: { id: true, status: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    if (existing.status !== PurchaseOrderStatus.DRAFT) {
      return NextResponse.json(
        { error: 'This order has been placed. Cancel it instead of deleting it.' },
        { status: 409 }
      )
    }

    await prisma.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date() } })

    return NextResponse.json({ success: true, message: 'Draft deleted' })
  } catch (err: any) {
    console.error('Error deleting purchase order:', err)
    return NextResponse.json({ error: 'Failed to delete purchase order' }, { status: 500 })
  }
}
