import { NextResponse } from 'next/server'
import { getTenant, tenantHasFeature } from '@/lib/tenant'
import { planName, type PlanFeature } from '@/lib/plans'

const FEATURE_NAMES: Record<PlanFeature, string> = {
  labModule: 'The lab module',
  bulkCommunications: 'Bulk messaging',
  dataImport: 'Data import',
  apiAccess: 'API access',
  prioritySupport: 'Priority support',
}

/**
 * Refuse a request for a feature the clinic's plan does not include.
 *
 * `lib/plans.ts` has always said which plan carries which feature, and the
 * pricing page sold them that way, but nothing checked (bug report 12 Oct,
 * finding 26): a Free clinic could run the lab module. Returns null when the
 * feature is included, or a 403 the toast can show as it is.
 *
 * Gate the writes. A clinic that drops to a lower plan keeps reading what it
 * already has — the same rule a lapsed subscription follows in lib/tenant.ts.
 */
export async function requireFeature(
  hospitalId: string,
  feature: PlanFeature
): Promise<NextResponse | null> {
  const tenant = await getTenant(hospitalId)
  if (!tenant) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
  if (tenantHasFeature(tenant, feature)) return null
  return NextResponse.json(
    {
      error: `${FEATURE_NAMES[feature]} is not included in the ${planName(tenant.plan)} plan. Upgrade to use it.`,
      code: 'PLAN_FEATURE',
    },
    { status: 403 }
  )
}
