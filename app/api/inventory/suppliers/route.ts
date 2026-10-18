import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma, VendorStatus } from '@prisma/client'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { parseCreditLimit, parsePaymentTerms, parseRating } from '@/lib/vendor-fields'

const VENDOR_STATUSES = Object.values(VendorStatus) as string[]

/** Accepts the legacy lowercase status values as well as the enum casing. */
function parseStatus(value: string): VendorStatus | null {
  const upper = value.toUpperCase()
  return VENDOR_STATUSES.includes(upper) ? (upper as VendorStatus) : null
}

// GET - Fetch all suppliers
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('inventory:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    // The grid shows newest first, so a record somebody has just added is the
    // top row rather than wherever its name falls. `sort=name` is for the
    // dropdowns that read the same endpoint, where a person scans for a name.
    const byName = searchParams.get('sort') === 'name'

    // Suppliers and dental laboratories share one `Vendor` table; `kind` is
    // what separates them. Leaving it out here would list the clinic's
    // laboratories on its suppliers screen.
    const where: Prisma.VendorWhereInput = {
      hospitalId,
      kind: 'SUPPLIER',
      deletedAt: null,
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status !== 'all') {
      const parsed = parseStatus(status)
      if (parsed) where.status = parsed
    }

    const [total, suppliers] = await Promise.all([
      prisma.vendor.count({ where }),
      prisma.vendor.findMany({
        where,
        orderBy: byName ? { name: 'asc' } : { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          // Counts the legacy query built with COUNT(DISTINCT ...) joins.
          _count: {
            select: {
              preferredForItems: { where: { deletedAt: null } },
              purchaseOrders: { where: { deletedAt: null } },
            },
          },
          purchaseOrders: {
            where: { deletedAt: null },
            select: { totalAmount: true },
          },
        },
      }),
    ])

    const data = suppliers.map(({ _count, purchaseOrders, ...supplier }) => ({
      ...supplier,
      itemsSupplied: _count.preferredForItems,
      totalOrders: _count.purchaseOrders,
      totalBusiness: purchaseOrders.reduce((sum, po) => sum + Number(po.totalAmount), 0),
    }))

    return NextResponse.json({
      success: true,
      data,
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
    console.error('Error fetching suppliers:', error)
    return NextResponse.json({ error: 'Failed to fetch suppliers' }, { status: 500 })
  }
}

// POST - Create new supplier
export async function POST(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('inventory:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      code,
      name,
      contactPerson,
      email,
      phone,
      alternatePhone,
      address,
      city,
      state,
      postalCode,
      taxRegistrationNo,
      nationalTaxNo,
      status = VendorStatus.ACTIVE,
      notes,
    } = body

    if (!code || !name || !phone) {
      return NextResponse.json(
        { error: 'Missing required fields: code, name, phone' },
        { status: 400 }
      )
    }

    // `paymentTerms: 30` was a 500 (finding 49): the column is text. A number
    // is read as days; anything else that is not text is a 400.
    const paymentTerms = parsePaymentTerms(body.paymentTerms ?? 'Net 30')
    if (!paymentTerms.ok) return NextResponse.json({ error: paymentTerms.error }, { status: 400 })

    const creditLimit = parseCreditLimit(body.creditLimit ?? 0)
    if (!creditLimit.ok) return NextResponse.json({ error: creditLimit.error }, { status: 400 })

    // Zero and absent are "not rated", stored as null — the same rule as
    // laboratories (finding 20).
    const rating = parseRating(body.rating)
    if (!rating.ok) return NextResponse.json({ error: rating.error }, { status: 400 })

    const existing = await prisma.vendor.findFirst({
      where: { hospitalId, kind: 'SUPPLIER', code, deletedAt: null },
      select: { id: true },
    })

    if (existing) {
      return NextResponse.json({ error: 'Supplier code already exists' }, { status: 409 })
    }

    const supplier = await prisma.vendor.create({
      data: {
        hospitalId,
        kind: 'SUPPLIER',
        code,
        name,
        contactPerson: contactPerson || null,
        email: email || null,
        phone,
        alternatePhone: alternatePhone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        postalCode: postalCode || null,
        taxRegistrationNo: taxRegistrationNo || null,
        nationalTaxNo: nationalTaxNo || null,
        paymentTerms: paymentTerms.value ?? null,
        creditLimit: creditLimit.value ?? null,
        status: parseStatus(String(status)) ?? VendorStatus.ACTIVE,
        rating: rating.value ?? null,
        notes: notes || null,
      },
      select: { id: true, code: true, name: true, phone: true, status: true, paymentTerms: true },
    })

    await recordAudit({
      hospitalId,
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.SUPPLIER_CREATED,
      entityType: 'Vendor',
      entityId: supplier.id,
      newValues: {
        code: supplier.code,
        name: supplier.name,
        phone: supplier.phone,
        status: supplier.status,
        paymentTerms: supplier.paymentTerms,
        creditLimit: creditLimit.value ?? null,
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json(
      {
        success: true,
        data: { id: supplier.id },
        message: 'Supplier created successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    // A malformed value is a 400 that says what was wrong (findings 25 and
    // 49), never Prisma's message.
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating supplier:', error)
    return NextResponse.json({ error: 'Failed to create supplier' }, { status: 500 })
  }
}
