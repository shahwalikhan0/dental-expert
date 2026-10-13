import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { PurchaseOrderStatus, StockTransactionType } from '@prisma/client'
import { canReceive, checkReceipt, isExpired, receiptStatusFor } from '@/lib/purchase-orders'
import type { ReceiptLine } from '@/lib/purchase-orders'
import { reconcileBatchExpiry, reconcileStockAlerts } from '@/lib/stock-alerts'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

/**
 * A refusal found part-way through the lines. Thrown rather than returned so
 * the transaction rolls back: returning from the callback commits whatever
 * the earlier lines already wrote, and half a delivery on the books is the
 * discrepancy this route exists to prevent.
 */
class ReceiptRefusal extends Error {
  readonly status: 400 | 404

  constructor(status: 400 | 404, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * POST — book a delivery in against an order.
 *
 * This is the missing link the whole chain hung on. It is the only thing in the
 * application that creates an `InventoryBatch`, and therefore the only way an
 * expiry date ever enters the system: until now, batches existed only because
 * the seed made them, so on a real clinic's data FR-016's near-expiry alerts
 * had nothing to look at and FR-017's batch traceability had nothing to trace.
 *
 * Everything happens in one transaction. A receipt that raised the stock level
 * but failed to record the movement would be a discrepancy nobody could explain
 * at the next stock take, which is precisely what FR-017 exists to prevent.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('inventory:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const receipts: ReceiptLine[] = Array.isArray(body.items) ? body.items : []
    const receivedOn = body.receivedDate ? new Date(body.receivedDate) : new Date()

    if (Number.isNaN(receivedOn.getTime())) {
      return NextResponse.json({ error: 'That received date is not a date' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id, hospitalId, deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          supplierId: true,
          items: {
            select: {
              id: true,
              itemId: true,
              quantity: true,
              receivedQty: true,
              unitPrice: true,
              item: {
                select: {
                  id: true,
                  name: true,
                  currentStock: true,
                  minimumStock: true,
                  batchTracking: true,
                  expiryTracking: true,
                },
              },
            },
          },
        },
      })

      if (!order) return { status: 404 as const, error: 'Purchase order not found' }

      if (!canReceive(order.status)) {
        return {
          status: 409 as const,
          error:
            order.status === PurchaseOrderStatus.DRAFT
              ? 'Place this order with the supplier before receiving against it'
              : `An order that is ${order.status.toLowerCase().replace('_', ' ')} cannot receive goods`,
        }
      }

      const check = checkReceipt(
        order.items.map((line) => ({
          id: line.id,
          itemId: line.itemId,
          itemName: line.item.name,
          quantity: line.quantity,
          receivedQty: line.receivedQty,
          batchTracking: line.item.batchTracking,
          expiryTracking: line.item.expiryTracking,
        })),
        receipts
      )

      if (!check.ok) return { status: 400 as const, error: check.error }

      const lineById = new Map(order.items.map((line) => [line.id, line]))
      const received: { itemId: string; name: string; quantity: number; newStock: number }[] = []
      const touchedBatches: string[] = []

      for (const receipt of receipts) {
        const line = lineById.get(receipt.lineId)!
        const batchNumber = receipt.batchNumber?.trim() || null

        // Re-read the stock level inside the transaction rather than trusting
        // the one that came back with the order: two deliveries booked in at
        // once must not each start from the same "previous stock".
        //
        // Scoped to the clinic as well as the id. The order was already
        // checked, but this is the query that decides which row gets more
        // stock, and it should not be the one place that takes an item id on
        // trust.
        const item = await tx.inventoryItem.findFirst({
          where: { id: line.itemId, hospitalId, deletedAt: null },
          select: { currentStock: true, minimumStock: true },
        })

        if (!item) {
          throw new ReceiptRefusal(404, `${line.item.name} is no longer in the catalogue`)
        }

        const previousStock = item.currentStock
        const newStock = previousStock + receipt.quantity

        let batchId: string | null = null

        if (batchNumber) {
          // A batch that is already on the books keeps its own expiry date —
          // the upsert below only adds to it — so that is the date to check.
          // LIG-OLD, expired since January 2025, took fifty more cartridges
          // because nobody looked (finding 43).
          const known = await tx.inventoryBatch.findUnique({
            where: {
              hospitalId_itemId_batchNumber: { hospitalId, itemId: line.itemId, batchNumber },
            },
            select: { expiryDate: true },
          })

          if (known && isExpired(known.expiryDate)) {
            throw new ReceiptRefusal(
              400,
              `${line.item.name}: batch ${batchNumber} expired on ${known.expiryDate!.toISOString().slice(0, 10)} and cannot receive more stock`
            )
          }

          // A second delivery of the same batch adds to it. The unique index
          // makes a batch number one batch per item, and the outstanding-
          // quantity check above is what stops a receipt being entered twice.
          const batch = await tx.inventoryBatch.upsert({
            where: {
              hospitalId_itemId_batchNumber: { hospitalId, itemId: line.itemId, batchNumber },
            },
            create: {
              hospitalId,
              itemId: line.itemId,
              batchNumber,
              quantity: receipt.quantity,
              remainingQty: receipt.quantity,
              purchasePrice: line.unitPrice,
              expiryDate: receipt.expiryDate ? new Date(receipt.expiryDate) : null,
              manufacturingDate: receipt.manufacturingDate
                ? new Date(receipt.manufacturingDate)
                : null,
              supplierId: order.supplierId,
              receivedDate: receivedOn,
            },
            update: {
              quantity: { increment: receipt.quantity },
              remainingQty: { increment: receipt.quantity },
            },
            select: { id: true },
          })
          batchId = batch.id
          touchedBatches.push(batch.id)
        }

        await tx.stockTransaction.create({
          data: {
            hospitalId,
            itemId: line.itemId,
            type: StockTransactionType.PURCHASE,
            quantity: receipt.quantity,
            previousStock,
            newStock,
            batchId,
            batchNumber,
            supplierId: order.supplierId,
            referenceType: 'PurchaseOrder',
            referenceId: order.id,
            unitPrice: line.unitPrice,
            totalPrice: Number(line.unitPrice) * receipt.quantity,
            transactionDate: receivedOn,
            performedBy: session?.user?.id ?? null,
            notes: body.notes || null,
          },
        })

        await tx.inventoryItem.update({
          where: { id: line.itemId },
          data: { currentStock: newStock },
        })

        await tx.purchaseOrderItem.update({
          where: { id: line.id },
          data: { receivedQty: { increment: receipt.quantity } },
        })

        await reconcileStockAlerts(tx, {
          hospitalId,
          itemId: line.itemId,
          currentStock: newStock,
          minimumStock: item.minimumStock,
        })

        received.push({
          itemId: line.itemId,
          name: line.item.name,
          quantity: receipt.quantity,
          newStock,
        })
      }

      // A delivery close to its date is flagged now, not by tomorrow's sweep
      // (finding 43).
      await reconcileBatchExpiry(tx, hospitalId, touchedBatches)

      // Recomputed from the lines as they now stand, rather than inferred from
      // this receipt alone: a delivery completing the last outstanding line
      // closes the order even if it only covered one item.
      const lines = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: order.id },
        select: { quantity: true, receivedQty: true },
      })

      const status = receiptStatusFor(lines, order.status)

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status,
          receivedDate: status === PurchaseOrderStatus.RECEIVED ? receivedOn : undefined,
        },
      })

      return { status: 200 as const, orderNumber: order.orderNumber, orderStatus: status, received }
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    await recordAudit({
      hospitalId,
      userId: session?.user?.id,
      action: AUDIT_ACTIONS.GOODS_RECEIVED,
      entityType: 'PurchaseOrder',
      entityId: id,
      newValues: {
        orderNumber: result.orderNumber,
        status: result.orderStatus,
        received: result.received.map((r) => `${r.name} x${r.quantity}`),
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({
      success: true,
      data: { status: result.orderStatus, received: result.received },
      message:
        result.orderStatus === PurchaseOrderStatus.RECEIVED
          ? 'Order received in full'
          : 'Goods received',
    })
  } catch (err: any) {
    if (err instanceof ReceiptRefusal) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('Error receiving goods:', err)
    return NextResponse.json({ error: 'Failed to receive goods' }, { status: 500 })
  }
}
