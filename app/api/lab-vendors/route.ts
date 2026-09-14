import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma, VendorStatus } from '@prisma/client'

const VENDOR_STATUSES = Object.values(VendorStatus) as string[]

/** The screen sends lowercase; the column holds the enum. */
function parseStatus(value: string): VendorStatus | null {
  const upper = value.toUpperCase()
  return VENDOR_STATUSES.includes(upper) ? (upper as VendorStatus) : null
}

// GET - Fetch all lab vendors
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('lab:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const skip = (page - 1) * limit

    // Laboratories and suppliers share one `Vendor` table; `kind` is what
    // separates them. Soft-deleted rows are excluded, which the old query
    // forgot to do — `LabVendor` had a `deletedAt` column that nothing filtered
    // on, so a deleted laboratory stayed on the list for ever.
    const where: Prisma.VendorWhereInput = {
      hospitalId,
      kind: 'LAB',
      deletedAt: null,
    }

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Add status filter. One lifecycle field now: `isActive` and `status` both
    // existed and could disagree, with nothing deciding which won. The old
    // filter read `isActive`, which meant "inactive" and "blocked" were the
    // same query and the screen could not tell a lapsed laboratory from one the
    // clinic had refused to use again.
    if (status !== 'all') {
      const parsed = parseStatus(status)
      if (parsed) where.status = parsed
    }

    // Get total count
    const total = await prisma.vendor.count({ where })

    // Fetch vendors
    const vendors = await prisma.vendor.findMany({
      where,
      orderBy: {
        name: 'asc',
      },
      skip,
      take: limit,
    })

    return NextResponse.json({
      success: true,
      data: vendors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error: any) {
    console.error('Error fetching lab vendors:', error)
    return NextResponse.json(
      { error: 'Failed to fetch lab vendors', details: error.message },
      { status: 500 }
    )
  }
}

// POST - Create new lab vendor
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      name,
      contactPerson,
      phone,
      email,
      address,
      specializations,
      avgTurnaround = 7,
      rating = 0,
      status = VendorStatus.ACTIVE,
    } = body

    // Validation
    if (!name || !phone) {
      return NextResponse.json({ error: 'Missing required fields: name, phone' }, { status: 400 })
    }

    // Create lab vendor
    const vendor = await prisma.vendor.create({
      data: {
        hospitalId,
        kind: 'LAB',
        name,
        contactPerson: contactPerson || null,
        phone,
        email: email || null,
        address: address || null,
        specializations: specializations || null,
        avgTurnaround: avgTurnaround || null,
        rating: rating || null,
        status,
      },
    })

    return NextResponse.json(
      {
        success: true,
        data: vendor,
        message: 'Lab vendor created successfully',
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Error creating lab vendor:', error)
    return NextResponse.json(
      { error: 'Failed to create lab vendor', details: error.message },
      { status: 500 }
    )
  }
}
