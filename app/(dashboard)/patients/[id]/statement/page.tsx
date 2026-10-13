'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { Loader2, Printer } from 'lucide-react'
import { formatCurrency } from '@/lib/billing-utils'
import { displayDate } from '@/lib/dates'
import { AGEING_BUCKETS } from '@/lib/ageing'
import type { Ledger } from '@/lib/ledger'

/**
 * The statement — one page, addressed to whoever settles the bill.
 *
 * A practice does not chase debt with a list of invoices; it sends a
 * statement: every charge and every payment since the account was last clear,
 * the balance at the bottom, and how old that balance is. This application
 * could print an invoice and a receipt and had nothing that said "this is
 * where we stand".
 *
 * `?family=true` prints the whole account — the mother and her three children
 * on one page, which is the reason a guarantor exists. It is a deliberate
 * choice rather than the default: two people sharing a payer have not thereby
 * agreed to see each other's treatment costs.
 */

interface Family {
  guarantorId: string
  isShared: boolean
  members: { id: string; firstName: string; lastName: string; patientId: string }[]
}

interface StatementData extends Ledger {
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    address: string | null
    city: string | null
  }
  family: Family | null
  scope: 'patient' | 'family'
}

interface Clinic {
  name: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
}

export default function PatientStatementPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const family = searchParams.get('family') === 'true'
  const trail = useTrail('Statement')

  const [data, setData] = useState<StatementData | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [ledgerRes, clinicRes] = await Promise.all([
          fetch(`/api/patients/${params.id}/ledger?family=${family}`),
          fetch('/api/settings/clinic'),
        ])

        if (!cancelled && ledgerRes.ok) setData(await ledgerRes.json())
        // The clinic's own letterhead is a nicety. A statement without it is
        // still a statement, so a failure here does not fail the page.
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
  }, [params.id, family])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink fallback={`/patients/${params.id}`} fallbackLabel="Patient" trail={trail} />
        <p className="text-muted-foreground">That statement could not be loaded.</p>
      </div>
    )
  }

  const { patient, summary, entries, ageing } = data
  const addressedTo =
    data.scope === 'family' && data.family
      ? data.family.members.find((member) => member.id === data.family?.guarantorId)
      : patient

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <BackLink
          fallback={`/patients/${params.id}?tab=billing`}
          fallbackLabel="Patient"
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
            <h1 className="text-xl font-semibold">{clinic?.name ?? 'Statement'}</h1>
            {clinic && (
              <p className="mt-1 text-sm text-muted-foreground">
                {[clinic.address, clinic.city].filter(Boolean).join(', ')}
                {clinic.phone && <br />}
                {clinic.phone}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm uppercase tracking-[0.08em] text-muted-foreground">Statement</p>
            <p className="text-sm">{displayDate(new Date())}</p>
          </div>
        </header>

        <section className="grid gap-6 border-b py-6 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
              Account holder
            </p>
            <p className="mt-1 font-medium">
              {addressedTo?.firstName} {addressedTo?.lastName}
            </p>
            <p className="text-sm text-muted-foreground">{patient.patientId}</p>
            {patient.address && (
              <p className="mt-1 text-sm text-muted-foreground">
                {[patient.address, patient.city].filter(Boolean).join(', ')}
              </p>
            )}
            <p className="text-sm text-muted-foreground">{patient.phone}</p>
          </div>

          {data.scope === 'family' && data.family && data.family.members.length > 1 && (
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                Covering treatment for
              </p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {data.family.members.map((member) => (
                  <li key={member.id}>
                    {member.firstName} {member.lastName}{' '}
                    <span className="text-muted-foreground">({member.patientId})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <table className="w-full border-collapse py-6 text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Reference</th>
              <th className="py-2 font-medium">Detail</th>
              <th className="py-2 text-right font-medium">Charge</th>
              <th className="py-2 text-right font-medium">Paid</th>
              <th className="py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted-foreground">
                  Nothing has been charged to this account.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={`${entry.kind}-${entry.id}`} className="border-b last:border-0">
                  <td className="py-2 whitespace-nowrap">{displayDate(entry.date)}</td>
                  <td className="py-2">{entry.reference}</td>
                  <td className="py-2">{entry.description}</td>
                  <td className="py-2 text-right tabular-nums">
                    {entry.debit > 0
                      ? formatCurrency(entry.debit)
                      : entry.debit < 0
                        ? `−${formatCurrency(-entry.debit)}`
                        : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {entry.credit > 0 ? formatCurrency(entry.credit) : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(entry.balance)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <section className="mt-6 flex flex-wrap justify-end gap-10 border-t pt-6">
          {ageing.total > 0 && (
            <div className="text-sm">
              <p className="mb-2 text-xs uppercase tracking-[0.08em] text-muted-foreground">
                Days past due
              </p>
              <table className="border-collapse">
                <tbody>
                  {AGEING_BUCKETS.map((bucket) => (
                    <tr key={bucket.key}>
                      <td className="py-0.5 pr-6 text-muted-foreground">{bucket.label}</td>
                      <td className="py-0.5 text-right tabular-nums">
                        {formatCurrency(ageing[bucket.key])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <dl className="min-w-[14rem] space-y-1 text-sm">
            <Row label="Total charged" value={summary.charged} />
            <Row label="Total paid" value={summary.paid} />
            {summary.refunded > 0 && <Row label="Refunded" value={summary.refunded} />}
            {/* A bill refunded in full is a charge reversed, not a debt. Shown
                so the lines above still add up to the balance below. */}
            {summary.reversed > 0 && <Row label="Charges reversed" value={-summary.reversed} />}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Balance due</dt>
              <dd className="tabular-nums">{formatCurrency(summary.balance)}</dd>
            </div>
          </dl>
        </section>

        {summary.balance > 0 && clinic?.phone && (
          <p className="mt-6 text-sm text-muted-foreground">
            To settle this balance or arrange instalments, please call {clinic.phone}.
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{formatCurrency(value)}</dd>
    </div>
  )
}
