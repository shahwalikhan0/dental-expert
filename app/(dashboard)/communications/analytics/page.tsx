'use client'

import { useState, useEffect } from 'react'
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
import {
  BarChart3,
  Mail,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Eye,
  RefreshCw,
  Send,
  XCircle,
  CheckCircle2,
  Clock,
} from 'lucide-react'

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
      // nothing yet, the page says so with a retry (LoadFailed below).
      setFailed(true)
      toast(toastError('load the analytics', err))
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
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              SMS overview
            </h3>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total sent</CardTitle>
                  <Send className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.sms.total.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">
                    {data.sms.pending + data.sms.queued > 0
                      ? `${data.sms.pending + data.sms.queued} pending`
                      : 'All processed'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Delivery rate</CardTitle>
                  <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.sms.deliveryRate}%</div>
                  <p className="text-xs text-muted-foreground">
                    {data.sms.delivered + data.sms.sent} delivered
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Failed</CardTitle>
                  <XCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {data.sms.failed}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {data.sms.total > 0
                      ? `${((data.sms.failed / data.sms.total) * 100).toFixed(1)}% failure rate`
                      : 'No messages'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total cost</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(data.sms.totalCost)}</div>
                  <p className="text-xs text-muted-foreground">
                    {data.sms.total > 0
                      ? `${formatCurrency(data.sms.totalCost / data.sms.total, { maximumFractionDigits: 4 })}/msg`
                      : 'No cost data'}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Email Stats Cards */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email overview
            </h3>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total sent</CardTitle>
                  <Send className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.email.total.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">
                    {data.email.sent} successfully delivered
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Open rate</CardTitle>
                  <Eye className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.email.openRate}%</div>
                  <p className="text-xs text-muted-foreground">
                    {data.email.opened} opened of {data.email.sent}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Failed</CardTitle>
                  <XCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {data.email.failed}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {data.email.total > 0
                      ? `${((data.email.failed / data.email.total) * 100).toFixed(1)}% failure rate`
                      : 'No messages'}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Daily Trend Chart (CSS-based bar chart) */}
          {data.dailyTrend.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Daily message volume
                </CardTitle>
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
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Top SMS templates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.topTemplates.sms.map((t, i) => (
                      <div key={t.templateId} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground w-5">{i + 1}.</span>
                          <div>
                            <p className="text-sm font-medium">{t.name}</p>
                            <Badge variant="outline" className="text-xs">
                              {t.category}
                            </Badge>
                          </div>
                        </div>
                        <span className="text-sm font-semibold">{t.count} sent</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {data.topTemplates.email.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Top email templates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.topTemplates.email.map((t, i) => (
                      <div key={t.templateId} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground w-5">{i + 1}.</span>
                          <div>
                            <p className="text-sm font-medium">{t.name}</p>
                            <Badge variant="outline" className="text-xs">
                              {t.category}
                            </Badge>
                          </div>
                        </div>
                        <span className="text-sm font-semibold">{t.count} sent</span>
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
