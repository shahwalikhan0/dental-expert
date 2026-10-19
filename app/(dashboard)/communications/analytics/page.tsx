'use client'

import { useState, useEffect, type ComponentType, type ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { IconTooltip } from '@/components/ui/icon-action'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/i18n/format'
import { readJson, toastError } from '@/lib/toast-utils'
import { BarChart3, DollarSign, Eye, RefreshCw, Send, XCircle, CheckCircle2 } from 'lucide-react'

/**
 * Failures as a share of the messages that were tried — those that went and
 * those that failed. It was taken against every message, the ones still queued
 * included, so a batch waiting to go made the failure rate look smaller than
 * it was, and the email tile measured it against a different count from the
 * "delivered" figure beside it.
 */
function failureRate(failed: number, succeeded: number): string {
  const tried = failed + succeeded
  return tried > 0
    ? `${((failed / tried) * 100).toFixed(1)}% of those sent failed`
    : 'None sent yet'
}

interface AnalyticsData {
  period: string
  sms: {
    total: number
    delivered: number
    sent: number
    failed: number
    pending: number
    queued: number
    deliveryRate: number
    totalCost: number
  }
  email: {
    total: number
    sent: number
    failed: number
    opened: number
    openRate: number
  }
  dailyTrend: Array<{ date: string; sms: number; email: number }>
  topTemplates: {
    sms: Array<{ templateId: string; name: string; category: string; count: number }>
    email: Array<{ templateId: string; name: string; category: string; count: number }>
  }
}

export default function CampaignAnalyticsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [failed, setFailed] = useState(false)
  const trail = useTrail('Campaign analytics')

  const fetchAnalytics = async (p: string) => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/communications/analytics?period=${p}`)
      setData(await readJson<AnalyticsData>(res))
    } catch (err) {
      // With figures already on screen, a failed refresh is a toast; with
      // nothing yet, the page says so with a retry (LoadFailed below). It
      // used to do both, so a first load that failed said so twice.
      setFailed(true)
      if (data) toast(toastError('load the analytics', err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics(period)
  }, [period])

  const maxDailyVolume = data?.dailyTrend
    ? Math.max(...data.dailyTrend.map((d) => d.sms + d.email), 1)
    : 1

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaign analytics"
        description="SMS delivery rates and email engagement"
        back={<BackLink trail={trail} fallback="/communications" fallbackLabel="Communications" />}
        actions={
          <>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[130px]" aria-label="Period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <IconTooltip label="Refresh">
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh"
                onClick={() => fetchAnalytics(period)}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </IconTooltip>
          </>
        }
      />

      {loading && !data ? (
        <PageSkeleton variant="dashboard" />
      ) : failed && !data ? (
        <LoadFailed what="the analytics" onRetry={() => fetchAnalytics(period)} />
      ) : data ? (
        <>
          {/* SMS Stats Cards */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight">SMS overview</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile
                label="Total sent"
                icon={Send}
                value={data.sms.total.toLocaleString()}
                note={
                  data.sms.pending + data.sms.queued > 0
                    ? `${data.sms.pending + data.sms.queued} pending`
                    : 'All processed'
                }
              />
              <StatTile
                label="Delivery rate"
                icon={CheckCircle2}
                value={`${data.sms.deliveryRate}%`}
                note={`${data.sms.delivered + data.sms.sent} delivered`}
              />
              <StatTile
                label="Failed"
                icon={XCircle}
                value={data.sms.failed}
                danger
                note={failureRate(data.sms.failed, data.sms.delivered + data.sms.sent)}
              />
              <StatTile
                label="Total cost"
                icon={DollarSign}
                value={formatCurrency(data.sms.totalCost)}
                note={
                  data.sms.total > 0
                    ? `${formatCurrency(data.sms.totalCost / data.sms.total, { maximumFractionDigits: 4 })}/msg`
                    : 'No cost data'
                }
              />
            </div>
          </section>

          {/* Email Stats Cards */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight">Email overview</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile
                label="Total sent"
                icon={Send}
                value={data.email.total.toLocaleString()}
                note={`${data.email.sent} successfully delivered`}
              />
              <StatTile
                label="Open rate"
                icon={Eye}
                value={`${data.email.openRate}%`}
                note={`${data.email.opened} opened of ${data.email.sent}`}
              />
              <StatTile
                label="Failed"
                icon={XCircle}
                value={data.email.failed}
                danger
                note={failureRate(data.email.failed, data.email.sent)}
              />
            </div>
          </section>

          {/* Daily Trend Chart (CSS-based bar chart) */}
          {data.dailyTrend.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Daily message volume</CardTitle>
                <CardDescription>SMS and email messages sent per day</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-1 h-[200px] overflow-x-auto pb-6">
                  {data.dailyTrend.slice(-30).map((day) => {
                    const total = day.sms + day.email
                    const smsHeight = maxDailyVolume > 0 ? (day.sms / maxDailyVolume) * 180 : 0
                    const emailHeight = maxDailyVolume > 0 ? (day.email / maxDailyVolume) * 180 : 0
                    return (
                      <div
                        key={day.date}
                        className="flex flex-col items-center flex-1 min-w-[20px] group relative"
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-xs bg-popover border rounded px-2 py-1 whitespace-nowrap z-10">
                          {day.date}: {day.sms} SMS, {day.email} Email
                        </div>
                        <div className="flex flex-col-reverse w-full gap-[1px]">
                          {day.sms > 0 && (
                            <div
                              className="bg-blue-500 rounded-t-sm w-full"
                              style={{ height: `${Math.max(smsHeight, 2)}px` }}
                            />
                          )}
                          {day.email > 0 && (
                            <div
                              className="bg-purple-500 rounded-t-sm w-full"
                              style={{ height: `${Math.max(emailHeight, 2)}px` }}
                            />
                          )}
                          {total === 0 && (
                            <div
                              className="bg-muted rounded-t-sm w-full"
                              style={{ height: '2px' }}
                            />
                          )}
                        </div>
                        <span className="text-[9px] text-muted-foreground mt-1 rotate-45 origin-left">
                          {day.date.slice(5)}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm bg-blue-500" /> SMS
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm bg-purple-500" /> Email
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Templates */}
          <div className="grid gap-6 md:grid-cols-2">
            {data.topTemplates.sms.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Top SMS templates</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {data.topTemplates.sms.map((t, i) => (
                      <div
                        key={t.templateId}
                        className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{t.name}</p>
                            <Badge variant="outline" className="mt-0.5 text-xs">
                              {t.category}
                            </Badge>
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {t.count} sent
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {data.topTemplates.email.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Top email templates</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {data.topTemplates.email.map((t, i) => (
                      <div
                        key={t.templateId}
                        className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{t.name}</p>
                            <Badge variant="outline" className="mt-0.5 text-xs">
                              {t.category}
                            </Badge>
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {t.count} sent
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Empty state */}
          {data.sms.total === 0 && data.email.total === 0 && (
            <EmptyState
              icon={BarChart3}
              title="No analytics data yet"
              description="Start sending SMS and emails to see campaign analytics here."
            />
          )}
        </>
      ) : null}
    </div>
  )
}

/** One figure, in the tile every list and dashboard page uses. */
function StatTile({
  label,
  value,
  note,
  icon: Icon,
  danger,
}: {
  label: string
  value: ReactNode
  note: string
  icon: ComponentType<{ className?: string }>
  /** Failures: the figure in red. */
  danger?: boolean
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p
            className={`mt-1 text-2xl font-bold tracking-tight ${
              danger ? 'text-red-600 dark:text-red-400' : ''
            }`}
          >
            {value}
          </p>
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            danger ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-primary/10 text-primary'
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  )
}
