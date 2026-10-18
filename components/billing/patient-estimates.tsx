'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { FileText } from 'lucide-react'
import { formatCurrency } from '@/lib/billing-utils'
import { displayDate } from '@/lib/dates'

interface Estimate {
  id: string
  planNumber: string
  title: string
  status: string
  estimatedCost: string | number
  createdAt: string
}

/**
 * The patient's treatment estimates, on their Billing tab.
 *
 * Front Desk and Accounts are the ones a patient asks "how much will this
 * cost?", and the estimate lived only under Treatments, which they cannot open
 * (bug report 16 Oct, finding 25). Each row opens the same estimate at
 * `/billing/estimates/[id]`, to show or print. Nothing is shown when the
 * patient has no plan.
 */
export function PatientEstimates({
  patientId,
  to = (href) => href,
}: {
  patientId: string
  /** Wraps a link with the breadcrumb trail, when the page keeps one. */
  to?: (href: string) => string
}) {
  const [estimates, setEstimates] = useState<Estimate[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/billing/estimates?patientId=${encodeURIComponent(patientId)}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) setEstimates(data.estimates ?? [])
      } catch {
        // A way in, not the account. Without it the ledger below still stands.
        if (!cancelled) setEstimates([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [patientId])

  if (estimates.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Treatment estimates</CardTitle>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {estimates.map((estimate) => (
          <Link
            key={estimate.id}
            href={to(`/billing/estimates/${estimate.id}`)}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm hover:bg-muted/50"
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{estimate.title}</span>
              <span className="block text-xs text-muted-foreground">
                {estimate.planNumber} · {displayDate(estimate.createdAt)}
              </span>
            </span>
            <StatusBadge kind="treatmentPlan" status={estimate.status} />
            <span className="tabular-nums">{formatCurrency(estimate.estimatedCost)}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
