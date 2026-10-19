'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Users,
  Calendar,
  Receipt,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Package,
  ClipboardList,
  UserPlus,
  FilePlus2,
} from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'
import {
  Area,
  AreaChart,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  BAR_RADIUS,
  BAR_RADIUS_HORIZONTAL,
  axisProps,
  barCursor,
  gridProps,
  lineCursor,
  lineProps,
  moneyTick,
  sequentialColor,
  SLICE_GAP,
} from '@/lib/chart-theme'
import { ChartLegend, ChartTooltip } from '@/components/charts/chart-tooltip'
import { displayDate, displayDateShort, monthLabel } from '@/lib/dates'
import { formatCurrency, formatNumber } from '@/lib/i18n/format'
import { statusLabel } from '@/lib/status'
import { toastError } from '@/lib/toast-utils'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { StatusBadge } from '@/components/ui/status-badge'
import { useTrail } from '@/components/ui/trail'
import { formatTime } from '@/lib/appointment-utils'
import { useSession } from 'next-auth/react'
import { holderCan, type Permission } from '@/lib/rbac'
import { DashboardSchedule } from '@/components/schedule/dashboard-schedule'

interface DashboardStats {
  /**
   * False when the caller holds no billing permission. The money figures are
   * then absent from the answer altogether (bug report 12 Oct, finding 41),
   * and their cards and charts are left off the page.
   */
  showsMoney?: boolean
  /** False without `inventory:read`: no stock figures, and no stock card. */
  showsStock?: boolean
  overview: {
    totalPatients: number
    newPatientsThisMonth: number
    patientGrowth: number
    todayAppointments: number
    thisMonthAppointments: number
    appointmentGrowth: number
    pendingAppointments: number
    completedAppointmentsToday: number
    thisMonthRevenue?: number
    todayRevenue?: number
    revenueGrowth?: number
    pendingPayments?: number
    totalRevenue?: number
  }
  charts: {
    last7DaysRevenue: Array<{ date: string; revenue: number }>
    last6MonthsRevenue: Array<{ month: string; revenue: number }>
    appointmentsByStatus: Array<{ status: string; count: number }>
    topProcedures: Array<{ name: string; count: number; revenue?: number }>
  }
  recentActivity: {
    upcomingAppointments: Array<{
      id: string
      patientName: string
      doctorName: string
      /*
       * The clinic's own calendar day and wall-clock time, as every other
       * screen uses. This page used to render `new Date(apt.date)` through
       * date-fns, which is the *browser's* zone — so a clinic whose timezone
       * setting differs from the machine in reception (a locum's laptop, a
       * practice that spans a border, a server-rendered preview) read the right
       * times on the appointment list and the wrong ones on the front page.
       */
      scheduledDate: string
      scheduledTime: string
      date: string
      type: string
      status: string
    }>
    lowStockItems: Array<{
      id: string
      name: string
      currentStock: number
      minimumStock: number
      unit: string
    }>
  }
}

/**
 * The things a front desk does all day.
 *
 * These were at the bottom of the page, below five charts — roughly thirteen
 * hundred pixels of analysis between somebody arriving at the dashboard and the
 * button for the task they arrived to do. Charts are for looking back; this row
 * is for the next thirty seconds, so it goes first.
 *
 * Each names the permission its screen needs, and is offered only to somebody
 * who holds it: a dental assistant was shown "New invoice", which opens a form
 * that the server refuses to save.
 */
const QUICK_ACTIONS: Array<{
  href: string
  icon: typeof Calendar
  title: string
  hint: string
  permission: Permission
}> = [
  {
    href: '/appointments/new',
    icon: Calendar,
    title: 'Book appointment',
    hint: 'Schedule a visit',
    permission: 'appointments:write',
  },
  {
    href: '/patients/new',
    icon: UserPlus,
    title: 'Add patient',
    hint: 'Register someone new',
    permission: 'patients:write',
  },
  {
    href: '/billing/invoices/new',
    icon: FilePlus2,
    title: 'New invoice',
    hint: 'Bill a patient',
    permission: 'billing:write',
  },
  {
    // Replaces the old "View Reports" tile. Reports are a monthly errand and
    // live one click away in the sidebar; the queue is what reception looks at
    // between patients.
    href: '/appointments/queue',
    icon: ClipboardList,
    title: "Today's queue",
    hint: 'Who is waiting',
    permission: 'appointments:read',
  },
]

/**
 * The dashboard's money is in whole rupees: a tile reading "Rs 412,000" is
 * answering "about how much", and the paise are on the invoices it links to.
 */
const WHOLE_RUPEES = { maximumFractionDigits: 0 } as const

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const { toast } = useToast()
  const trail = useTrail('Dashboard')
  const { data: session } = useSession()
  const holder = { role: session?.user?.role, clinicalRole: session?.user?.clinicalRole }
  const actions = QUICK_ACTIONS.filter((action) => holderCan(holder, action.permission))

  const fetchDashboardStats = useCallback(async () => {
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch('/api/dashboard/stats')

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard statistics')
      }

      const data = await response.json()
      setStats(data.data)
    } catch (err) {
      console.error('Error fetching dashboard stats:', err)
      setFailed(true)
      toast(toastError('load the dashboard figures', err))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchDashboardStats()
  }, [fetchDashboardStats])

  const growth = (value: number) => ({
    icon:
      value > 0 ? (
        <ArrowUpRight className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
      ) : value < 0 ? (
        <ArrowDownRight className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
      ) : null,
    color:
      value > 0
        ? 'text-green-600 dark:text-green-400'
        : value < 0
          ? 'text-red-600 dark:text-red-400'
          : 'text-muted-foreground',
  })

  const quickActions = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {actions.map(({ href, icon: Icon, title, hint }) => (
        <Link
          key={href}
          href={href}
          className="group flex items-center gap-4 rounded-xl border border-border/60 bg-card/70 p-4 backdrop-blur-xl transition-all hover:border-primary/30 hover:bg-card hover:shadow-lg hover:shadow-primary/10"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/10">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{title}</p>
            <p className="truncate text-sm text-muted-foreground">{hint}</p>
          </div>
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  )

  const header = (
    <PageHeader
      title="Dashboard"
      description="Here's what's happening at your dental practice today."
    />
  )

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        {/* The actions do not depend on the figures, so they are usable while
            the figures are still arriving. */}
        {quickActions}
        <PageSkeleton variant="dashboard" withHeader={false} />
      </div>
    )
  }

  if (failed || !stats) {
    return (
      <div className="space-y-6">
        {header}
        {/* The dashboard is a summary. Its failure must not strand somebody who
            came here to book an appointment. */}
        {quickActions}
        <Card>
          <LoadFailed
            what="the dashboard figures"
            description="Everything else still works. Try again."
            onRetry={fetchDashboardStats}
          />
        </Card>
      </div>
    )
  }

  const patientTrend = growth(stats.overview.patientGrowth)
  const showsMoney = stats.showsMoney !== false
  const revenueGrowth = stats.overview.revenueGrowth ?? 0
  const revenueTrend = growth(revenueGrowth)
  const showsStock = stats.showsStock !== false
  const lowStock = stats.recentActivity.lowStockItems ?? []
  const upcoming = stats.recentActivity.upcomingAppointments ?? []

  /**
   * Appointment status, largest share first.
   *
   * Sorted here rather than in the chart so the sequential ramp lands the
   * darkest step on the biggest slice — the ramp carries magnitude, and it can
   * only do that if the data arrives in magnitude order.
   */
  const statusSlices = [...(stats.charts.appointmentsByStatus ?? [])]
    .map((item: any) => ({
      name: statusLabel('appointment', item.status),
      value: Number(item.count),
    }))
    .sort((a, b) => b.value - a.value)
    // The shade belongs on the datum, not only on its <Cell>. Recharts builds a
    // pie's legend from the data, so a colour declared only on the cell leaves
    // every legend swatch wearing the Pie's own default fill — seven slices,
    // seven identical dots.
    .map((slice, index, all) => ({ ...slice, fill: sequentialColor(index, all.length) }))
  const statusTotal = statusSlices.reduce((sum, slice) => sum + slice.value, 0) || 1

  /**
   * The month's commonest procedures, biggest first.
   *
   * `revenue` rides along for the tooltip. It is deliberately not a second
   * series: see the note on the chart.
   */
  const topProcedures = (stats.charts.topProcedures ?? []).map((proc: any) => ({
    name: proc.name,
    count: Number(proc.count),
    revenue: proc.revenue === undefined ? undefined : Number(proc.revenue),
  }))

  /**
   * A figure with somewhere to go.
   *
   * Every number on this page used to be a dead end: "Pending Payments
   * Rs 412,000" and no way to reach the invoices it is made of. A total is a
   * question, and the answer is a list.
   */
  const stat = (
    href: string,
    label: string,
    Icon: typeof Users,
    value: string,
    detail: React.ReactNode
  ) => (
    <Link href={href} className="group">
      <Card className="h-full transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tracking-tight">{value}</div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {detail}
          </div>
        </CardContent>
      </Card>
    </Link>
  )

  return (
    <div className="space-y-6">
      {header}

      {/* What you came here to do */}
      {quickActions}

      {showsStock && lowStock.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              {lowStock.length} item{lowStock.length === 1 ? '' : 's'} below minimum stock
            </CardTitle>
            <CardDescription>Order these before they run out mid-procedure.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {lowStock.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Minimum {item.minimumStock} {item.unit}
                  </p>
                </div>
                <span className="shrink-0 font-medium text-red-600 dark:text-red-400">
                  {item.currentStock} {item.unit} left
                </span>
              </div>
            ))}
            <Button asChild variant="outline" className="mt-2 w-full">
              <Link href="/inventory/alerts">Review stock alerts</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className={`grid gap-4 md:grid-cols-2 ${showsMoney ? 'lg:grid-cols-4' : ''}`}>
        {stat(
          '/patients',
          'Total patients',
          Users,
          formatNumber(stats.overview.totalPatients),
          <>
            {patientTrend.icon}
            <span className={patientTrend.color}>
              {stats.overview.patientGrowth > 0 ? '+' : ''}
              {stats.overview.patientGrowth.toFixed(1)}%
            </span>
            <span>from last month</span>
          </>
        )}
        {stat(
          '/appointments',
          "Today's appointments",
          Calendar,
          String(stats.overview.todayAppointments),
          <span>
            {stats.overview.completedAppointmentsToday} completed,{' '}
            {stats.overview.pendingAppointments} pending
          </span>
        )}
        {/* The collections report needs `reports:financial`; without it the
            payments behind the figure are the list to go to (bug report
            16 Oct, finding 11). */}
        {showsMoney &&
          stat(
            holderCan(holder, 'reports:financial') ? '/billing/reports' : '/billing/payments',
            'Collected this month',
            TrendingUp,
            formatCurrency(stats.overview.thisMonthRevenue ?? 0, WHOLE_RUPEES),
            <>
              {revenueTrend.icon}
              <span className={revenueTrend.color}>
                {revenueGrowth > 0 ? '+' : ''}
                {revenueGrowth.toFixed(1)}%
              </span>
              <span>from last month</span>
            </>
          )}
        {showsMoney &&
          stat(
            '/billing/invoices',
            'Outstanding',
            Receipt,
            formatCurrency(stats.overview.pendingPayments ?? 0, WHOLE_RUPEES),
            <span>Still owed on issued invoices</span>
          )}
      </div>

      {/* Who is free for the rest of the day, and how busy each hour was */}
      {holderCan(holder, 'appointments:read') && <DashboardSchedule to={trail.to} />}

      {/* The day itself, ahead of the analysis of it */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className={showsMoney ? 'lg:col-span-3' : 'lg:col-span-7'}>
          <CardHeader>
            <CardTitle>Next appointments</CardTitle>
            <CardDescription>The next five in the book</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {upcoming.length > 0 ? (
                upcoming.map((apt) => (
                  <Link
                    key={apt.id}
                    href={trail.to(`/appointments/${apt.id}`)}
                    className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-foreground/[0.04]"
                  >
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-semibold text-primary">
                      {formatTime(apt.scheduledTime).replace(' ', '')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{apt.patientName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {displayDate(apt.scheduledDate)} • {apt.doctorName}
                      </p>
                    </div>
                    <StatusBadge kind="appointment" status={apt.status} className="shrink-0" />
                  </Link>
                ))
              ) : (
                <div className="py-8 text-center">
                  <p className="text-muted-foreground">Nothing in the book yet.</p>
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <Link href="/appointments/new">Book the first one</Link>
                  </Button>
                </div>
              )}
            </div>
            {upcoming.length > 0 && (
              <Button asChild variant="outline" className="mt-4 w-full">
                <Link href={trail.to('/appointments')}>View all appointments</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Revenue Chart */}
        {showsMoney && (
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle>Collections</CardTitle>
              <CardDescription>Collected per day, net of refunds, last 7 days</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
              {stats.charts.last7DaysRevenue && stats.charts.last7DaysRevenue.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart
                    data={stats.charts.last7DaysRevenue.map((item: any) => ({
                      date: displayDateShort(item.date),
                      revenue: Number(item.revenue),
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    {/* A wash under the line rather than a bare stroke. One
                        series, so no legend — the card title names it. */}
                    <defs>
                      <linearGradient id="collections-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.24} />
                        <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} />
                    <YAxis
                      {...axisProps}
                      width={64}
                      tickFormatter={(value) => moneyTick(Number(value))}
                    />
                    <Tooltip
                      cursor={lineCursor}
                      content={
                        <ChartTooltip format={(value) => formatCurrency(value, WHOLE_RUPEES)} />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Collected"
                      stroke="hsl(var(--chart-1))"
                      fill="url(#collections-fill)"
                      {...lineProps}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-8 text-center text-muted-foreground">Nothing collected yet</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Everything below here is for looking back, and is labelled as such */}
      <div className="pt-2">
        <h2 className="text-lg font-semibold tracking-tight">Analytics</h2>
        <p className="text-sm text-muted-foreground">How the practice has been trending.</p>
      </div>

      <div className={`grid gap-4 ${showsMoney ? 'md:grid-cols-2' : ''}`}>
        <Card>
          <CardHeader>
            <CardTitle>Appointments by status</CardTitle>
            <CardDescription>This month&apos;s appointment distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.charts.appointmentsByStatus && stats.charts.appointmentsByStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  {/*
                    A doughnut shaded by size, not six hues by position.

                    Appointment status has eight possible values, and in a pie
                    every slice can touch every other. No ordering of six
                    categorical hues clears the colour-vision separation floor
                    across all those pairs — measured worst case ΔE 3.2 for a
                    protanope, which is indistinguishable. One hue ordered
                    light-to-dark by share has no such problem, and it answers
                    the question the chart is actually asked: which status is
                    most of the month?
                  */}
                  <Pie
                    data={statusSlices}
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={92}
                    paddingAngle={1}
                    dataKey="value"
                    nameKey="name"
                  >
                    {statusSlices.map((slice) => (
                      <Cell key={slice.name} fill={slice.fill} {...SLICE_GAP} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={
                      <ChartTooltip
                        format={(value) =>
                          `${formatNumber(value)} (${Math.round((value / statusTotal) * 100)}%)`
                        }
                      />
                    }
                  />
                  <Legend content={<ChartLegend />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-muted-foreground">
                No appointment data available
              </p>
            )}
          </CardContent>
        </Card>

        {/* Monthly Revenue Trend */}
        {showsMoney && (
          <Card>
            <CardHeader>
              <CardTitle>Monthly collections</CardTitle>
              <CardDescription>Collected per month, net of refunds, last 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.charts.last6MonthsRevenue && stats.charts.last6MonthsRevenue.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={stats.charts.last6MonthsRevenue.map((item: any) => ({
                      // `2026-10` as `Oct 26`. The API returns the sort key;
                      // the axis should show something a person reads.
                      month: monthLabel(String(item.month)),
                      revenue: Number(item.revenue),
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="month" {...axisProps} />
                    <YAxis
                      {...axisProps}
                      width={64}
                      tickFormatter={(value) => moneyTick(Number(value))}
                    />
                    <Tooltip
                      cursor={barCursor}
                      content={
                        <ChartTooltip format={(value) => formatCurrency(value, WHOLE_RUPEES)} />
                      }
                    />
                    {/* One series: the title says "Monthly collections", so a
                        legend repeating "Collected" is a box of nothing. */}
                    <Bar
                      dataKey="revenue"
                      fill="hsl(var(--chart-1))"
                      name="Collected"
                      radius={BAR_RADIUS}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-8 text-center text-muted-foreground">Nothing collected yet</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top procedures</CardTitle>
          <CardDescription>Most common procedures this month</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.charts.topProcedures && stats.charts.topProcedures.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(180, topProcedures.length * 44)}>
              {/*
                One axis, and it counts procedures.

                This was two: "Count" on a left scale and "Invoiced" on a right
                one, drawn as neighbouring bars. Two bars of the same height
                meant a number of treatments and a sum of money, and nothing on
                screen said so — the reader compares the heights because that is
                what bars are for, and the comparison was meaningless. The money
                is still here, in the tooltip and on the row, where it is read
                as a figure rather than as a length.

                Horizontal because procedure names are long. The old vertical
                version truncated them at 20 characters.
              */}
              <BarChart
                data={topProcedures}
                layout="vertical"
                margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" allowDecimals={false} {...axisProps} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  {...axisProps}
                  tick={{ ...axisProps.tick, fontSize: 12 }}
                />
                <Tooltip
                  cursor={barCursor}
                  content={
                    <ChartTooltip
                      format={(value, name) =>
                        name === 'Invoiced'
                          ? formatCurrency(value, WHOLE_RUPEES)
                          : formatNumber(value)
                      }
                    />
                  }
                />
                <Bar
                  dataKey="count"
                  name="Treatments"
                  fill="hsl(var(--chart-1))"
                  radius={BAR_RADIUS_HORIZONTAL}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-muted-foreground">No procedure data available</p>
          )}
        </CardContent>
      </Card>

      {/* All items in stock: said once, quietly, rather than as a third of the
          screen given over to good news. */}
      {showsStock && lowStock.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          All inventory items are above their minimum stock level.{' '}
          <Link href="/inventory" className="text-primary hover:underline">
            View inventory
          </Link>
        </p>
      )}
    </div>
  )
}
