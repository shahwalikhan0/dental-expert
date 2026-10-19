'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { LoadFailed } from '@/components/ui/load-failed'
import { StatusBadge } from '@/components/ui/status-badge'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
import { StatTile } from '@/components/ui/stat-tile'
import {
  Plus,
  Receipt,
  CreditCard,
  AlertCircle,
  Banknote,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  BarChart3,
  BadgePercent,
} from 'lucide-react'
import { formatCurrency, dateRangePresets } from '@/lib/billing-utils'
import { AGEING_BUCKETS, type AgeingBucketKey } from '@/lib/ageing'
import { ExportMenu } from '@/components/ui/export-menu'
import { useCan } from '@/hooks/use-can'

interface SummaryData {
  summary: {
    totalBilled: number
    totalDiscounts: number
    invoiceCount: number
    totalCollected: number
    paymentCount: number
    totalOutstanding: number
    outstandingInvoices: number
  }
  breakdowns: {
    byPaymentMethod: Array<{
      method: string
      amount: number
      count: number
    }>
    byInvoiceStatus: Array<{
      status: string
      amount: number
      count: number
    }>
  }
}

interface AgingData {
  aging: Record<AgeingBucketKey, { amount: number; count: number }>
  totals: { totalOutstanding: number; invoiceCount: number }
}

/** One colour per ageing bucket, in AGEING_BUCKETS order. */
const AGEING_COLOURS = [
  'bg-green-500',
  'bg-yellow-500',
  'bg-orange-500',
  'bg-red-400',
  'bg-red-600',
]

export default function BillingPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<SummaryData | null>(null)
  const [datePreset, setDatePreset] = useState('this_month')
  const [agingData, setAgingData] = useState<AgingData | null>(null)
  // Every figure on this screen comes from the billing reports, which need
  // `reports:financial`. Dentists and the front desk have Billing in their
  // menu for the invoice and payment lists, and used to land on "Forbidden"
  // and a row of zeros.
  const canSeeFigures = useCan('reports:financial')
  // Raising an invoice is `billing:write`; a dentist reads the bills only.
  const canWrite = useCan('billing:write') === true
  // The figures could not be fetched — said as such, not as a row of zeros.
  const [failed, setFailed] = useState(false)

  const fetchSummary = async () => {
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/billing/reports?type=summary&preset=${datePreset}`)
      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = errorData.details
          ? `${errorData.error}: ${errorData.details}`
          : errorData.error || 'Failed to fetch summary'
        throw new Error(errorMessage)
      }
      const result = await response.json()
      setData(result)
    } catch (error) {
      console.error('Error fetching billing summary:', error)
      setData(null)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const fetchRevenueCycle = async () => {
    try {
      // Instalment plans were a card here calling `/api/payment-plans`, a route
      // that does not exist, over a `PaymentPlan` model that does not exist —
      // so the card sat on its loading skeleton for ever and its two buttons
      // opened pages that were never built. Removed rather than left pretending.
      const [agingRes] = await Promise.all([fetch('/api/billing/reports?type=outstanding')])
      if (agingRes.ok) {
        const d = await agingRes.json()
        setAgingData(d)
      }
    } catch {
      // non-critical
    }
  }

  useEffect(() => {
    if (canSeeFigures !== true) return
    // Fetching on mount and on change is what this effect is for; the state it
    // sets is the answer arriving.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSummary()
    fetchRevenueCycle()
    // The period and the permission are the whole question; the fetches read them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset, canSeeFigures])

  const paymentMethodLabels: Record<string, string> = {
    CASH: 'Cash',
    CARD: 'Card',
    BANK_TRANSFER: 'Bank Transfer',
    CHEQUE: 'Cheque',
    WALLET: 'Mobile Wallet',
    ONLINE: 'Online',
  }

  if (canSeeFigures === false) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Billing"
          description="Invoices and payments"
          actions={
            canWrite && (
              <Button asChild>
                <Link href="/billing/invoices/new">
                  <Plus className="h-4 w-4" />
                  New invoice
                </Link>
              </Button>
            )
          }
        />
        <Card className="max-w-2xl">
          <CardContent className="pt-6">
            <LinkList>
              <LinkRow
                href="/billing/invoices"
                icon={FileText}
                title="Invoices"
                subtitle="Raise, issue and look up invoices"
              />
              <LinkRow
                href="/billing/payments"
                icon={CreditCard}
                title="Payments"
                subtitle="Payments taken and their receipts"
              />
            </LinkList>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          The clinic&apos;s billing figures are part of the financial reports, which your role does
          not include.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing & finance"
        description="Manage invoices, payments and financial reports"
        actions={
          <>
            <Select value={datePreset} onValueChange={setDatePreset}>
              <SelectTrigger className="w-[160px]" aria-label="Period">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {dateRangePresets
                  .filter((p) => p.value !== 'custom')
                  .map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <ExportMenu
              filename="billing-summary"
              getData={() => {
                const rows: Record<string, unknown>[] = []
                if (data) {
                  rows.push({
                    Metric: 'Total billed',
                    Amount: data.summary.totalBilled,
                    Count: data.summary.invoiceCount,
                  })
                  rows.push({
                    Metric: 'Total collected',
                    Amount: data.summary.totalCollected,
                    Count: data.summary.paymentCount,
                  })
                  rows.push({
                    Metric: 'Total outstanding',
                    Amount: data.summary.totalOutstanding,
                    Count: data.summary.outstandingInvoices,
                  })
                  rows.push({
                    Metric: 'Total discounts',
                    Amount: data.summary.totalDiscounts,
                    Count: '',
                  })
                  data.breakdowns.byPaymentMethod.forEach((m) => {
                    rows.push({
                      Metric: `Payment method: ${m.method}`,
                      Amount: m.amount,
                      Count: m.count,
                    })
                  })
                  data.breakdowns.byInvoiceStatus.forEach((s) => {
                    rows.push({
                      Metric: `Invoice status: ${s.status}`,
                      Amount: s.amount,
                      Count: s.count,
                    })
                  })
                }
                return rows
              }}
            />
            {canWrite && (
              <Button asChild>
                <Link href="/billing/invoices/new">
                  <Plus className="h-4 w-4" />
                  New invoice
                </Link>
              </Button>
            )}
          </>
        }
      />

      {failed ? (
        <LoadFailed what="the billing figures" onRetry={fetchSummary} />
      ) : (
        <>
          {/* The period's headline figures, one tile each. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Total billed"
              icon={Receipt}
              loading={loading}
              value={formatCurrency(data?.summary.totalBilled || 0)}
              hint={`${data?.summary.invoiceCount || 0} invoices`}
            />
            <StatTile
              label="Total collected"
              icon={Banknote}
              tone="success"
              loading={loading}
              value={formatCurrency(data?.summary.totalCollected || 0)}
              hint={`${data?.summary.paymentCount || 0} payments received`}
            />
            <StatTile
              label="Outstanding"
              icon={AlertCircle}
              tone="danger"
              loading={loading}
              value={formatCurrency(data?.summary.totalOutstanding || 0)}
              hint={`${data?.summary.outstandingInvoices || 0} invoices still owed`}
            />
            <StatTile
              label="Discounts given"
              icon={BadgePercent}
              loading={loading}
              value={formatCurrency(data?.summary.totalDiscounts || 0)}
              hint="Taken off the bills in the period"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {/* Collection Rate */}
              {!loading && data && (
                <Card>
                  <CardHeader>
                    <CardTitle>Collection rate</CardTitle>
                    {/* Cash collected in the period ÷ invoices issued in the period. Both
                    sides now leave drafts and cancelled bills out; it can pass 100%
                    in a month that collects older debts. */}
                    <CardDescription>
                      Collected in the period as a share of what was billed
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Collection progress</span>
                        <span className="text-sm font-semibold">
                          {data.summary.totalBilled > 0
                            ? Math.round(
                                (data.summary.totalCollected / data.summary.totalBilled) * 100
                              )
                            : 0}
                          %
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all duration-500"
                          style={{
                            width: `${
                              data.summary.totalBilled > 0
                                ? Math.min(
                                    100,
                                    Math.round(
                                      (data.summary.totalCollected / data.summary.totalBilled) * 100
                                    )
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                    <InfoGrid className="grid-cols-3 sm:grid-cols-3">
                      <InfoItem label="Billed">{formatCurrency(data.summary.totalBilled)}</InfoItem>
                      <InfoItem label="Collected">
                        <span className="text-green-600 dark:text-green-400">
                          {formatCurrency(data.summary.totalCollected)}
                        </span>
                      </InfoItem>
                      <InfoItem label="Discounts">
                        <span className="text-orange-600 dark:text-orange-400">
                          {formatCurrency(data.summary.totalDiscounts)}
                        </span>
                      </InfoItem>
                    </InfoGrid>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-6 md:grid-cols-2">
                {/* Payment Methods */}
                <Card>
                  <CardHeader>
                    <CardTitle>Payment methods</CardTitle>
                    <CardDescription>Collection by payment type</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full rounded-xl" />
                        ))}
                      </div>
                    ) : data?.breakdowns.byPaymentMethod.length === 0 ? (
                      <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                        No payments recorded
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {data?.breakdowns.byPaymentMethod.map((method) => (
                          <li
                            key={method.method}
                            className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                                <CreditCard className="h-4 w-4" />
                              </span>
                              <span className="truncate text-sm font-medium">
                                {paymentMethodLabels[method.method] || method.method}
                              </span>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold tabular-nums">
                                {formatCurrency(method.amount)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {method.count} payments
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* Invoice Status */}
                <Card>
                  <CardHeader>
                    <CardTitle>Invoice status</CardTitle>
                    <CardDescription>Invoices by current status</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full rounded-xl" />
                        ))}
                      </div>
                    ) : data?.breakdowns.byInvoiceStatus.length === 0 ? (
                      <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                        No invoices created
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {data?.breakdowns.byInvoiceStatus.map((status) => (
                          <li
                            key={status.status}
                            className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              {status.status === 'PAID' && (
                                <CheckCircle className="h-4 w-4 text-green-500 dark:text-green-400" />
                              )}
                              {status.status === 'PENDING' && (
                                <Clock className="h-4 w-4 text-yellow-500 dark:text-yellow-400" />
                              )}
                              {status.status === 'OVERDUE' && (
                                <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                              )}
                              {status.status === 'CANCELLED' && (
                                <XCircle className="h-4 w-4 text-muted-foreground" />
                              )}
                              {!['PAID', 'PENDING', 'OVERDUE', 'CANCELLED'].includes(
                                status.status
                              ) && <FileText className="h-4 w-4 text-muted-foreground" />}
                              <StatusBadge kind="invoice" status={status.status} />
                            </div>
                            <div className="text-right">
                              <div className="font-semibold tabular-nums">
                                {formatCurrency(status.amount)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {status.count} invoices
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="space-y-6">
              {/* Where to go from here, one row each. */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Quick actions</CardTitle>
                  <CardDescription>Common billing tasks</CardDescription>
                </CardHeader>
                <CardContent>
                  <LinkList>
                    <LinkRow
                      href="/billing/invoices"
                      icon={FileText}
                      title="View all invoices"
                      subtitle="Raise, issue and look up invoices"
                    />
                    <LinkRow
                      href="/billing/payments"
                      icon={CreditCard}
                      title="View all payments"
                      subtitle="Payments taken and their receipts"
                    />
                    {/* Payment plans, insurance claims, insurance providers and
                    pre-authorisations were four more links here. None of those
                    pages exists — `39fdd2e` removed the tables as out of scope
                    (spec §3) and left the buttons, so four of the seven quick
                    actions on the billing screen were 404s. */}
                    <LinkRow
                      href="/billing/reports"
                      icon={BarChart3}
                      title="Financial reports"
                      subtitle="Outstanding, by procedure, by doctor, daily"
                    />
                  </LinkList>
                </CardContent>
              </Card>

              {/* Claims Aging */}
              <Card>
                <CardHeader>
                  <CardTitle>Claims aging</CardTitle>
                  <CardDescription>Outstanding balances by days past due</CardDescription>
                </CardHeader>
                <CardContent>
                  {!agingData ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {AGEING_BUCKETS.map((bucket, index) => ({
                        label: bucket.label,
                        hint: bucket.hint,
                        data: agingData.aging[bucket.key],
                        color: AGEING_COLOURS[index],
                      })).map((bucket) => {
                        const total = agingData.totals.totalOutstanding || 1
                        const pct = Math.round((bucket.data.amount / total) * 100)
                        return (
                          <div key={bucket.label} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span title={bucket.hint}>{bucket.label}</span>
                              <div className="text-right">
                                <span className="font-medium">
                                  {formatCurrency(bucket.data.amount)}
                                </span>
                                <span className="text-muted-foreground ml-2">
                                  ({bucket.data.count})
                                </span>
                              </div>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full ${bucket.color}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                      <div className="pt-2 border-t flex justify-between text-sm font-medium">
                        <span>Total outstanding</span>
                        <span className="text-red-600 dark:text-red-400">
                          {formatCurrency(agingData.totals.totalOutstanding)}
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
