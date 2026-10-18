'use client'

import { use } from 'react'
import { PlanEstimate } from '@/components/treatments/plan-estimate'

/**
 * The desk's address for a plan's estimate, under Billing so `billing:read`
 * opens it. Front Desk and Accounts hand the estimate over and talk through
 * what it costs; the plan itself is clinical. See PlanEstimate.
 */
export default function BillingEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <PlanEstimate id={id} from="billing" />
}
