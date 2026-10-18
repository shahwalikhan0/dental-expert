import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma, PurchaseOrderStatus, VendorStatus } from '@prisma/client'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'
import { OPEN_ORDER_STATUSES } from '@/lib/inventory-items'
import { parseCreditLimit, parsePaymentTerms, parseRating } from '@/lib/vendor-fields'

const VENDOR_STATUSES = Object.values(VendorStatus) as string[]

/** What an edit's audit entry compares, before and after. */
const AUDITED_FIELDS = {
  code: true,
  name: true,
  contactPerson: true,
  email: true,
  phone: true,
  alternatePhone: true,
  address: true,
  city: true,
  state: true,
  postalCode: true,
  taxRegistrationNo: true,
  nationalTaxNo: true,
  paymentTerms: true,
  creditLimit: true,
  rating: true,
  status: true,
  notes: true,
} as const

/** Accepts the legacy lowercase status values as well as the enum casing. */
function parseStatus(value: unknown): VendorStatus | null {
  if (typeof value !== 'string') return null
  const upper = value.toUpperCase()
  return VENDOR_STATUSES.includes(upper) ? (upper as VendorStatus) : null
}

// Orders that are placed but not yet fully received. A DRAFT is not pending
// business: the supplier has not been told about it.
const PENDING_ORDER_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
]

// GET - Fetch single supplier with details
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('inventory:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // `kind` on every lookup. Suppliers and laboratories share one table, and
    // without it a laboratory's id would open on the suppliers screen.
    const supplier = await prisma.vendor.findFirst({
      where: { id, hospitalId, kind: 'SUPPLIER', deletedAt: null },
    })

    if (!supplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    const [items, purchaseOrders] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { preferredSupplierId: id, hospitalId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, sku: true, name: true, currentStock: true, purchasePrice: true },
      }),
      prisma.purchaseOrder.findMany({
        where: { supplierId: id, deletedAt: null },
        orderBy: { orderDate: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          expectedDate: true,
          totalAmount: true,
          status: true,
        },
      }),
    ])

    const completedBusiness = purchaseOrders
      .filter((po) => po.status === PurchaseOrderStatus.RECEIVED)
      .reduce((sum, po) => sum + Number(po.totalAmount), 0)

    const pendingBusiness = purchaseOrders
      .filter((po) => PENDING_ORDER_STATUSES.includes(po.status))
      .reduce((sum, po) => sum + Number(po.totalAmount), 0)

    return NextResponse.json({
      success: true,
      data: {
        ...supplier,
        itemsSupplied: items.length,
        totalOrders: purchaseOrders.length,
        completedBusiness,
        pendingBusiness,
        itemsSuppliedList: items,
        recentPurchaseOrders: purchaseOrders.slice(0, 10),
      },
    })
  } catch (error) {
    // A malformed value is a 400 that says what was wrong (findings 25 and
    // 49), never Prisma's message.
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching supplier:', error)
    return NextResponse.json({ error: 'Failed to fetch supplier' }, { status: 500 })
  }
}

// PUT - Update supplier
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('inventory:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.vendor.findFirst({
      where: { id, hospitalId, kind: 'SUPPLIER', deletedAt: null },
      select: { id: true, ...AUDITED_FIELDS },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    if (body.code && body.code !== existing.code) {
      const duplicate = await prisma.vendor.findFirst({
        where: { code: body.code, hospitalId, kind: 'SUPPLIER', id: { not: id }, deletedAt: null },
        select: { id: true },
      })

      if (duplicate) {
        return NextResponse.json({ error: 'Supplier code already exists' }, { status: 409 })
      }
    }

    // COALESCE in the old SQL meant "leave alone when the field is absent",
    // while the nullable columns were always overwritten. Prisma gets the same
    // result by simply omitting undefined keys.
    const data: Prisma.VendorUpdateInput = {
      contactPerson: body.contactPerson ?? null,
      email: body.email ?? null,
      alternatePhone: body.alternatePhone ?? null,
      address: body.address ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      postalCode: body.postalCode ?? null,
      taxRegistrationNo: body.taxRegistrationNo ?? null,
      nationalTaxNo: body.nationalTaxNo ?? null,
      notes: body.notes ?? null,
    }

    if (body.code != null) data.code = body.code
    if (body.name != null) data.name = body.name
    if (body.phone != null) data.phone = body.phone

    // `paymentTerms: 30` was a 500 (finding 49): the column is text. A number
    // is read as days; anything else that is not text is a 400.
    const paymentTerms = parsePaymentTerms(body.paymentTerms)
    if (!paymentTerms.ok) return NextResponse.json({ error: paymentTerms.error }, { status: 400 })
    if (paymentTerms.value !== undefined) data.paymentTerms = paymentTerms.value

    const creditLimit = parseCreditLimit(body.creditLimit)
    if (!creditLimit.ok) return NextResponse.json({ error: creditLimit.error }, { status: 400 })
    if (creditLimit.value !== undefined) data.creditLimit = creditLimit.value

    // Zero is "not rated", stored as null (finding 20).
    const rating = parseRating(body.rating)
    if (!rating.ok) return NextResponse.json({ error: rating.error }, { status: 400 })
    if (rating.value !== undefined) data.rating = rating.value

    const status = parseStatus(body.status)
    if (status) data.status = status

    const updated = await prisma.vendor.update({ where: { id }, data, select: AUDITED_FIELDS })

    // Only what changed, before and after (16 Oct, finding 14).
    const change = diffValues(existing, updated)
    if (change.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
        entityType: 'Vendor',
        entityId: id,
        oldValues: change.before,
        newValues: { name: updated.name, ...change.after },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json({ success: true, message: 'Supplier updated successfully' })
  } catch (error) {
    // A malformed value is a 400 that says what was wrong (findings 25 and
    // 49), never Prisma's message.
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating supplier:', error)
    return NextResponse.json({ error: 'Failed to update supplier' }, { status: 500 })
  }
}

// DELETE - Refused with open orders; soft delete when referenced, hard delete otherwise
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

    const existing = await prisma.vendor.findFirst({
      where: { id, hospitalId, kind: 'SUPPLIER', deletedAt: null },
      select: { id: true, code: true, name: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    // Not while an order to them is still live (finding 44). MedSupply
    // Karachi was deleted with draft order PO20260002 on its books, and the
    // draft was then sent to a supplier that no longer existed. Cancel or
    // finish the order first.
    const openOrderCount = await prisma.purchaseOrder.count({
      where: { supplierId: id, deletedAt: null, status: { in: OPEN_ORDER_STATUSES } },
    })

    if (openOrderCount > 0) {
      return NextResponse.json(
        {
          error: `${existing.name} has ${openOrderCount} open purchase order${openOrderCount === 1 ? '' : 's'}. Cancel or receive ${openOrderCount === 1 ? 'it' : 'them'} before deleting the supplier.`,
        },
        { status: 409 }
      )
    }

    // Past orders, batches and stock movements name the supplier, so a
    // supplier with any of them is deactivated and hidden rather than removed:
    // Dental Depot's received order PO20260001 has to keep saying who it came
    // from. Only a supplier nothing refers to is removed outright.
    const [purchaseOrderCount, itemCount, batchCount, movementCount] = await Promise.all([
      prisma.purchaseOrder.count({ where: { supplierId: id } }),
      prisma.inventoryItem.count({
        where: { preferredSupplierId: id, hospitalId, deletedAt: null },
      }),
      prisma.inventoryBatch.count({ where: { supplierId: id } }),
      prisma.stockTransaction.count({ where: { supplierId: id } }),
    ])

    if (purchaseOrderCount > 0 || itemCount > 0 || batchCount > 0 || movementCount > 0) {
      // One lifecycle field now. This used to set `status` and `isActive`
      // together, which is exactly the pair that could come apart.
      await prisma.vendor.update({
        where: { id },
        data: { deletedAt: new Date(), status: VendorStatus.INACTIVE },
      })
    } else {
      await prisma.vendor.delete({ where: { id } })
    }

    // Finding 24: suppliers were deleted with nothing in the audit log.
    await recordAudit({
      hospitalId,
      userId: session?.user?.id,
      action: AUDIT_ACTIONS.SUPPLIER_DELETED,
      entityType: 'Vendor',
      entityId: id,
      oldValues: { code: existing.code, name: existing.name },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ success: true, message: 'Supplier deleted successfully' })
  } catch (error) {
    // A malformed value is a 400 that says what was wrong (findings 25 and
    // 49), never Prisma's message.
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting supplier:', error)
    return NextResponse.json({ error: 'Failed to delete supplier' }, { status: 500 })
  }
}
