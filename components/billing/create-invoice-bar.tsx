'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertCircle, Plus } from 'lucide-react'
import { formatCurrency } from '@/lib/billing-utils'
import { newInvoiceHref } from '@/lib/invoice-links'

/**
 * "Create invoice" for one patient, and what of theirs is still unbilled.
 *
 * The patient's Billing tab showed the account and offered no way to add to it
 * (review 4.1): raising a bill meant leaving for Billing, opening New Invoice
 * and finding the patient again. Work that was done and never billed was
 * visible nowhere on the record, so it was found — if it was found — when the
 * patient had gone home.
 *
 * Shown only to those who may raise an invoice; the caller decides that. The
 * unbilled list is the same one New Invoice offers, so the count here is the
 * number of treatments that page will have ticked.
 */
export function CreateInvoiceBar({
  patientId,
  to = (href) => href,
}: {
  patientId: string
  /** Wraps a link with the breadcrumb trail, when the page keeps one. */
  to?: (href: string) => string
}) {
  const [unbilled, setUnbilled] = useState<{ ids: string[]; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/billing/unbilled-treatments?patientId=${encodeURIComponent(patientId)}`
        )
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (cancelled) return
        setUnbilled({
          ids: (data.treatments ?? []).map((t: { treatmentId: string }) => t.treatmentId),
          total: Number(data.summary?.totalUnbilled ?? 0),
        })
      } catch {
        // The count is a prompt, not the account. Without it the button still
        // works, and New Invoice lists the unbilled work itself.
        if (!cancelled) setUnbilled(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [patientId])

  const count = unbilled?.ids.length ?? 0

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        {count > 0 ? (
          <Link
            href={to(newInvoiceHref({ patientId, treatmentIds: unbilled!.ids }))}
            className="flex items-center gap-2 text-sm font-medium text-amber-700 hover:underline dark:text-amber-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {count} {count === 1 ? 'treatment' : 'treatments'} not yet billed (
            {formatCurrency(unbilled!.total)})
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">
            {unbilled ? 'All completed treatments are billed.' : 'Raise a bill for this patient.'}
          </p>
        )}
        <Button size="sm" asChild>
          <Link href={to(newInvoiceHref({ patientId }))}>
            <Plus className="mr-2 h-4 w-4" />
            Create invoice
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
