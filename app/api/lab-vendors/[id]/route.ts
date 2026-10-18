import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { VendorStatus } from '@prisma/client'
import { requireFeature } from '@/lib/plan-gate'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'
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
  taxRegistrationNo: true,
  nationalTaxNo: true,
  specializations: true,
  avgTurnaround: true,
  rating: true,
  paymentTerms: true,
  creditLimit: true,
  notes: true,
  status: true,
} as const

/** Accepts the legacy lowercase status values as well as the enum casing. */
function parseStatus(value: unknown): VendorStatus | null {
  if (typeof value !== 'string') return null
  const upper = value.toUpperCase()
  return VENDOR_STATUSES.includes(upper) ? (upper as VendorStatus) : null
}

// GET - Fetch single lab vendor
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('lab:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // `kind` on every lookup. Laboratories and suppliers share one table, and
    // without it a supplier's id would open on the laboratories screen.
    const vendor = await prisma.vendor.findFirst({
      where: { id, hospitalId, kind: 'LAB', deletedAt: null },
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Lab vendor not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: vendor })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching lab vendor:', error)
    return NextResponse.json({ error: 'Failed to fetch lab vendor' }, { status: 500 })
  }
}

// PUT - Update lab vendor
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The lab module is a paid feature (finding 26). Reads stay open.
  const gated = await requireFeature(hospitalId, 'labModule')
  if (gated) return gated

  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.vendor.findFirst({
      where: { id, hospitalId, kind: 'LAB', deletedAt: null },
      select: { id: true, ...AUDITED_FIELDS },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Lab vendor not found' }, { status: 404 })
    }

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
      specializations,
      avgTurnaround,
      rating,
      paymentTerms,
      creditLimit,
      notes,
    } = body

    if (!code || !name || !phone) {
      return NextResponse.json(
        { error: 'Missing required fields: code, name, phone' },
        { status: 400 }
      )
    }

    const duplicate = await prisma.vendor.findFirst({
      where: { code, hospitalId, kind: 'LAB', id: { not: id }, deletedAt: null },
      select: { id: true },
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Vendor code already exists' }, { status: 409 })
    }

    // Zero, blank and absent are all "not rated", stored as null (finding 20).
    const parsedRating = parseRating(rating)
    if (!parsedRating.ok) return NextResponse.json({ error: parsedRating.error }, { status: 400 })

    // Text, never a number handed to a text column (finding 49).
    const terms = parsePaymentTerms(paymentTerms)
    if (!terms.ok) return NextResponse.json({ error: terms.error }, { status: 400 })

    const limit = parseCreditLimit(creditLimit)
    if (!limit.ok) return NextResponse.json({ error: limit.error }, { status: 400 })

    const updated = await prisma.vendor.update({
      where: { id },
      select: AUDITED_FIELDS,
      data: {
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
        specializations: specializations || null,
        avgTurnaround: avgTurnaround ?? null,
        rating: parsedRating.value ?? null,
        paymentTerms: terms.value ?? null,
        creditLimit: limit.value ?? null,
        notes: notes || null,
        ...(parseStatus(body.status) ? { status: parseStatus(body.status)! } : {}),
      },
    })

    // Only what changed, before and after (16 Oct, finding 14).
    const change = diffValues(existing, updated)
    if (change.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.LAB_VENDOR_UPDATED,
        entityType: 'Vendor',
        entityId: id,
        oldValues: change.before,
        newValues: { name: updated.name, ...change.after },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json({ success: true, message: 'Lab vendor updated successfully' })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating lab vendor:', error)
    return NextResponse.json({ error: 'Failed to update lab vendor' }, { status: 500 })
  }
}

// DELETE - Soft delete lab vendor
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The lab module is a paid feature (finding 26). Reads stay open.
  const gated = await requireFeature(hospitalId, 'labModule')
  if (gated) return gated

  try {
    const { id } = await params

    const existing = await prisma.vendor.findFirst({
      where: { id, hospitalId, kind: 'LAB', deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Lab vendor not found' }, { status: 404 })
    }

    const orderCount = await prisma.labOrder.count({
      where: { labVendorId: id, deletedAt: null },
    })

    if (orderCount > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot delete vendor with existing lab orders. Please inactive the vendor instead.',
        },
        { status: 400 }
      )
    }

    await prisma.vendor.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true, message: 'Lab vendor deleted successfully' })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting lab vendor:', error)
    return NextResponse.json({ error: 'Failed to delete lab vendor' }, { status: 500 })
  }
}
