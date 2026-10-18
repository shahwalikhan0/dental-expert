import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { InventoryItemType } from '@prisma/client'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { ITEM_NUMBER_FIELDS, negativeField, normaliseSku } from '@/lib/inventory-items'
import { reconcileStockAlerts } from '@/lib/stock-alerts'

// GET - Fetch all inventory items with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('inventory:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const category = searchParams.get('category') || ''
    const itemType = searchParams.get('type') || ''
    const status = searchParams.get('status') || 'all'
    const lowStock = searchParams.get('lowStock') === 'true'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    // Build where clause
    // Deleted items are kept for their history, not listed (finding 58).
    // GIC restorative stayed on this list with `deletedAt` set, because the
    // filter read `isActive` and nothing else.
    const where: any = {
      hospitalId,
      deletedAt: null,
      isActive: status === 'all' ? undefined : status === 'active',
    }

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Add category filter. The label is the identifier now — see
    // app/api/inventory/categories/route.ts.
    if (category) {
      where.category = category
    }

    // Add item type filter. The inventory page has always rendered this
    // control, but the route never read the parameter, so it did nothing.
    if (itemType && itemType in InventoryItemType) {
      where.itemType = itemType as InventoryItemType
    }

    // Fetch items with related data
    let items = await prisma.inventoryItem.findMany({
      where,
      include: {
        // The item's preferred supplier. This used to read the cheapest row in
        // `SupplierItem` — a table nothing ever wrote to, so the supplier
        // column on the inventory screen was always empty.
        preferredSupplier: { select: { id: true, name: true, phone: true } },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Transform data to include stock status
    let itemsWithStatus = items.map((item) => {
      let stockStatus = 'sufficient'
      if (item.currentStock <= 0) {
        stockStatus = 'out_of_stock'
      } else if (item.currentStock <= item.minimumStock) {
        stockStatus = 'low_stock'
      } else if (item.currentStock <= item.reorderLevel) {
        stockStatus = 'reorder'
      }

      return {
        ...item,
        stockStatus,
        categoryName: item.category,
        supplierName: item.preferredSupplier?.name || null,
      }
    })

    // Apply low stock filter in memory (Prisma doesn't support field-to-field comparison in where clause)
    if (lowStock) {
      itemsWithStatus = itemsWithStatus.filter(
        (item) => item.stockStatus === 'low_stock' || item.stockStatus === 'out_of_stock'
      )
    }

    // Calculate total after filtering
    const total = itemsWithStatus.length

    // Apply pagination manually
    const paginatedItems = itemsWithStatus.slice(skip, skip + limit)

    return NextResponse.json({
      success: true,
      data: paginatedItems,
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
    console.error('Error fetching inventory items:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory items' }, { status: 500 })
  }
}

// POST - Create new inventory item
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('inventory:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      sku,
      name,
      category,
      description,
      unit,
      currentStock = 0,
      minimumStock = 0,
      reorderLevel = 0,
      maximumStock,
      purchasePrice,
      sellingPrice,
      manufacturer,
      batchTracking = false,
      expiryTracking = false,
      storageLocation,
      storageConditions,
      isActive = true,
      // The new-item form has always sent these; until the model had them
      // they were silently discarded on every create.
      itemType,
      preferredSupplierId,
      taxCode,
      taxPercentage,
      imageUrl,
      notes,
      // Links this stock to a drug catalogue entry. See the comment on
      // InventoryItem.medicationId.
      medicationId,
    } = body

    // Validation
    if (!sku || !name || !unit || purchasePrice === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: sku, name, unit, purchasePrice' },
        { status: 400 }
      )
    }

    // Negative prices and negative opening stock (finding 57).
    const invalid = negativeField(body, ITEM_NUMBER_FIELDS)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    const normalisedSku = normaliseSku(sku)
    if (!normalisedSku) {
      return NextResponse.json({ error: 'The SKU cannot be blank' }, { status: 400 })
    }

    // Case-insensitive, and deleted items included: the unique index covers
    // them too, and a SKU held by a deleted item would otherwise surface as a
    // bare constraint error.
    const existing = await prisma.inventoryItem.findFirst({
      where: { hospitalId, sku: { equals: normalisedSku, mode: 'insensitive' } },
      select: { id: true, deletedAt: true },
    })

    if (existing) {
      return NextResponse.json(
        {
          error: existing.deletedAt
            ? `SKU ${normalisedSku} belongs to a deleted item. Choose another SKU.`
            : 'SKU already exists',
        },
        { status: 409 }
      )
    }

    const openingStock = Number(currentStock) || 0
    const price = Number(purchasePrice)

    const item = await prisma.$transaction(async (tx) => {
      // Create inventory item
      const created = await tx.inventoryItem.create({
        data: {
          hospitalId,
          sku: normalisedSku,
          name,
          category: category || null,
          description: description || null,
          unit,
          currentStock: openingStock,
          minimumStock: Number(minimumStock) || 0,
          reorderLevel: Number(reorderLevel) || 0,
          maximumStock: maximumStock || null,
          purchasePrice: price,
          sellingPrice: sellingPrice || null,
          manufacturer: manufacturer || null,
          batchTracking,
          expiryTracking,
          storageLocation: storageLocation || null,
          storageConditions: storageConditions || null,
          isActive,
          ...(itemType && itemType in InventoryItemType
            ? { itemType: itemType as InventoryItemType }
            : {}),
          preferredSupplierId: preferredSupplierId || null,
          taxCode: taxCode || null,
          taxPercentage: taxPercentage ?? null,
          imageUrl: imageUrl || null,
          notes: notes || null,
          // Only medicine may carry a catalogue link. Without this guard a form
          // that had the field filled in, then switched item type, would leave a
          // box of gloves pointing at amoxicillin and counting towards its stock.
          medicationId: itemType === 'MEDICINE' && medicationId ? medicationId : null,
        },
      })

      // If opening stock > 0, create a stock transaction
      if (openingStock > 0) {
        // A batch-tracked item has its opening stock in a batch of its own, so
        // its batches add up to its stock from the first day and the stock can
        // be consumed — every movement of it names a batch (finding 19).
        const batch = batchTracking
          ? await tx.inventoryBatch.create({
              data: {
                hospitalId,
                itemId: created.id,
                batchNumber: 'OPENING',
                quantity: openingStock,
                remainingQty: openingStock,
                purchasePrice: price,
              },
              select: { id: true, batchNumber: true },
            })
          : null

        await tx.stockTransaction.create({
          data: {
            hospitalId,
            itemId: created.id,
            type: 'ADJUSTMENT_IN',
            quantity: openingStock,
            previousStock: 0,
            newStock: openingStock,
            unitPrice: price,
            totalPrice: openingStock * price,
            batchId: batch?.id ?? null,
            batchNumber: batch?.batchNumber ?? null,
            notes: 'Opening stock entry',
            performedBy: session?.user?.id || null,
          },
        })
      }

      // An item created at or below its minimum is short from the moment it
      // exists, and says so now rather than at the overnight sweep (findings
      // 43 and 57).
      await reconcileStockAlerts(tx, {
        hospitalId,
        itemId: created.id,
        currentStock: openingStock,
        minimumStock: Number(minimumStock) || 0,
      })

      return created
    })

    await recordAudit({
      hospitalId,
      userId: session?.user?.id ?? null,
      action: AUDIT_ACTIONS.INVENTORY_ITEM_CREATED,
      entityType: 'InventoryItem',
      entityId: item.id,
      newValues: {
        sku: item.sku,
        name: item.name,
        itemType: item.itemType,
        unit: item.unit,
        openingStock,
        minimumStock: item.minimumStock,
        purchasePrice: price,
        sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json(
      {
        success: true,
        data: item,
        message: 'Inventory item created successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating inventory item:', error)
    return NextResponse.json({ error: 'Failed to create inventory item' }, { status: 500 })
  }
}
