import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'
import { knownErrorResponse } from '@/lib/api-errors'

const optionalString = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().optional()
)

const clinicInfoSchema = z.object({
  name: z.string().min(1),
  tagline: optionalString,
  logo: optionalString,
  phone: z.string().min(10),
  alternatePhone: optionalString,
  email: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().email().optional()
  ),
  website: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().url().optional()
  ),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(6),
  registrationNo: optionalString,
  taxRegistrationNo: optionalString,
  nationalTaxNo: optionalString,
  workingHours: optionalString,
  bankName: optionalString,
  bankAccountNo: optionalString,
  bankIban: optionalString,
  mobileWalletId: optionalString,
  patientPortalEnabled: z.boolean().optional(),
  // Sales tax on services. Off for this clinic — dental services are exempt —
  // but kept configurable so turning it on is a settings change rather than a
  // migration. The rate is stamped onto each invoice at the moment it is
  // raised, so changing it here never restates a document already issued.
  taxEnabled: z.boolean().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  taxLabel: z.string().min(1).max(60).optional(),
})

// GET /api/settings/clinic - Get clinic information
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const clinicInfo = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: {
        id: true,
        name: true,
        tagline: true,
        logo: true,
        phone: true,
        alternatePhone: true,
        email: true,
        website: true,
        address: true,
        city: true,
        state: true,
        postalCode: true,
        registrationNo: true,
        taxRegistrationNo: true,
        nationalTaxNo: true,
        workingHours: true,
        bankName: true,
        bankAccountNo: true,
        bankIban: true,
        mobileWalletId: true,
        slug: true,
        patientPortalEnabled: true,
        taxEnabled: true,
        taxRate: true,
        taxLabel: true,
      },
    })

    if (!clinicInfo) {
      // Return default structure if not found
      return NextResponse.json({
        success: true,
        data: null,
      })
    }

    return NextResponse.json({
      success: true,
      data: clinicInfo,
    })
  } catch (error) {
    console.error('Get clinic info error:', error)
    return NextResponse.json({ error: 'Failed to get clinic information' }, { status: 500 })
  }
}

// POST /api/settings/clinic - Create or update clinic information
export async function POST(req: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    // Partial on purpose. This route only ever updates an existing clinic
    // (`hospital.update` below), and callers legitimately send a slice of it —
    // the billing screen saves tax settings alone. Fields that *are* present
    // still get their full validation; absent ones are left untouched rather
    // than being rejected or blanked.
    const data = clinicInfoSchema.partial().parse(body)

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Read before writing, so the audit entry can say what changed. Only the
    // fields this request touches are compared — a partial save of the tax
    // settings should not record the whole clinic record as "changed".
    const previous = await prisma.hospital.findUnique({
      where: { id: hospitalId },
    })

    const clinicInfo = await prisma.hospital.update({
      where: { id: hospitalId },
      data,
    })

    const changes = diffValues(
      Object.fromEntries(Object.keys(data).map((k) => [k, (previous as any)?.[k]])),
      data as Record<string, unknown>
    )
    if (changes.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: user?.id,
        action: AUDIT_ACTIONS.CLINIC_UPDATED,
        entityType: 'Hospital',
        entityId: hospitalId,
        oldValues: changes.before,
        newValues: changes.after,
        ...requestContext(req.headers),
      })
    }

    return NextResponse.json({
      success: true,
      data: clinicInfo,
      message: 'Clinic information saved successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Update clinic info error:', error)
    return NextResponse.json({ error: 'Failed to update clinic information' }, { status: 500 })
  }
}
