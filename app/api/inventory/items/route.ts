import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { InventoryItemType } from '@prisma/client'

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
    const where: any = {
      hospitalId,
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
  } catch (error: any) {
    console.error('Error fetching inventory items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory items', details: error.message },
      { status: 500 }
    )
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

    // Check if SKU already exists
    const existing = await prisma.inventoryItem.findUnique({
      where: { hospitalId_sku: { hospitalId, sku } },
    })

    if (existing) {
      return NextResponse.json({ error: 'SKU already exists' }, { status: 409 })
    }

    // Create inventory item
    const item = await prisma.inventoryItem.create({
      data: {
        hospitalId,
        sku,
        name,
        category: category || null,
        description: description || null,
        unit,
        currentStock,
        minimumStock,
        reorderLevel,
        maximumStock: maximumStock || null,
        purchasePrice,
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
    if (currentStock > 0) {
      await prisma.stockTransaction.create({
        data: {
          hospitalId,
          itemId: item.id,
          type: 'ADJUSTMENT_IN',
          quantity: currentStock,
          previousStock: 0,
          newStock: currentStock,
          unitPrice: purchasePrice,
          totalPrice: currentStock * purchasePrice,
          notes: 'Opening stock entry',
          performedBy: session?.user?.id || null,
        },
      })
    }

    return NextResponse.json(
      {
        success: true,
        data: item,
        message: 'Inventory item created successfully',
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Error creating inventory item:', error)
    return NextResponse.json(
      { error: 'Failed to create inventory item', details: error.message },
      { status: 500 }
    )
  }
}
