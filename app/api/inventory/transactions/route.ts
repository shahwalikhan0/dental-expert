import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { reconcileBatchExpiry, reconcileStockAlerts } from '@/lib/stock-alerts'
import { Prisma, StockTransactionType } from '@prisma/client'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { knownErrorResponse } from '@/lib/api-errors'

const TRANSACTION_TYPES = Object.values(StockTransactionType) as string[]

/**
 * Which way each transaction type moves stock.
 *
 * RETURNED subtracts: in the legacy switch 'return' sat with sale/usage/wastage,
 * i.e. stock going back to the supplier rather than coming back from a patient.
 * TRANSFERRED is net-neutral - it moves stock between fromLocation and
 * toLocation without changing the total on hand.
 */
const INBOUND: StockTransactionType[] = [
  StockTransactionType.PURCHASE,
  StockTransactionType.ADJUSTMENT_IN,
]
const OUTBOUND: StockTransactionType[] = [
  StockTransactionType.SALE,
  StockTransactionType.ADJUSTMENT_OUT,
  StockTransactionType.DAMAGED,
  StockTransactionType.EXPIRED,
  StockTransactionType.RETURNED,
  StockTransactionType.CONSUMPTION,
]

/**
 * Movements somebody records by hand that change what is on the shelf
 * without a delivery or a sale behind them — the ones an auditor asks about
 * (bug report 12 Oct, finding 24).
 */
const AUDITED: StockTransactionType[] = [
  StockTransactionType.ADJUSTMENT_IN,
  StockTransactionType.ADJUSTMENT_OUT,
  StockTransactionType.CONSUMPTION,
  StockTransactionType.DAMAGED,
  StockTransactionType.EXPIRED,
]

/**
 * A refusal found inside the transaction. Thrown so nothing written before it
 * is kept — returning from the callback would commit.
 */
class MovementRefusal extends Error {
  readonly status: 400 | 404 | 409

  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

function parseType(value: unknown): StockTransactionType | null {
  if (typeof value !== 'string') return null
  const upper = value.toUpperCase()
  return TRANSACTION_TYPES.includes(upper) ? (upper as StockTransactionType) : null
}

// GET - Fetch stock transactions
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('inventory:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const itemId = searchParams.get('itemId')
    const transactionType = parseType(searchParams.get('type'))
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    const where: Prisma.StockTransactionWhereInput = { hospitalId }

    if (itemId) where.itemId = itemId
    if (transactionType) where.type = transactionType

    if (startDate || endDate) {
      where.transactionDate = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      }
    }

    const [total, transactions] = await Promise.all([
      prisma.stockTransaction.count({ where }),
      prisma.stockTransaction.findMany({
        where,
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          item: { select: { name: true, sku: true } },
          supplier: { select: { name: true } },
          batch: { select: { batchNumber: true } },
        },
      }),
    ])

    // performedBy is a bare user id, so resolve names in one extra query.
    const performerIds = [...new Set(transactions.map((t) => t.performedBy).filter(Boolean))]
    const performers = performerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: performerIds as string[] } },
          select: { id: true, name: true },
        })
      : []
    const performerNames = new Map(performers.map((u) => [u.id, u.name]))

    return NextResponse.json({
      success: true,
      data: transactions.map(({ item, supplier, batch, ...tx }) => ({
        ...tx,
        itemName: item.name,
        sku: item.sku,
        supplierName: supplier?.name ?? null,
        batchNumber: batch?.batchNumber ?? tx.batchNumber ?? null,
        performedByName: tx.performedBy ? (performerNames.get(tx.performedBy) ?? null) : null,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching stock transactions:', error)
    return NextResponse.json({ error: 'Failed to fetch stock transactions' }, { status: 500 })
  }
}

// POST - Create stock transaction (adjustment, usage, wastage, etc.)
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('inventory:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      itemId,
      batchId,
      quantity,
      unitPrice,
      transactionDate,
      referenceType,
      referenceId,
      fromLocation,
      toLocation,
      supplierId,
      notes,
    } = body

    const type = parseType(body.type)

    if (!type || !itemId || !quantity || !transactionDate) {
      return NextResponse.json(
        { error: 'Missing required fields: type, itemId, quantity, transactionDate' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json(
        { error: 'quantity must be a positive whole number' },
        { status: 400 }
      )
    }

    if (unitPrice != null && (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0)) {
      return NextResponse.json(
        { error: 'unitPrice must be a number of zero or more' },
        { status: 400 }
      )
    }

    const movedOn = new Date(transactionDate)
    if (Number.isNaN(movedOn.getTime())) {
      return NextResponse.json({ error: 'transactionDate is not a date' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, hospitalId, deletedAt: null },
        select: {
          id: true,
          name: true,
          currentStock: true,
          minimumStock: true,
          purchasePrice: true,
          batchTracking: true,
        },
      })

      if (!item) {
        throw new MovementRefusal(404, 'Inventory item not found')
      }

      // +quantity, −quantity, or 0 for a transfer between locations.
      const delta = INBOUND.includes(type) ? quantity : OUTBOUND.includes(type) ? -quantity : 0

      /**
       * The batch, checked (finding 19). This route used to check only the
       * item's total: a batch of 50 was consumed by 60 and left at −10, a
       * gloves adjustment carrying a lignocaine batch id moved the lignocaine
       * batch, and a batch-tracked item was consumed with no batch at all —
       * until lignocaine said 89 in stock while its batches added up to 41.
       *
       * A batch-tracked item names its batch on every movement that changes
       * the count, so the batches keep adding up to the item. A new batch
       * arrives through goods receipt, which is where its number and expiry
       * date are recorded.
       */
      let batch: { id: string; batchNumber: string; remainingQty: number } | null = null

      if (batchId) {
        batch = await tx.inventoryBatch.findFirst({
          where: { id: batchId, hospitalId, itemId },
          select: { id: true, batchNumber: true, remainingQty: true },
        })
        if (!batch) {
          throw new MovementRefusal(400, `That batch is not a batch of ${item.name}`)
        }
      } else if (item.batchTracking && delta !== 0) {
        throw new MovementRefusal(
          400,
          delta < 0
            ? `${item.name} is batch-tracked: choose the batch the stock came from`
            : `${item.name} is batch-tracked: choose the batch, or receive a new batch against a purchase order`
        )
      }

      if (batch && delta < 0 && batch.remainingQty < quantity) {
        throw new MovementRefusal(
          400,
          `Batch ${batch.batchNumber} holds only ${batch.remainingQty} of ${item.name}`
        )
      }

      const previousStock = item.currentStock
      const newStock = previousStock + delta

      if (newStock < 0) {
        throw new MovementRefusal(400, 'Insufficient stock for this transaction')
      }

      const effectiveUnitPrice = unitPrice != null ? Number(unitPrice) : Number(item.purchasePrice)

      const created = await tx.stockTransaction.create({
        data: {
          hospitalId,
          itemId,
          batchId: batch?.id ?? null,
          batchNumber: batch?.batchNumber ?? null,
          type,
          quantity,
          previousStock,
          newStock,
          unitPrice: effectiveUnitPrice,
          totalPrice: quantity * effectiveUnitPrice,
          transactionDate: movedOn,
          referenceType: referenceType || null,
          referenceId: referenceId || null,
          fromLocation: fromLocation || null,
          toLocation: toLocation || null,
          supplierId: supplierId || null,
          performedBy: session?.user?.id ?? null,
          notes: notes || null,
        },
        select: { id: true },
      })

      // Conditional on the stock level read above, so two movements recorded
      // at once cannot both start from the same figure and lose one of them.
      const itemWrite = await tx.inventoryItem.updateMany({
        where: { id: itemId, currentStock: previousStock },
        data: { currentStock: newStock },
      })
      if (itemWrite.count !== 1) {
        throw new MovementRefusal(
          409,
          `${item.name} was changed by somebody else just now. Try again.`
        )
      }

      if (batch && delta !== 0) {
        // The same guard on the batch: it may not go below zero even if
        // another movement took from it between the read and this write.
        const batchWrite = await tx.inventoryBatch.updateMany({
          where: { id: batch.id, ...(delta < 0 ? { remainingQty: { gte: quantity } } : {}) },
          data: {
            remainingQty: delta < 0 ? { decrement: quantity } : { increment: quantity },
          },
        })
        if (batchWrite.count !== 1) {
          throw new MovementRefusal(
            409,
            `Batch ${batch.batchNumber} was changed by somebody else just now. Try again.`
          )
        }
      }

      await reconcileStockAlerts(tx, {
        hospitalId,
        itemId,
        currentStock: newStock,
        minimumStock: item.minimumStock,
      })

      // A batch used up no longer warrants its expiry alert, and one topped
      // up may now warrant one.
      if (batch && delta !== 0) await reconcileBatchExpiry(tx, hospitalId, [batch.id])

      return {
        id: created.id,
        newStock,
        previousStock,
        itemName: item.name,
        batchNumber: batch?.batchNumber ?? null,
      }
    })

    if (AUDITED.includes(type)) {
      await recordAudit({
        hospitalId,
        userId: session?.user?.id,
        action: AUDIT_ACTIONS.STOCK_ADJUSTED,
        entityType: 'InventoryItem',
        entityId: itemId,
        oldValues: { currentStock: result.previousStock },
        newValues: {
          item: result.itemName,
          type,
          quantity,
          batch: result.batchNumber,
          currentStock: result.newStock,
          notes: notes || null,
        },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json(
      {
        success: true,
        data: { id: result.id, newStock: result.newStock },
        message: 'Stock transaction recorded successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof MovementRefusal) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating stock transaction:', error)
    return NextResponse.json({ error: 'Failed to create stock transaction' }, { status: 500 })
  }
}
