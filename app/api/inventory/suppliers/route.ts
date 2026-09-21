import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma, VendorStatus } from '@prisma/client'

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
        orderBy: { name: 'asc' },
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
  } catch (error: any) {
    console.error('Error fetching suppliers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch suppliers', details: error.message },
      { status: 500 }
    )
  }
}

// POST - Create new supplier
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('inventory:write')

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
      paymentTerms = 'Net 30',
      creditLimit = 0,
      status = VendorStatus.ACTIVE,
      rating = 0,
      notes,
    } = body

    if (!code || !name || !phone) {
      return NextResponse.json(
        { error: 'Missing required fields: code, name, phone' },
        { status: 400 }
      )
    }

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
        paymentTerms,
        creditLimit,
        status: parseStatus(String(status)) ?? VendorStatus.ACTIVE,
        rating,
        notes: notes || null,
      },
      select: { id: true },
    })

    return NextResponse.json(
      {
        success: true,
        data: { id: supplier.id },
        message: 'Supplier created successfully',
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Error creating supplier:', error)
    return NextResponse.json(
      { error: 'Failed to create supplier', details: error.message },
      { status: 500 }
    )
  }
}
