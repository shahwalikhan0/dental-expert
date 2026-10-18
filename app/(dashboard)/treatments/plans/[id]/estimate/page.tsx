'use client'

import { use } from 'react'
import { PlanEstimate } from '@/components/treatments/plan-estimate'

/** The clinician's address for a plan's estimate. See PlanEstimate. */
export default function TreatmentEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <PlanEstimate id={id} from="plan" />
}
