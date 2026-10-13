import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { resolveTaxRate, taxConfig } from '@/lib/billing-utils'
import { getDiscountApprovalThreshold } from '@/lib/cashier'

/**
 * GET /api/billing/tax-settings — the tax rate to preview on an invoice form.
 *
 * The authoritative rate is resolved server-side when the invoice is created
 * (`POST /api/invoices`) and stamped onto the row. This endpoint exists only so
 * the form can show the same figure the server is about to charge; without it
 * the preview would read zero while the server added tax.
 *
 * Gated on `billing:read` rather than `settings:read` deliberately: reception
 * raises invoices but cannot open clinic settings, and reading the rate on a
 * document they are already allowed to create discloses nothing further.
 *
 * Also carries the discount-approval threshold (FR-013), so the form can ask
 * for a reason before the server refuses the invoice for lacking one. A
 * discount above Rs 1,000 used to fail at "Create" with no field on the
 * screen to give the reason in (invoice review 1.1).
 */
export async function GET() {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const clinic = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { taxEnabled: true, taxRate: true, taxLabel: true },
    })

    const discountApprovalThreshold = await getDiscountApprovalThreshold(hospitalId)

    return NextResponse.json({
      enabled: !!clinic?.taxEnabled,
      rate: resolveTaxRate(clinic),
      label: clinic?.taxLabel || taxConfig.label,
      discountApprovalThreshold,
    })
  } catch (err) {
    console.error('Failed to load tax settings:', err)
    return NextResponse.json({ error: 'Failed to load tax settings' }, { status: 500 })
  }
}
