import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { planName } from '@/lib/plans'
import { getTenant } from '@/lib/tenant'

/**
 * How many staff accounts the clinic's plan allows, and how many are in use.
 *
 * The Free plan's limit of three used to be discovered on the third person,
 * with the administrator already counting as one (bug report 12 Oct, finding
 * 53). The Staff screen shows this line so the limit is visible before it is
 * reached. Counted the same way `checkStaffEntitlement` in lib/tenant.ts
 * counts: active accounts, so an outstanding invitation is not one yet.
 */
export async function GET() {
  const { error, hospitalId } = await requirePermission('staff:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const tenant = await getTenant(hospitalId)
    if (!tenant) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })

    const max = tenant.entitlements.staff
    const current = await prisma.user.count({ where: { hospitalId, isActive: true } })

    return NextResponse.json({
      plan: tenant.plan,
      planName: planName(tenant.plan),
      current,
      // -1 is unlimited — see UNLIMITED in lib/plans.ts.
      max,
      unlimited: max < 0,
      atLimit: max >= 0 && current >= max,
    })
  } catch (err) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Error reading staff usage:', err)
    return NextResponse.json({ error: 'Failed to read staff usage' }, { status: 500 })
  }
}
