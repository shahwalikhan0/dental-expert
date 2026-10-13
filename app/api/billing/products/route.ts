import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'

/**
 * GET /api/billing/products?search= — products that can be sold on an invoice.
 *
 * The invoice forms' "Add product" picker (invoice review 4.5). Not the
 * inventory list, for two reasons. That list needs `inventory:read`, which
 * reception and the accountant — the people raising invoices — do not hold;
 * and it carries purchase prices and suppliers, which a sale has no use for.
 * This answers only what a line needs: name, unit, selling price and how many
 * are on the shelf.
 *
 * Active, undeleted items only. Gated on `billing:write`, as raising an
 * invoice is.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('billing:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const search = (request.nextUrl.searchParams.get('search') || '').trim()
    const limit = Math.min(
      Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '20') || 20, 1),
      50
    )

    const items = await prisma.inventoryItem.findMany({
      where: {
        hospitalId,
        deletedAt: null,
        isActive: true,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { sku: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        currentStock: true,
        sellingPrice: true,
      },
      orderBy: { name: 'asc' },
      take: limit,
    })

    return NextResponse.json({
      products: items.map((item) => ({
        ...item,
        sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
      })),
    })
  } catch (err) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Failed to load products for billing:', err)
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
  }
}
