import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'

/**
 * The categories this clinic actually uses, with a count of items in each.
 *
 * Derived from the items rather than read from a table. `InventoryCategory` was
 * eleven columns and a self-referencing hierarchy behind a free-text field on a
 * form — there was no screen to create a category, rename one or nest one, so
 * every clinic had exactly the categories the seed gave it and no way to change
 * them. A label lives on the item now, and this is the distinct list.
 *
 * The response shape is unchanged, so the filter dropdown that consumes it did
 * not have to move: `id` is the label itself, which is also what the item
 * filter matches on.
 */
export async function GET(_request: NextRequest) {
  const { error, hospitalId } = await requirePermission('inventory:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const grouped = await prisma.inventoryItem.groupBy({
      by: ['category'],
      where: { hospitalId, deletedAt: null, category: { not: null } },
      _count: { _all: true },
      orderBy: { category: 'asc' },
    })

    return NextResponse.json({
      success: true,
      data: grouped.map((row) => ({
        id: row.category,
        name: row.category,
        item_count: row._count._all,
      })),
    })
  } catch (err: unknown) {
    console.error('Error fetching categories:', err)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}
