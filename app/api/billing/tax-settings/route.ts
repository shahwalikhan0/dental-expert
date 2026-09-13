import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { resolveTaxRate, taxConfig } from '@/lib/billing-utils'

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

    return NextResponse.json({
      enabled: !!clinic?.taxEnabled,
      rate: resolveTaxRate(clinic),
      label: clinic?.taxLabel || taxConfig.label,
    })
  } catch (err) {
    console.error('Failed to load tax settings:', err)
    return NextResponse.json({ error: 'Failed to load tax settings' }, { status: 500 })
  }
}
