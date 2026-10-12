'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Users,
  Calendar,
  Receipt,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Package,
  ClipboardList,
  UserPlus,
  FilePlus2,
} from 'lucide-react'
import Link from 'next/link'
import {
  LineChart,
  Line,
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
import { CHART_COLORS } from '@/lib/chart-theme'
import { displayDate, displayDateShort } from '@/lib/dates'
import { formatTime } from '@/lib/appointment-utils'

interface DashboardStats {
  overview: {
    totalPatients: number
    newPatientsThisMonth: number
    patientGrowth: number
    todayAppointments: number
    thisMonthAppointments: number
    appointmentGrowth: number
    pendingAppointments: number
    completedAppointmentsToday: number
    thisMonthRevenue: number
    todayRevenue: number
    revenueGrowth: number
    pendingPayments: number
    totalRevenue: number
  }
  charts: {
    last7DaysRevenue: Array<{ date: string; revenue: number }>
    last6MonthsRevenue: Array<{ month: string; revenue: number }>
    appointmentsByStatus: Array<{ status: string; count: number }>
    topProcedures: Array<{ name: string; count: number; revenue: number }>
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
 */
const QUICK_ACTIONS = [
  {
    href: '/appointments/new',
    icon: Calendar,
    title: 'Book appointment',
    hint: 'Schedule a visit',
  },
  { href: '/patients/new', icon: UserPlus, title: 'Add patient', hint: 'Register someone new' },
  { href: '/billing/invoices/new', icon: FilePlus2, title: 'New invoice', hint: 'Bill a patient' },
  {
    // Replaces the old "View Reports" tile. Reports are a monthly errand and
    // live one click away in the sidebar; the queue is what reception looks at
    // between patients.
    href: '/appointments/queue',
    icon: ClipboardList,
    title: "Today's queue",
    hint: 'Who is waiting',
  },
]

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDashboardStats()
  }, [])

  const fetchDashboardStats = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/dashboard/stats')

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard statistics')
      }

      const data = await response.json()
      setStats(data.data)
    } catch (err: any) {
      console.error('Error fetching dashboard stats:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 0,
    }).format(amount)
  }

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
      {QUICK_ACTIONS.map(({ href, icon: Icon, title, hint }) => (
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-muted-foreground">Loading your practice data...</p>
        </div>
        {/* The actions do not depend on the figures, so they are usable while
            the figures are still arriving. */}
        {quickActions}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="mb-2 h-8 w-16 animate-pulse rounded bg-muted" />
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-muted-foreground">
            The figures could not be loaded. Everything else still works.
          </p>
        </div>
        {/* The dashboard is a summary. Its failure must not strand somebody who
            came here to book an appointment. */}
        {quickActions}
        <Card className="border-red-200 dark:border-red-800/60">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertCircle className="h-5 w-5" />
              <p>{error || 'An error occurred'}</p>
            </div>
            <Button onClick={fetchDashboardStats} className="mt-4">
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const patientTrend = growth(stats.overview.patientGrowth)
  const revenueTrend = growth(stats.overview.revenueGrowth)
  const lowStock = stats.recentActivity.lowStockItems ?? []
  const upcoming = stats.recentActivity.upcomingAppointments ?? []

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
      {/* Welcome message */}
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="text-muted-foreground">
          Here&apos;s what&apos;s happening at your dental practice today.
        </p>
      </div>

      {/* What you came here to do */}
      {quickActions}

      {lowStock.length > 0 && (
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stat(
          '/patients',
          'Total Patients',
          Users,
          stats.overview.totalPatients.toLocaleString(),
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
          "Today's Appointments",
          Calendar,
          String(stats.overview.todayAppointments),
          <span>
            {stats.overview.completedAppointmentsToday} completed,{' '}
            {stats.overview.pendingAppointments} pending
          </span>
        )}
        {stat(
          '/billing/reports',
          'This Month Revenue',
          TrendingUp,
          formatCurrency(stats.overview.thisMonthRevenue),
          <>
            {revenueTrend.icon}
            <span className={revenueTrend.color}>
              {stats.overview.revenueGrowth > 0 ? '+' : ''}
              {stats.overview.revenueGrowth.toFixed(1)}%
            </span>
            <span>from last month</span>
          </>
        )}
        {stat(
          '/billing/invoices',
          'Pending Payments',
          Receipt,
          formatCurrency(stats.overview.pendingPayments),
          <span>Outstanding receivables</span>
        )}
      </div>

      {/* The day itself, ahead of the analysis of it */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-3">
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
                    href={`/appointments/${apt.id}`}
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
                <Link href="/appointments">View all appointments</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Revenue Chart */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Revenue Overview</CardTitle>
            <CardDescription>Last 7 days revenue trend</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            {stats.charts.last7DaysRevenue && stats.charts.last7DaysRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={stats.charts.last7DaysRevenue.map((item: any) => ({
                    date: displayDateShort(item.date),
                    revenue: Number(item.revenue),
                  }))}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => (typeof value === 'number' ? formatCurrency(value) : '')}
                    labelStyle={{ color: 'inherit' }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    activeDot={{ r: 8 }}
                    name="Revenue"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-muted-foreground">No revenue data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Everything below here is for looking back, and is labelled as such */}
      <div className="pt-2">
        <h2 className="text-lg font-semibold tracking-tight">Analytics</h2>
        <p className="text-sm text-muted-foreground">How the practice has been trending.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Appointments by Status</CardTitle>
            <CardDescription>This month&apos;s appointment distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.charts.appointmentsByStatus && stats.charts.appointmentsByStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={stats.charts.appointmentsByStatus.map((item: any) => ({
                      name: item.status,
                      value: item.count,
                    }))}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name}: ${percent ? (percent * 100).toFixed(0) : 0}%`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {stats.charts.appointmentsByStatus.map((_: unknown, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
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
        <Card>
          <CardHeader>
            <CardTitle>Monthly Revenue Trend</CardTitle>
            <CardDescription>Last 6 months revenue comparison</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.charts.last6MonthsRevenue && stats.charts.last6MonthsRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={stats.charts.last6MonthsRevenue.map((item: any) => ({
                    month: item.month,
                    revenue: Number(item.revenue),
                  }))}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => (typeof value === 'number' ? formatCurrency(value) : '')}
                  />
                  <Legend />
                  <Bar
                    dataKey="revenue"
                    fill="hsl(var(--primary))"
                    name="Revenue"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-muted-foreground">No revenue data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top Procedures</CardTitle>
          <CardDescription>Most common procedures this month</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.charts.topProcedures && stats.charts.topProcedures.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={stats.charts.topProcedures.map((proc: any) => ({
                  name: proc.name.length > 20 ? proc.name.substring(0, 20) + '...' : proc.name,
                  count: Number(proc.count),
                  revenue: Number(proc.revenue),
                }))}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis yAxisId="left" orientation="left" stroke="hsl(var(--chart-1))" />
                <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--chart-2))" />
                <Tooltip
                  formatter={(value, _name, item) => {
                    if (typeof value !== 'number') return ''
                    // Match on dataKey, not name: the <Bar> sets a display
                    // name ("Revenue (Rs)"), and that is what recharts passes
                    // as `name`, so comparing it to 'revenue' never matched.
                    if (item?.dataKey === 'revenue') return formatCurrency(value)
                    return value
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="count"
                  fill="hsl(var(--chart-1))"
                  name="Count"
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="revenue"
                  fill="hsl(var(--chart-2))"
                  name="Revenue (Rs)"
                  radius={[6, 6, 0, 0]}
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
      {lowStock.length === 0 && (
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
