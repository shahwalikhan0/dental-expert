'use client'

import { use, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { Loader2, Printer } from 'lucide-react'
import { formatCurrency } from '@/lib/billing-utils'
import { displayDate } from '@/lib/dates'
import { formatToothNumbers, parseToothNumbers } from '@/lib/treatment-utils'
import { groupByPhase } from '@/lib/treatment-phases'

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
  estimatedCost: string | number
  phaseNames: string[] | null
  createdAt: string
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

export default function TreatmentEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const trail = useTrail('Estimate')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [planRes, clinicRes] = await Promise.all([
          fetch(`/api/treatment-plans/${id}`),
          fetch('/api/settings/clinic'),
        ])
        if (!cancelled && planRes.ok) setPlan(await planRes.json())
        if (!cancelled && clinicRes.ok) {
          const payload = await clinicRes.json()
          setClinic(payload.hospital ?? payload.clinic ?? payload)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="space-y-4">
        <BackLink fallback="/treatments/plans" fallbackLabel="Treatment plans" trail={trail} />
        <p className="text-muted-foreground">That plan could not be loaded.</p>
      </div>
    )
  }

  const phases = groupByPhase(plan.items, plan.phaseNames)
  const phased = phases.length > 1

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <BackLink
          fallback={`/treatments/plans/${plan.id}`}
          fallbackLabel="Treatment plan"
          trail={trail}
        />
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Print
        </Button>
      </div>

      <div className="rounded-lg border bg-background p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
          <div>
            <h1 className="text-xl font-semibold">{clinic?.name ?? 'Treatment estimate'}</h1>
            {clinic && (
              <p className="mt-1 text-sm text-muted-foreground">
                {[clinic.address, clinic.city].filter(Boolean).join(', ')}
                {clinic.phone && <br />}
                {clinic.phone}
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
            <p className="text-sm text-muted-foreground">{plan.patient.phone}</p>
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
                      {formatToothNumbers(parseToothNumbers(item.toothNumbers ?? ''))}
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
          {clinic?.phone && <p className="mt-2">Questions? Call us on {clinic.phone}.</p>}
        </footer>
      </div>
    </div>
  )
}
