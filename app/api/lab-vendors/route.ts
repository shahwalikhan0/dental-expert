import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma, VendorStatus } from '@prisma/client'
import { requireFeature } from '@/lib/plan-gate'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { parseCreditLimit, parsePaymentTerms, parseRating } from '@/lib/vendor-fields'

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

    // The grid shows newest first, so a record somebody has just added is the
    // top row rather than wherever its name falls. `sort=name` is for the
    // dropdowns that read the same endpoint, where a person scans for a name.
    const byName = searchParams.get('sort') === 'name'

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
      orderBy: byName ? { name: 'asc' } : { createdAt: 'desc' },
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
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching lab vendors:', error)
    return NextResponse.json({ error: 'Failed to fetch lab vendors' }, { status: 500 })
  }
}

// POST - Create new lab vendor
export async function POST(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The lab module is a paid feature (finding 26): a Free clinic created a
  // laboratory with a 201. The 403 carries a sentence the toast shows as it is.
  const gated = await requireFeature(hospitalId, 'labModule')
  if (gated) return gated

  try {
    const body = await request.json()
    const {
      code,
      name,
      contactPerson,
      phone,
      alternatePhone,
      email,
      address,
      city,
      state,
      postalCode,
      taxRegistrationNo,
      nationalTaxNo,
      specializations,
      avgTurnaround = 7,
      notes,
    } = body

    // Validation
    if (!name || !phone) {
      return NextResponse.json({ error: 'Missing required fields: name, phone' }, { status: 400 })
    }

    // Zero, blank and absent are all "not rated", stored as null (finding 20).
    const rating = parseRating(body.rating)
    if (!rating.ok) return NextResponse.json({ error: rating.error }, { status: 400 })

    const paymentTerms = parsePaymentTerms(body.paymentTerms)
    if (!paymentTerms.ok) return NextResponse.json({ error: paymentTerms.error }, { status: 400 })

    const creditLimit = parseCreditLimit(body.creditLimit)
    if (!creditLimit.ok) return NextResponse.json({ error: creditLimit.error }, { status: 400 })

    const turnaround = avgTurnaround === '' || avgTurnaround == null ? null : Number(avgTurnaround)
    if (turnaround !== null && (!Number.isInteger(turnaround) || turnaround < 0)) {
      return NextResponse.json(
        { error: 'The turnaround must be a whole number of days' },
        { status: 400 }
      )
    }

    // The form sends lowercase; the column holds the enum. Passing `active`
    // straight through was a Prisma validation error.
    const status = body.status == null ? VendorStatus.ACTIVE : parseStatus(String(body.status))
    if (!status) {
      return NextResponse.json(
        { error: `Status "${body.status}" is not valid. Use active, inactive or blocked.` },
        { status: 400 }
      )
    }

    if (code) {
      const duplicate = await prisma.vendor.findFirst({
        where: { code, hospitalId, kind: 'LAB', deletedAt: null },
        select: { id: true },
      })
      if (duplicate) {
        return NextResponse.json({ error: 'Vendor code already exists' }, { status: 409 })
      }
    }

    // Create lab vendor
    const vendor = await prisma.vendor.create({
      data: {
        hospitalId,
        kind: 'LAB',
        // The form has always asked for a code, and this route dropped it —
        // so the edit dialog, which requires one, could not save the record.
        code: code || null,
        name,
        contactPerson: contactPerson || null,
        phone,
        alternatePhone: alternatePhone || null,
        email: email || null,
        address: address || null,
        city: city || null,
        state: state || null,
        postalCode: postalCode || null,
        taxRegistrationNo: taxRegistrationNo || null,
        nationalTaxNo: nationalTaxNo || null,
        specializations: specializations || null,
        avgTurnaround: turnaround || null,
        rating: rating.value ?? null,
        paymentTerms: paymentTerms.value ?? null,
        creditLimit: creditLimit.value ?? null,
        notes: notes || null,
        status,
      },
    })

    await recordAudit({
      hospitalId,
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.LAB_VENDOR_CREATED,
      entityType: 'Vendor',
      entityId: vendor.id,
      newValues: {
        code: vendor.code,
        name: vendor.name,
        phone: vendor.phone,
        status: vendor.status,
        paymentTerms: vendor.paymentTerms,
        creditLimit: vendor.creditLimit == null ? null : Number(vendor.creditLimit),
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json(
      {
        success: true,
        data: vendor,
        message: 'Lab vendor created successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating lab vendor:', error)
    return NextResponse.json({ error: 'Failed to create lab vendor' }, { status: 500 })
  }
}
