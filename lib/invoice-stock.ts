import { Prisma, StockTransactionType } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { BillingRefusal } from '@/lib/invoice-settlement'
import { isExpired } from '@/lib/purchase-orders'
import { reconcileBatchExpiry, reconcileStockAlerts } from '@/lib/stock-alerts'

/**
 * Products sold on an invoice leave stock when it is issued, and come back if
 * it is cancelled (invoice review 4.5).
 *
 * A toothbrush or whitening kit sold over the counter used to be typed as a
 * free-text line, so the shelf never went down and the stock screen said there
 * were kits the clinic had already sold. Stock moves on *issue*, not on the
 * draft: a draft is a bill being prepared, and holding stock for one would
 * leave the shelf short for a sale that may never happen.
 *
 * Both run inside the transaction that issues or cancels the invoice, after
 * its row lock, so a refusal here (not enough on the shelf) rolls the whole
 * issue back and the invoice stays a draft.
 */

type Db = PrismaClient | Prisma.TransactionClient

/** How a sale and its return are tied to the invoice on the stock ledger. */
export const INVOICE_REFERENCE = 'Invoice'

/**
 * Hold the inventory rows these lines sell until the transaction ends.
 *
 * In id order, so two invoices selling the same two products cannot each hold
 * one and wait for the other. The item lock serialises every invoice moving
 * this product's stock; the hand-entered movements route guards its own writes
 * on the level it read, and that guard is kept on the writes below too.
 */
async function lockItems(db: Db, hospitalId: string, itemIds: string[]): Promise<void> {
  const ids = [...new Set(itemIds)].sort()
  if (ids.length === 0) return
  await db.$queryRaw`
    SELECT "id" FROM "InventoryItem"
    WHERE "id" IN (${Prisma.join(ids)}) AND "hospitalId" = ${hospitalId}
    ORDER BY "id"
    FOR UPDATE
  `
}

interface SoldLine {
  inventoryItemId: string | null
  description: string
  quantity: number
  unitPrice: unknown
}

/**
 * Take the products on an invoice out of stock, as SALE movements referencing
 * the invoice.
 *
 * Refused, by name, when the shelf holds fewer than the invoice sells. A
 * batch-tracked product is taken from its batches first-expiry-first-out —
 * the batch that expires soonest goes first, undated batches last — and never
 * from an expired batch: selling a patient an expired product is not a stock
 * question. Each batch drawn on gets its own movement, so the batches keep
 * adding up to the item, as the stock screen expects.
 */
export async function deductInvoiceStock(
  db: Db,
  args: {
    hospitalId: string
    invoiceId: string
    invoiceNo: string
    userId: string | null
    lines: SoldLine[]
  }
): Promise<void> {
  const { hospitalId, invoiceId, invoiceNo, userId } = args
  const sold = args.lines.filter(
    (line): line is SoldLine & { inventoryItemId: string } => !!line.inventoryItemId
  )
  if (sold.length === 0) return

  await lockItems(
    db,
    hospitalId,
    sold.map((line) => line.inventoryItemId)
  )

  const now = new Date()
  const touchedBatches: string[] = []

  for (const line of sold) {
    // Read per line, not per item: the same product on two lines takes from
    // what the first line left.
    const item = await db.inventoryItem.findFirst({
      where: { id: line.inventoryItemId, hospitalId, deletedAt: null },
      select: {
        id: true,
        name: true,
        unit: true,
        currentStock: true,
        minimumStock: true,
        batchTracking: true,
      },
    })
    if (!item) {
      throw new BillingRefusal(
        409,
        `${line.description} is no longer in the inventory, so it cannot be sold. Remove the line, then issue the invoice.`
      )
    }

    const quantity = Number(line.quantity)
    if (item.currentStock < quantity) {
      throw new BillingRefusal(
        409,
        `Only ${item.currentStock} ${item.unit} of ${item.name} in stock; this invoice sells ${quantity}`
      )
    }

    // Which batches the sale comes from: none for an item not tracked by
    // batch, otherwise the soonest-expiring unexpired stock first.
    const draws: { batchId: string | null; batchNumber: string | null; quantity: number }[] = []
    if (item.batchTracking) {
      const batches = await db.inventoryBatch.findMany({
        where: { hospitalId, itemId: item.id, remainingQty: { gt: 0 } },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedDate: 'asc' }],
        select: { id: true, batchNumber: true, remainingQty: true, expiryDate: true },
      })
      const usable = (batches ?? []).filter((b) => !isExpired(b.expiryDate, now))
      let wanted = quantity
      for (const batch of usable) {
        if (wanted <= 0) break
        const take = Math.min(batch.remainingQty, wanted)
        draws.push({ batchId: batch.id, batchNumber: batch.batchNumber, quantity: take })
        wanted -= take
      }
      if (wanted > 0) {
        const available = quantity - wanted
        throw new BillingRefusal(
          409,
          `Only ${available} ${item.unit} of ${item.name} is in unexpired batches; this invoice sells ${quantity}`
        )
      }
    } else {
      draws.push({ batchId: null, batchNumber: null, quantity })
    }

    const unitPrice = Number(line.unitPrice ?? 0)
    let level = item.currentStock
    for (const draw of draws) {
      await db.stockTransaction.create({
        data: {
          hospitalId,
          itemId: item.id,
          type: StockTransactionType.SALE,
          quantity: draw.quantity,
          previousStock: level,
          newStock: level - draw.quantity,
          batchId: draw.batchId,
          batchNumber: draw.batchNumber,
          referenceType: INVOICE_REFERENCE,
          referenceId: invoiceId,
          unitPrice,
          totalPrice: unitPrice * draw.quantity,
          transactionDate: now,
          performedBy: userId,
          notes: `Sold on ${invoiceNo}`,
        },
      })
      level -= draw.quantity

      if (draw.batchId) {
        // Guarded as the movements route guards it: never below zero, even if
        // a hand-entered movement took from the batch since it was read.
        const batchWrite = await db.inventoryBatch.updateMany({
          where: { id: draw.batchId, remainingQty: { gte: draw.quantity } },
          data: { remainingQty: { decrement: draw.quantity } },
        })
        if (batchWrite.count !== 1) {
          throw new BillingRefusal(
            409,
            `Batch ${draw.batchNumber} of ${item.name} was changed by somebody else just now. Try again.`
          )
        }
        touchedBatches.push(draw.batchId)
      }
    }

    const itemWrite = await db.inventoryItem.updateMany({
      where: { id: item.id, currentStock: item.currentStock },
      data: { currentStock: level },
    })
    if (itemWrite.count !== 1) {
      throw new BillingRefusal(
        409,
        `${item.name} was changed by somebody else just now. Try again.`
      )
    }

    await reconcileStockAlerts(db, {
      hospitalId,
      itemId: item.id,
      currentStock: level,
      minimumStock: item.minimumStock,
    })
  }

  await reconcileBatchExpiry(db, hospitalId, touchedBatches)
}

/**
 * Put back what an invoice sold, when it is cancelled.
 *
 * Read from the SALE movements that reference the invoice rather than from its
 * lines, so exactly what left comes back, to the batches it left from. Written
 * as ADJUSTMENT_IN referencing the invoice: RETURNED on this ledger means
 * "returned to the supplier" and is counted as stock going *out* by the
 * inventory reports, so using it here would have shown a cancelled sale as a
 * second loss. Does nothing if the invoice sold nothing, or its stock has
 * already come back.
 */
export async function returnInvoiceStock(
  db: Db,
  args: { hospitalId: string; invoiceId: string; invoiceNo: string; userId: string | null }
): Promise<void> {
  const { hospitalId, invoiceId, invoiceNo, userId } = args
  const reference = { hospitalId, referenceType: INVOICE_REFERENCE, referenceId: invoiceId }

  const sales =
    (await db.stockTransaction.findMany({
      where: { ...reference, type: StockTransactionType.SALE },
      select: { itemId: true, batchId: true, batchNumber: true, quantity: true, unitPrice: true },
      orderBy: { createdAt: 'asc' },
    })) ?? []
  if (sales.length === 0) return

  const returned = await db.stockTransaction.findFirst({
    where: { ...reference, type: StockTransactionType.ADJUSTMENT_IN },
    select: { id: true },
  })
  if (returned) return

  await lockItems(
    db,
    hospitalId,
    sales.map((sale) => sale.itemId)
  )

  const now = new Date()
  const touchedBatches: string[] = []

  for (const sale of sales) {
    const item = await db.inventoryItem.findFirst({
      where: { id: sale.itemId, hospitalId },
      select: { id: true, currentStock: true, minimumStock: true },
    })
    // A product deleted since the sale has no shelf to go back to; the
    // invoice is still cancelled.
    if (!item) continue

    const newStock = item.currentStock + sale.quantity
    await db.stockTransaction.create({
      data: {
        hospitalId,
        itemId: item.id,
        type: StockTransactionType.ADJUSTMENT_IN,
        quantity: sale.quantity,
        previousStock: item.currentStock,
        newStock,
        batchId: sale.batchId,
        batchNumber: sale.batchNumber,
        referenceType: INVOICE_REFERENCE,
        referenceId: invoiceId,
        unitPrice: sale.unitPrice,
        totalPrice: sale.unitPrice != null ? Number(sale.unitPrice) * sale.quantity : null,
        transactionDate: now,
        performedBy: userId,
        notes: `Back in stock: ${invoiceNo} was cancelled`,
      },
    })
    await db.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } })

    if (sale.batchId) {
      await db.inventoryBatch.updateMany({
        where: { id: sale.batchId },
        data: { remainingQty: { increment: sale.quantity } },
      })
      touchedBatches.push(sale.batchId)
    }

    await reconcileStockAlerts(db, {
      hospitalId,
      itemId: item.id,
      currentStock: newStock,
      minimumStock: item.minimumStock,
    })
  }

  await reconcileBatchExpiry(db, hospitalId, touchedBatches)
}
