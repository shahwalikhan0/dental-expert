import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { reconcileStockAlerts } from '@/lib/stock-alerts'
import { Prisma, StockTransactionType } from '@prisma/client'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import {
  ITEM_NUMBER_FIELDS,
  negativeField,
  normaliseSku,
  OPEN_ORDER_STATUSES,
} from '@/lib/inventory-items'

function stockStatus(currentStock: number, minimumStock: number, reorderLevel: number) {
  if (currentStock <= 0) return 'out_of_stock'
  if (currentStock <= minimumStock) return 'low_stock'
  if (currentStock <= reorderLevel) return 'reorder'
  return 'sufficient'
}

// GET - Fetch single inventory item
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('inventory:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const item = await prisma.inventoryItem.findFirst({
      where: { id, hospitalId, deletedAt: null },
      include: {
        preferredSupplier: { select: { name: true, phone: true, email: true } },
      },
    })

    if (!item) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
    }

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [batchCount, purchases, usage, batches, transactions] = await Promise.all([
      prisma.inventoryBatch.count({ where: { itemId: id } }),
      prisma.stockTransaction.aggregate({
        _sum: { quantity: true },
        where: {
          itemId: id,
          type: StockTransactionType.PURCHASE,
          transactionDate: { gte: thirtyDaysAgo },
        },
      }),
      prisma.stockTransaction.aggregate({
        _sum: { quantity: true },
        where: {
          itemId: id,
          // The legacy query counted 'sale' and 'usage'; 'usage' is CONSUMPTION here.
          type: { in: [StockTransactionType.SALE, StockTransactionType.CONSUMPTION] },
          transactionDate: { gte: thirtyDaysAgo },
        },
      }),
      item.batchTracking
        ? prisma.inventoryBatch.findMany({
            where: { itemId: id },
            orderBy: [{ expiryDate: 'asc' }, { receivedDate: 'desc' }],
            include: { supplier: { select: { name: true } } },
          })
        : Promise.resolve([]),
      prisma.stockTransaction.findMany({
        where: { itemId: id },
        orderBy: { transactionDate: 'desc' },
        take: 20,
        include: { supplier: { select: { name: true } } },
      }),
    ])

    // performedBy is a bare user id, so resolve the names in one extra query
    // rather than a relation the model does not declare.
    const performerIds = [...new Set(transactions.map((t) => t.performedBy).filter(Boolean))]
    const performers = performerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: performerIds as string[] } },
          select: { id: true, name: true },
        })
      : []
    const performerNames = new Map(performers.map((u) => [u.id, u.name]))

    const { preferredSupplier, ...rest } = item

    return NextResponse.json({
      success: true,
      data: {
        ...rest,
        categoryName: item.category,
        supplierName: preferredSupplier?.name ?? null,
        supplierPhone: preferredSupplier?.phone ?? null,
        supplierEmail: preferredSupplier?.email ?? null,
        stockStatus: stockStatus(item.currentStock, item.minimumStock, item.reorderLevel),
        batchCount,
        purchasesLast30Days: purchases._sum.quantity ?? 0,
        usageLast30Days: usage._sum.quantity ?? 0,
        batches: batches.map(({ supplier, ...batch }) => ({
          ...batch,
          supplierName: supplier?.name ?? null,
        })),
        recentTransactions: transactions.map(({ supplier, ...tx }) => ({
          ...tx,
          supplierName: supplier?.name ?? null,
          performedByName: tx.performedBy ? (performerNames.get(tx.performedBy) ?? null) : null,
        })),
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching inventory item:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory item' }, { status: 500 })
  }
}

// PUT - Update inventory item
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('inventory:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.inventoryItem.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: { id: true, sku: true, currentStock: true, minimumStock: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
    }

    // Negative prices and levels (finding 57). Opening stock is not edited
    // here — stock moves through transactions — so it is not checked.
    const invalid = negativeField(
      body,
      ITEM_NUMBER_FIELDS.filter((f) => f.name !== 'currentStock')
    )
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    // One spelling, compared case-insensitively, deleted items included —
    // the unique index covers them too (finding 57).
    let sku: string | undefined
    if (body.sku != null) {
      const normalised = normaliseSku(body.sku)
      if (!normalised) {
        return NextResponse.json({ error: 'The SKU cannot be blank' }, { status: 400 })
      }
      sku = normalised

      if (normalised !== existing.sku) {
        const duplicate = await prisma.inventoryItem.findFirst({
          where: {
            sku: { equals: normalised, mode: 'insensitive' },
            hospitalId,
            id: { not: id },
          },
          select: { id: true },
        })

        if (duplicate) {
          return NextResponse.json({ error: 'Item code already exists' }, { status: 409 })
        }
      }
    }

    // Nullable columns were unconditionally overwritten by the old UPDATE;
    // the COALESCE'd ones were left alone when absent.
    const data: Prisma.InventoryItemUpdateInput = {
      description: body.description ?? null,
      maximumStock: body.maximumStock ?? null,
      taxCode: body.taxCode ?? null,
      storageLocation: body.storageLocation ?? null,
      imageUrl: body.imageUrl ?? null,
      notes: body.notes ?? null,
    }

    if (sku) data.sku = sku
    if (body.name != null) data.name = body.name
    if (body.itemType != null) data.itemType = body.itemType
    if (body.unit != null) data.unit = body.unit
    if (body.minimumStock != null) data.minimumStock = body.minimumStock
    if (body.reorderLevel != null) data.reorderLevel = body.reorderLevel
    if (body.purchasePrice != null) data.purchasePrice = body.purchasePrice
    if (body.sellingPrice != null) data.sellingPrice = body.sellingPrice
    if (body.taxPercentage != null) data.taxPercentage = body.taxPercentage
    if (body.expiryTracking != null) data.expiryTracking = body.expiryTracking
    if (body.batchTracking != null) data.batchTracking = body.batchTracking
    if (body.isActive != null) data.isActive = body.isActive

    // Cleared whenever the item is not medicine, so changing the type of an
    // item that was once a drug does not leave a box of gloves pointing at
    // amoxicillin and counting towards its stock.
    data.medication =
      body.itemType === 'MEDICINE' && body.medicationId
        ? { connect: { id: body.medicationId } }
        : { disconnect: true }

    data.category = body.category || null
    data.preferredSupplier = body.preferredSupplierId
      ? { connect: { id: body.preferredSupplierId } }
      : { disconnect: true }

    await prisma.inventoryItem.update({ where: { id }, data })

    // Changing the minimum can raise an alert — and, now, clear one. This used
    // only to raise: lowering an item's minimum back down left the LOW_STOCK
    // alert standing over a full shelf, and the only way to be rid of it was to
    // acknowledge something that was no longer true.
    await reconcileStockAlerts(prisma, {
      hospitalId,
      itemId: id,
      currentStock: existing.currentStock,
      minimumStock: body.minimumStock ?? existing.minimumStock,
    })

    return NextResponse.json({ success: true, message: 'Inventory item updated successfully' })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating inventory item:', error)
    return NextResponse.json({ error: 'Failed to update inventory item' }, { status: 500 })
  }
}

// DELETE - Soft delete when the item has any history, hard delete otherwise
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, session } = await requirePermission('inventory:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const existing = await prisma.inventoryItem.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: { id: true, sku: true, name: true, currentStock: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
    }

    // Not while it is on a live order (finding 44). GIC restorative was
    // deleted while on draft order PO20260002, and the draft was then sent
    // for a deleted item. Cancel the order, or take the line off it, first.
    const openOrders = await prisma.purchaseOrder.findMany({
      where: {
        hospitalId,
        deletedAt: null,
        status: { in: OPEN_ORDER_STATUSES },
        items: { some: { itemId: id } },
      },
      select: { orderNumber: true },
      take: 3,
    })

    if (openOrders && openOrders.length > 0) {
      return NextResponse.json(
        {
          error: `${existing.name} is on open purchase order ${openOrders
            .map((o) => o.orderNumber)
            .join(', ')}. Cancel the order or remove the item from it first.`,
        },
        { status: 409 }
      )
    }

    // Anything that refers to the item keeps it: movements, batches and order
    // lines are its history, and the batch and order-line foreign keys would
    // refuse a hard delete anyway.
    const [transactionCount, batchCount, orderLineCount] = await Promise.all([
      prisma.stockTransaction.count({ where: { itemId: id } }),
      prisma.inventoryBatch.count({ where: { itemId: id } }),
      prisma.purchaseOrder.count({ where: { hospitalId, items: { some: { itemId: id } } } }),
    ])

    if (transactionCount > 0 || batchCount > 0 || orderLineCount > 0) {
      await prisma.inventoryItem.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      })
    } else {
      await prisma.inventoryItem.delete({ where: { id } })
    }

    // Finding 24: items were deleted with nothing in the audit log.
    await recordAudit({
      hospitalId,
      userId: session?.user?.id,
      action: AUDIT_ACTIONS.INVENTORY_ITEM_DELETED,
      entityType: 'InventoryItem',
      entityId: id,
      oldValues: { sku: existing.sku, name: existing.name, currentStock: existing.currentStock },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ success: true, message: 'Inventory item deleted successfully' })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting inventory item:', error)
    return NextResponse.json({ error: 'Failed to delete inventory item' }, { status: 500 })
  }
}
