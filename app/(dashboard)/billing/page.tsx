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
import {
  Plus,
  Receipt,
  CreditCard,
  TrendingUp,
  AlertCircle,
  IndianRupee,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  BarChart3,
} from 'lucide-react'
import { formatCurrency, dateRangePresets, getDateRangeFromPreset } from '@/lib/billing-utils'
import { ExportMenu } from '@/components/ui/export-menu'
import { useCan } from '@/hooks/use-can'
import { useToast } from '@/hooks/use-toast'

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
  aging: {
    current: { amount: number; count: number }
    days1_30: { amount: number; count: number }
    days31_60: { amount: number; count: number }
    days61_90: { amount: number; count: number }
    over90: { amount: number; count: number }
  }
  totals: { totalOutstanding: number; invoiceCount: number }
}

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
  const { toast } = useToast()

  const fetchSummary = async () => {
    try {
      setLoading(true)
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
      toast({
        variant: 'destructive',
        title: 'Could not load the billing figures',
        description: error instanceof Error ? error.message : 'Failed to fetch summary',
      })
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
    fetchSummary()
    fetchRevenueCycle()
  }, [datePreset, canSeeFigures])

  const paymentMethodLabels: Record<string, string> = {
    CASH: 'Cash',
    CARD: 'Card',
    BANK_TRANSFER: 'Bank Transfer',
    CHEQUE: 'Cheque',
    WALLET: 'Mobile Wallet',
  }

  const invoiceStatusLabels: Record<string, { label: string; color: string }> = {
    DRAFT: { label: 'Draft', color: 'text-muted-foreground' },
    PENDING: { label: 'Pending', color: 'text-yellow-600 dark:text-yellow-400' },
    PARTIALLY_PAID: { label: 'Partially Paid', color: 'text-blue-600 dark:text-blue-400' },
    PAID: { label: 'Paid', color: 'text-green-600 dark:text-green-400' },
    OVERDUE: { label: 'Overdue', color: 'text-red-600 dark:text-red-400' },
    CANCELLED: { label: 'Cancelled', color: 'text-muted-foreground' },
    REFUNDED: { label: 'Refunded', color: 'text-purple-600 dark:text-purple-400' },
  }

  if (canSeeFigures === false) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="page-title">Billing</h1>
            <p className="text-muted-foreground">Invoices and payments</p>
          </div>
          <Button asChild>
            <Link href="/billing/invoices/new">
              <Plus className="h-4 w-4 mr-2" />
              New Invoice
            </Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/billing/invoices" className="block">
            <Card className="h-full transition-colors hover:bg-foreground/[0.03]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Invoices
                </CardTitle>
                <CardDescription>Raise, issue and look up invoices</CardDescription>
              </CardHeader>
            </Card>
          </Link>
          <Link href="/billing/payments" className="block">
            <Card className="h-full transition-colors hover:bg-foreground/[0.03]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Payments
                </CardTitle>
                <CardDescription>Payments taken and their receipts</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          The clinic&apos;s billing figures are part of the financial reports, which your role does
          not include.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Billing & Finance</h1>
          <p className="text-muted-foreground">Manage invoices, payments, and financial reports</p>
        </div>
        <div className="flex gap-2">
          <Select value={datePreset} onValueChange={setDatePreset}>
            <SelectTrigger className="w-[160px]">
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
                  Metric: 'Total Billed',
                  Amount: data.summary.totalBilled,
                  Count: data.summary.invoiceCount,
                })
                rows.push({
                  Metric: 'Total Collected',
                  Amount: data.summary.totalCollected,
                  Count: data.summary.paymentCount,
                })
                rows.push({
                  Metric: 'Total Outstanding',
                  Amount: data.summary.totalOutstanding,
                  Count: data.summary.outstandingInvoices,
                })
                rows.push({
                  Metric: 'Total Discounts',
                  Amount: data.summary.totalDiscounts,
                  Count: '',
                })
                data.breakdowns.byPaymentMethod.forEach((m) => {
                  rows.push({
                    Metric: `Payment Method: ${m.method}`,
                    Amount: m.amount,
                    Count: m.count,
                  })
                })
                data.breakdowns.byInvoiceStatus.forEach((s) => {
                  rows.push({
                    Metric: `Invoice Status: ${s.status}`,
                    Amount: s.amount,
                    Count: s.count,
                  })
                })
              }
              return rows
            }}
          />
          <Button asChild>
            <Link href="/billing/invoices/new">
              <Plus className="h-4 w-4 mr-2" />
              New Invoice
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Total Billed */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Billed</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatCurrency(data?.summary.totalBilled || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {data?.summary.invoiceCount || 0} invoices
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Total Collected */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
            <IndianRupee className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(data?.summary.totalCollected || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {data?.summary.paymentCount || 0} payments received
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Outstanding */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {formatCurrency(data?.summary.totalOutstanding || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {data?.summary.outstandingInvoices || 0} pending invoices
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions & Breakdowns */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common billing tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link href="/billing/invoices" className="block">
                <FileText className="h-4 w-4 mr-2" />
                View All Invoices
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link href="/billing/payments" className="block">
                <CreditCard className="h-4 w-4 mr-2" />
                View All Payments
              </Link>
            </Button>
            {/* Payment plans, insurance claims, insurance providers and
                pre-authorisations were four more links here. None of those
                pages exists — `39fdd2e` removed the tables as out of scope
                (spec §3) and left the buttons, so four of the seven quick
                actions on the billing screen were 404s. */}
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link href="/billing/reports" className="block">
                <BarChart3 className="h-4 w-4 mr-2" />
                Financial Reports
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Payment Methods */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Methods</CardTitle>
            <CardDescription>Collection by payment type</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {data?.breakdowns.byPaymentMethod.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No payments recorded
                  </p>
                ) : (
                  data?.breakdowns.byPaymentMethod.map((method) => (
                    <div key={method.method} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {paymentMethodLabels[method.method] || method.method}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{formatCurrency(method.amount)}</div>
                        <div className="text-xs text-muted-foreground">{method.count} payments</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoice Status */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice Status</CardTitle>
            <CardDescription>Invoices by current status</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {data?.breakdowns.byInvoiceStatus.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No invoices created
                  </p>
                ) : (
                  data?.breakdowns.byInvoiceStatus.map((status) => {
                    const config = invoiceStatusLabels[status.status] || {
                      label: status.status,
                      color: 'text-muted-foreground',
                    }
                    return (
                      <div key={status.status} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
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
                          {!['PAID', 'PENDING', 'OVERDUE', 'CANCELLED'].includes(status.status) && (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className={`text-sm ${config.color}`}>{config.label}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">{formatCurrency(status.amount)}</div>
                          <div className="text-xs text-muted-foreground">
                            {status.count} invoices
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Collection Rate */}
      {!loading && data && (
        <Card>
          <CardHeader>
            <CardTitle>Collection Rate</CardTitle>
            <CardDescription>Percentage of billed amount collected</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Collection Progress</span>
                  <span className="text-sm font-medium">
                    {data.summary.totalBilled > 0
                      ? Math.round((data.summary.totalCollected / data.summary.totalBilled) * 100)
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
              <div className="flex gap-6 text-sm">
                <div>
                  <div className="text-muted-foreground">Billed</div>
                  <div className="font-medium">{formatCurrency(data.summary.totalBilled)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Collected</div>
                  <div className="font-medium text-green-600 dark:text-green-400">
                    {formatCurrency(data.summary.totalCollected)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Discounts</div>
                  <div className="font-medium text-orange-600 dark:text-orange-400">
                    {formatCurrency(data.summary.totalDiscounts)}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Cycle Section */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Claims Aging */}
        <Card>
          <CardHeader>
            <CardTitle>Claims Aging</CardTitle>
            <CardDescription>Outstanding invoices by overdue period</CardDescription>
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
                {[
                  { label: 'Current', data: agingData.aging.current, color: 'bg-green-500' },
                  { label: '1–30 days', data: agingData.aging.days1_30, color: 'bg-yellow-500' },
                  { label: '31–60 days', data: agingData.aging.days31_60, color: 'bg-orange-500' },
                  { label: '61–90 days', data: agingData.aging.days61_90, color: 'bg-red-400' },
                  { label: '90+ days', data: agingData.aging.over90, color: 'bg-red-600' },
                ].map((bucket) => {
                  const total = agingData.totals.totalOutstanding || 1
                  const pct = Math.round((bucket.data.amount / total) * 100)
                  return (
                    <div key={bucket.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{bucket.label}</span>
                        <div className="text-right">
                          <span className="font-medium">{formatCurrency(bucket.data.amount)}</span>
                          <span className="text-muted-foreground ml-2">({bucket.data.count})</span>
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
                  <span>Total Outstanding</span>
                  <span className="text-red-600 dark:text-red-400">
                    {formatCurrency(agingData.totals.totalOutstanding)}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Plans Summary */}
      </div>
    </div>
  )
}
