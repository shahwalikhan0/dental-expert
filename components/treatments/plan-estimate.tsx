'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BackLink, useTrail } from '@/components/ui/trail'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadFailed } from '@/components/ui/load-failed'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { FileText } from 'lucide-react'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { describeTeethByQuadrant, parseTeeth } from '@/lib/teeth'
import { formatPhone } from '@/lib/utils'
import { groupByPhase } from '@/lib/treatment-phases'
import { usePrint } from '@/hooks/use-print'
import { PrintDocument } from '@/components/print/print-document'
import { PrintButton } from '@/components/print/print-button'
import { PlanEstimatePrint } from '@/components/print/templates/plan-estimate-print'

/**
 * The estimate the patient takes home.
 *
 * A treatment plan existed only as a screen inside the clinic's software. What
 * a patient is actually given — and what they show to whoever is paying — is a
 * sheet of paper: what is being proposed, in what order, and what each stage
 * costs.
 *
 * Phased, because that is the point. Nine items and one total is a number
 * somebody says no to; three phases is three decisions, and the first one gets
 * made today. The running total is printed alongside each phase so the sheet
 * answers "and if I do the first two?" without anybody having to add up.
 *
 * Deliberately not an invoice. No invoice number, no tax line, no due date —
 * it is a quotation, and the wording at the foot says so, because a patient
 * who mistakes one for the other has been misled by the clinic's own
 * stationery.
 *
 * The page is the on-screen preview; Print sends PlanEstimatePrint, the same
 * content on the clinic's letterhead paper, with a line for the patient's and
 * the dentist's signatures.
 *
 * Served at two addresses. `/treatments/plans/[id]/estimate` is the clinician's,
 * opened from the plan. `/billing/estimates/[id]` is the desk's, opened from the
 * patient's Billing tab: Front Desk and Accounts discuss cost with the patient
 * and cannot read the clinical record the first address sits in (bug report
 * 16 Oct, finding 25). Both read `/api/billing/estimates/[id]`, which serves
 * either capability. `from` says which one this is, for where Back goes.
 */

interface Item {
  id: string
  phase: number
  priority: number
  toothNumbers: string | null
  estimatedCost: string | number
  notes: string | null
  status: string
  procedure: { code: string; name: string; description: string | null }
}

interface Plan {
  id: string
  planNumber: string
  title: string
  notes: string | null
  status: string
  estimatedCost: string | number
  phaseNames: string[] | null
  createdAt: string
  consentDate: string | null
  patient: { id: string; patientId: string; firstName: string; lastName: string; phone: string }
  items: Item[]
}

interface Clinic {
  name: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
}

/** Where the estimate was opened from, and so where Back goes. */
const RETURN = {
  plan: {
    to: (plan: Plan) => ({ href: `/treatments/plans/${plan.id}`, label: 'Treatment plan' }),
    missing: { href: '/treatments/plans', label: 'Treatment plans' },
  },
  billing: {
    to: (plan: Plan) => ({ href: `/patients/${plan.patient.id}?tab=billing`, label: 'Patient' }),
    missing: { href: '/billing', label: 'Billing' },
  },
} as const

export function PlanEstimate({ id, from }: { id: string; from: keyof typeof RETURN }) {
  const back = RETURN[from]
  const trail = useTrail('Estimate')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [loading, setLoading] = useState(true)
  // Why there is no plan: the route said 404, or the request failed.
  const [loadState, setLoadState] = useState<'ok' | 'missing' | 'failed'>('ok')
  // The newest load; an older one that lands late is dropped.
  const latest = useRef(0)
  const printing = usePrint({
    documentTitle: plan ? `Treatment estimate ${plan.planNumber}` : 'Treatment estimate',
  })

  const load = useCallback(async () => {
    const request = ++latest.current
    setLoading(true)
    setLoadState('ok')
    try {
      const [planRes, clinicRes] = await Promise.all([
        fetch(`/api/billing/estimates/${id}`),
        // The clinic's name on the screen preview is a nicety; the page shows
        // without it. The printout never uses it: the paper has the letterhead.
        // From the print settings, which everyone can read: the clinic route
        // needs `settings:read`.
        fetch('/api/settings/print').catch(() => null),
      ])
      if (request !== latest.current) return
      if (planRes.status === 404) {
        setLoadState('missing')
      } else if (!planRes.ok) {
        setLoadState('failed')
      } else {
        setPlan(await planRes.json())
      }
      if (clinicRes?.ok) {
        const payload = await clinicRes.json()
        if (request === latest.current) setClinic(payload.clinic ?? null)
      }
    } catch {
      if (request === latest.current) setLoadState('failed')
    } finally {
      if (request === latest.current) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    // Loading is the effect's job: it fetches and stores what comes back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  if (loading && !plan) {
    return <PageSkeleton variant="detail" />
  }

  if (!plan) {
    return (
      <div className="space-y-4">
        <BackLink fallback={back.missing.href} fallbackLabel={back.missing.label} trail={trail} />
        {loadState === 'failed' ? (
          <LoadFailed what="this estimate" onRetry={load} />
        ) : (
          <EmptyState
            icon={FileText}
            title="Treatment plan not found"
            description="It may have been deleted, or the link is wrong."
            actionLabel={`Back to ${back.missing.label.toLowerCase()}`}
            actionHref={back.missing.href}
          />
        )}
      </div>
    )
  }

  const phases = groupByPhase(plan.items, plan.phaseNames)
  const phased = phases.length > 1

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PrintDocument printing={printing}>
        <PlanEstimatePrint plan={plan} />
      </PrintDocument>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink fallback={back.to(plan).href} fallbackLabel={back.to(plan).label} trail={trail} />
        <PrintButton printing={printing} label="Print estimate" />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
          <div>
            <h1 className="text-xl font-semibold">{clinic?.name ?? 'Treatment estimate'}</h1>
            {clinic && (
              <p className="mt-1 text-sm text-muted-foreground">
                {[clinic.address, clinic.city].filter(Boolean).join(', ')}
                {clinic.phone && <br />}
                {formatPhone(clinic.phone)}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm uppercase tracking-[0.08em] text-muted-foreground">
              Treatment estimate
            </p>
            <p className="text-sm">{plan.planNumber}</p>
            <p className="text-sm text-muted-foreground">{displayDate(plan.createdAt)}</p>
          </div>
        </header>

        <section className="grid gap-6 border-b py-6 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
              Prepared for
            </p>
            <p className="mt-1 font-medium">
              {plan.patient.firstName} {plan.patient.lastName}
            </p>
            <p className="text-sm text-muted-foreground">{plan.patient.patientId}</p>
            <p className="text-sm text-muted-foreground">{formatPhone(plan.patient.phone)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Plan</p>
            <p className="mt-1 font-medium">{plan.title}</p>
          </div>
        </section>

        {phases.map((phase) => (
          <section key={phase.number} className="border-b py-6 last:border-0">
            {phased && (
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  <span className="text-muted-foreground">Phase {phase.number} · </span>
                  {phase.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  This phase: <span className="font-medium">{formatCurrency(phase.subtotal)}</span>
                  {phase.number > 1 && ` · cumulative ${formatCurrency(phase.runningTotal)}`}
                </p>
              </header>
            )}

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 font-medium">Treatment</th>
                  <th className="py-2 font-medium">Teeth</th>
                  <th className="py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {phase.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2">
                      <span className="font-medium">{item.procedure.name}</span>
                      {item.notes && (
                        <span className="block text-xs text-muted-foreground">{item.notes}</span>
                      )}
                    </td>
                    <td className="py-2">
                      {describeTeethByQuadrant(parseTeeth(item.toothNumbers)) || BLANK}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(item.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <section className="mt-6 flex justify-end">
          <dl className="min-w-[16rem] space-y-1 text-sm">
            {phased &&
              phases.map((phase) => (
                <div key={phase.number} className="flex justify-between">
                  <dt className="text-muted-foreground">
                    Phase {phase.number} — {phase.name}
                  </dt>
                  <dd className="tabular-nums">{formatCurrency(phase.subtotal)}</dd>
                </div>
              ))}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total if all phases are carried out</dt>
              <dd className="tabular-nums">{formatCurrency(plan.estimatedCost)}</dd>
            </div>
          </dl>
        </section>

        {plan.notes && (
          <section className="mt-6 border-t pt-6">
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{plan.notes}</p>
          </section>
        )}

        <footer className="mt-8 border-t pt-6 text-sm text-muted-foreground">
          <p>
            This is an estimate, not an invoice. Costs are for the treatment described above and may
            change if what is found during treatment differs from what was expected — you will be
            told before any additional work is carried out.
            {phased && ' Each phase can be agreed to on its own.'}
          </p>
          {clinic?.phone && (
            <p className="mt-2">Questions? Call us on {formatPhone(clinic.phone)}.</p>
          )}
        </footer>
      </div>
    </div>
  )
}
