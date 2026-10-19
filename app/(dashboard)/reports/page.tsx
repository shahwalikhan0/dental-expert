'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { IconTooltip } from '@/components/ui/icon-action'
import {
  Download,
  TrendingUp,
  TrendingDown,
  Users,
  Activity,
  DollarSign,
  Calendar,
  Clock,
  UserCheck,
  FileText,
  Stethoscope,
  RefreshCw,
} from 'lucide-react'
import {
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
  ComposedChart,
} from 'recharts'
import {
  BAR_RADIUS,
  axisProps,
  barCursor,
  gridProps,
  lineProps,
  moneyTick,
  seriesColor,
  sequentialColor,
  SLICE_GAP,
} from '@/lib/chart-theme'
import { ChartLegend, ChartTooltip } from '@/components/charts/chart-tooltip'
import { humanise } from '@/lib/labels'
import { BarList } from '@/components/charts/bar-list'

import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { formatCurrency, formatNumber } from '@/lib/i18n/format'
import { toastError } from '@/lib/toast-utils'

/**
 * The totals tiles and the chart tooltips read in whole rupees, as they always
 * have on this screen; a figure in a list (a payment method, a dentist's
 * invoiced total) keeps the standard two decimals.
 */
const WHOLE_RUPEES = { maximumFractionDigits: 0 }

/*
  The eight hardcoded hex values that used to live here were the Recharts
  documentation palette — `#8884D8`, `#0088FE`, `#00C49F` and friends. They are
  what made these charts look like a tutorial, and because this screen declared
  its own set it never matched the dashboard, which read the theme. The palette
  now comes from lib/chart-theme.ts for both.
*/

// Date range presets
const dateRangePresets = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This week', value: 'this_week' },
  { label: 'Last week', value: 'last_week' },
  { label: 'This month', value: 'this_month' },
  { label: 'Last month', value: 'last_month' },
  { label: 'This quarter', value: 'this_quarter' },
  { label: 'Last quarter', value: 'last_quarter' },
  { label: 'This year', value: 'this_year' },
  { label: 'Last year', value: 'last_year' },
  { label: 'Custom range', value: 'custom' },
]

interface PatientAnalytics {
  newPatients: number
  returningPatients: number
  totalPatients: number
  retentionRate: number
  demographics: {
    male: number
    female: number
    other: number
  }
  ageGroups: {
    label: string
    count: number
  }[]
  acquisitionSources: {
    source: string
    count: number
    percentage: number
  }[]
}

interface ClinicalAnalytics {
  totalTreatments: number
  completedTreatments: number
  inProgressTreatments: number
  completionRate: number
  avgTreatmentDuration: number
  commonProcedures: {
    name: string
    code: string
    count: number
    successRate: number
  }[]
  proceduresByCategory: {
    category: string
    count: number
    percentage: number
  }[]
}

/**
 * Billed, Collected and Outstanding as every money screen defines them
 * (lib/invoice-figures.ts). There is no bare "Revenue" any more: this tab
 * called billed invoices revenue while the dashboard called collected cash
 * revenue, and the two never agreed (bug report item 6).
 */
interface FinancialAnalytics {
  totalBilled: number
  totalCollected: number
  totalExpenses: number
  profit: number
  profitMargin: number
  avgBillValue: number
  collectionEfficiency: number
  invoiceCount: number
  revenueByMonth: {
    month: string
    billed: number
    collected: number
    expenses: number
    profit: number
  }[]
  paymentMethodBreakdown: {
    method: string
    amount: number
    percentage: number
  }[]
  outstandingAmount: number
}

interface OperationalAnalytics {
  totalAppointments: number
  completedAppointments: number
  cancelledAppointments: number
  noShowCount: number
  noShowRate: number
  appointmentUtilization: number
  avgWaitTime: number
  staffProductivity: {
    staffId: string
    name: string
    role: string
    appointmentsHandled: number
    treatmentsCompleted: number
    /** Invoiced for their treatments; absent for a role without the financial reports. */
    invoiced?: number
  }[]
  inventoryTurnover: number
  lowStockItems: number
}

export default function ReportsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [datePreset, setDatePreset] = useState('this_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeTab, setActiveTab] = useState('patient')
  // The financial tab and the invoiced column need `reports:financial`, as the
  // server does; the operational reports are open to roles that hold no money.
  const seesMoney = useCan('reports:financial') === true
  // Every export is refused without `reports:export` (bug report 16 Oct,
  // finding 9), so the menu is not offered.
  const canExport = useCan('reports:export') === true

  // Analytics data state
  const [patientAnalytics, setPatientAnalytics] = useState<PatientAnalytics | null>(null)
  const [clinicalAnalytics, setClinicalAnalytics] = useState<ClinicalAnalytics | null>(null)
  const [financialAnalytics, setFinancialAnalytics] = useState<FinancialAnalytics | null>(null)
  const [operationalAnalytics, setOperationalAnalytics] = useState<OperationalAnalytics | null>(
    null
  )

  // Nothing has arrived yet: the whole page is a skeleton, not four tabs of
  // grey tiles under a header with nothing to say.
  const [loadedOnce, setLoadedOnce] = useState(false)
  // The fetch failed, which is not the same as the period having no data.
  const [failed, setFailed] = useState(false)

  /**
   * Which request is the current one. Switching tab or period while a report
   * is still on its way must not let the older answer land last.
   */
  const latestRequest = useRef(0)

  const fetchAnalytics = async (type: string) => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const params = new URLSearchParams({ type })

      if (dateFrom && dateTo) {
        params.append('dateFrom', dateFrom)
        params.append('dateTo', dateTo)
      } else {
        params.append('preset', datePreset)
      }

      const response = await fetch(`/api/reports/analytics?${params}`)
      if (!response.ok) throw new Error('Failed to fetch analytics')
      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return

      switch (type) {
        case 'patient':
          setPatientAnalytics(data)
          break
        case 'clinical':
          setClinicalAnalytics(data)
          break
        case 'financial':
          setFinancialAnalytics(data)
          break
        case 'operational':
          setOperationalAnalytics(data)
          break
      }
    } catch (error) {
      console.error(`Error fetching ${type} analytics:`, error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) {
        setLoading(false)
        setLoadedOnce(true)
      }
    }
  }

  useEffect(() => {
    fetchAnalytics(activeTab)
    // The tab and the period are the whole question; `fetchAnalytics` reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, datePreset, dateFrom, dateTo])

  // `html` is a print view: there is no PDF library here, so it is called
  // what it is, and the browser's Print → Save as PDF makes the PDF.
  const handleExport = async (format: 'html' | 'excel') => {
    try {
      const params = new URLSearchParams({
        type: activeTab,
        format,
      })

      if (dateFrom && dateTo) {
        params.append('dateFrom', dateFrom)
        params.append('dateTo', dateTo)
      } else {
        params.append('preset', datePreset)
      }

      const response = await fetch(`/api/reports/export?${params}`)
      if (!response.ok) {
        const result = await response.json().catch(() => null)
        throw new Error(result?.error || 'The report could not be exported. Try again in a moment.')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeTab}_analytics_${Date.now()}.${format === 'html' ? 'html' : 'xlsx'}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Export error:', error)
      toast(toastError('export the report', error))
    }
  }

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`
  }

  const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

  /**
   * Gender, largest first, as the shared ranked list wants it.
   *
   * "Other" covers every value that is not male or female *and* the patients
   * whose gender nobody recorded — `Patient.gender` is nullable, and a clinic
   * that never asks is the normal case rather than an error.
   */
  const genderRows = (() => {
    const total = patientAnalytics?.totalPatients ?? 0
    const counts = [
      { key: 'male', label: 'Male', value: patientAnalytics?.demographics.male ?? 0 },
      { key: 'female', label: 'Female', value: patientAnalytics?.demographics.female ?? 0 },
      {
        key: 'other',
        label: 'Other or not recorded',
        value: patientAnalytics?.demographics.other ?? 0,
      },
    ]
    return counts
      .sort((a, b) => b.value - a.value)
      .map((row) => ({
        ...row,
        display: formatNumber(row.value),
        detail: formatPercentage(share(row.value, total)),
      }))
  })()

  /** Procedure categories, biggest share first — see the note on the chart. */
  const categorySlices = [...(clinicalAnalytics?.proceduresByCategory ?? [])]
    // `PROSTHODONTIC` is a database value, not a label for a legend.
    .map((cat) => ({ name: humanise(cat.category), value: cat.count }))
    .sort((a, b) => b.value - a.value)
    // The shade has to sit on the datum: Recharts builds a pie's legend from
    // the data, so a fill declared only on the <Cell> leaves every legend
    // swatch in the Pie's default colour.
    .map((slice, index, all) => ({ ...slice, fill: sequentialColor(index, all.length) }))
  const categoryTotal = categorySlices.reduce((sum, slice) => sum + slice.value, 0)

  if (!loadedOnce) return <PageSkeleton variant="dashboard" />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & analytics dashboard"
        description="Comprehensive analytics and insights for your dental practice"
        actions={
          <>
            <Select
              value={datePreset}
              onValueChange={(v) => {
                setDatePreset(v)
                if (v !== 'custom') {
                  setDateFrom('')
                  setDateTo('')
                }
              }}
            >
              <SelectTrigger className="w-[160px]" aria-label="Report period">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {dateRangePresets.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {datePreset === 'custom' && (
              <>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-[140px]"
                  aria-label="Period from"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-[140px]"
                  aria-label="Period to"
                />
              </>
            )}
            {/* Held at no value, so it stays an "Export" button and choosing the
                same format twice exports twice. */}
            {canExport && (
              <Select value="" onValueChange={(value) => handleExport(value as 'html' | 'excel')}>
                <SelectTrigger className="w-[140px]" aria-label="Export">
                  <Download className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Export" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="html">Print view (HTML)</SelectItem>
                  <SelectItem value="excel">Export as Excel</SelectItem>
                </SelectContent>
              </Select>
            )}
            <IconTooltip label="Refresh">
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh"
                onClick={() => fetchAnalytics(activeTab)}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </IconTooltip>
          </>
        }
      />

      {/* Analytics Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="w-full">
          <TabsTrigger value="patient" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Patient analytics
          </TabsTrigger>
          <TabsTrigger value="clinical" className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            Clinical analytics
          </TabsTrigger>
          {seesMoney && (
            <TabsTrigger value="financial" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Financial analytics
            </TabsTrigger>
          )}
          <TabsTrigger value="operational" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Operational analytics
          </TabsTrigger>
        </TabsList>

        {/* A failed fetch is said as such, with a retry, rather than as a tab
            of zeros that reads like a quiet month. */}
        {failed ? (
          <LoadFailed what="this report" onRetry={() => fetchAnalytics(activeTab)} />
        ) : (
          <>
            {/* Patient Analytics Tab */}
            <TabsContent value="patient" className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">New patients</CardTitle>
                    <UserCheck className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold">
                          {patientAnalytics?.newPatients || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {patientAnalytics
                            ? formatPercentage(
                                (patientAnalytics.newPatients / patientAnalytics.totalPatients) *
                                  100
                              )
                            : '0%'}{' '}
                          of total
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Returning patients</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold">
                          {patientAnalytics?.returningPatients || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {patientAnalytics
                            ? formatPercentage(
                                (patientAnalytics.returningPatients /
                                  patientAnalytics.totalPatients) *
                                  100
                              )
                            : '0%'}{' '}
                          of total
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total patients</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-2xl font-bold">
                        {patientAnalytics?.totalPatients || 0}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Retention rate</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          {formatPercentage(patientAnalytics?.retentionRate || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">Patients with repeat visits</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Demographics Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Gender distribution</CardTitle>
                    <CardDescription>Patient demographics breakdown</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {/*
                      Was three hand-rolled bars in a fixed 128px track, one
                      `bg-blue-600` and one `bg-pink-600` — colours neither
                      theme defines, saying something about the patients that
                      the clinic did not. One component now, the same one the
                      acquisition and payment breakdowns use, in the theme's own
                      ink.
                    */}
                    {loading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : (
                      <BarList rows={genderRows} emptyMessage="No patients in this period" />
                    )}
                  </CardContent>
                </Card>

                {/* Patient Acquisition Sources */}
                <Card>
                  <CardHeader>
                    <CardTitle>Acquisition sources</CardTitle>
                    <CardDescription>How patients found your practice</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : (
                      <BarList
                        rows={(patientAnalytics?.acquisitionSources ?? []).map((source) => ({
                          key: source.source || 'unknown',
                          label: source.source || 'Unknown',
                          value: source.count,
                          display: formatNumber(source.count),
                          detail: formatPercentage(source.percentage),
                        }))}
                        emptyMessage="Nobody has been asked how they found the practice"
                      />
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Age Groups */}
              <Card>
                <CardHeader>
                  <CardTitle>Age distribution</CardTitle>
                  <CardDescription>Patients by age group</CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-64 w-full" />
                  ) : patientAnalytics?.ageGroups && patientAnalytics.ageGroups.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      {/*
                        One colour, not one per bar.

                        Every bar used to be a different hue, which says the age
                        bands are different *kinds* of thing. They are one
                        quantity cut into ordered buckets, so colour has no work
                        to do here and the x axis already labels them.
                      */}
                      <BarChart
                        data={patientAnalytics.ageGroups}
                        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="label" {...axisProps} />
                        <YAxis allowDecimals={false} width={40} {...axisProps} />
                        <Tooltip
                          cursor={barCursor}
                          content={<ChartTooltip format={(value) => formatNumber(value)} />}
                        />
                        <Bar
                          dataKey="count"
                          fill="hsl(var(--chart-1))"
                          name="Patients"
                          radius={BAR_RADIUS}
                          maxBarSize={56}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">No age data available</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Clinical Analytics Tab */}
            <TabsContent value="clinical" className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total treatments</CardTitle>
                    <Stethoscope className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-2xl font-bold">
                        {clinicalAnalytics?.totalTreatments || 0}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Completed</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          {clinicalAnalytics?.completedTreatments || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatPercentage(clinicalAnalytics?.completionRate || 0)} completion rate
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">In progress</CardTitle>
                    <Activity className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                        {clinicalAnalytics?.inProgressTreatments || 0}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg. duration</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold">
                          {clinicalAnalytics?.avgTreatmentDuration || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">minutes per treatment</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Most Common Procedures */}
                <Card>
                  <CardHeader>
                    <CardTitle>Most common procedures</CardTitle>
                    <CardDescription>Top procedures by frequency</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {loading ? (
                      <>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </>
                    ) : clinicalAnalytics?.commonProcedures.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No procedure data available
                      </p>
                    ) : (
                      clinicalAnalytics?.commonProcedures.map((proc, index) => (
                        <div key={proc.code} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                              {index + 1}
                            </div>
                            <div>
                              <div className="font-medium">{proc.name}</div>
                              <div className="text-xs text-muted-foreground">{proc.code}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold">{proc.count}</div>
                            <div className="text-xs text-green-600 dark:text-green-400">
                              {formatPercentage(proc.successRate)} success
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                {/* Procedures by Category */}
                <Card>
                  <CardHeader>
                    <CardTitle>Procedures by category</CardTitle>
                    <CardDescription>Treatment distribution by type</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-64 w-full" />
                    ) : clinicalAnalytics?.proceduresByCategory &&
                      clinicalAnalytics.proceduresByCategory.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        {/*
                          Shaded by share rather than painted by position, and
                          sorted so the darkest step is the biggest category.
                          The label lines that used to radiate out of it are
                          gone — the legend below names every slice, and the
                          leader lines collided as soon as two categories were
                          close in size.
                        */}
                        <PieChart>
                          <Pie
                            data={categorySlices}
                            cx="50%"
                            cy="50%"
                            innerRadius={56}
                            outerRadius={92}
                            paddingAngle={1}
                            dataKey="value"
                            nameKey="name"
                          >
                            {categorySlices.map((slice) => (
                              <Cell key={slice.name} fill={slice.fill} {...SLICE_GAP} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={
                              <ChartTooltip
                                format={(value) =>
                                  `${formatNumber(value)} (${formatPercentage(share(value, categoryTotal))})`
                                }
                              />
                            }
                          />
                          <Legend content={<ChartLegend />} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No category data available
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Financial Analytics Tab */}
            <TabsContent value="financial" className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Billed</CardTitle>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold">
                          {formatCurrency(financialAnalytics?.totalBilled || 0, WHOLE_RUPEES)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {financialAnalytics?.invoiceCount || 0} invoices issued
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Collected</CardTitle>
                    <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          {formatCurrency(financialAnalytics?.totalCollected || 0, WHOLE_RUPEES)}
                        </div>
                        <p className="text-xs text-muted-foreground">Net of refunds</p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Expenses</CardTitle>
                    <DollarSign className="h-4 w-4 text-red-600 dark:text-red-400" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {formatCurrency(financialAnalytics?.totalExpenses || 0, WHOLE_RUPEES)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Profit margin</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold">
                          {formatPercentage(financialAnalytics?.profitMargin || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(financialAnalytics?.profit || 0, WHOLE_RUPEES)} collected
                          less expenses
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg. bill value</CardTitle>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-2xl font-bold">
                        {formatCurrency(financialAnalytics?.avgBillValue || 0, WHOLE_RUPEES)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Collection rate</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          {formatPercentage(financialAnalytics?.collectionEfficiency || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Collected ÷ billed. Outstanding now:{' '}
                          {formatCurrency(financialAnalytics?.outstandingAmount || 0, WHOLE_RUPEES)}
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Payment Method Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle>Payment method breakdown</CardTitle>
                  <CardDescription>Collected by payment method, net of refunds</CardDescription>
                </CardHeader>
                <CardContent>
                  {/*
                    The pie that used to sit to the left of this list is gone.

                    It carried no information the list did not: the same
                    methods, the same amounts, the same percentages, read off a
                    legend instead of a label. Two encodings of one small table
                    is not twice as clear — it is one thing to read and one
                    thing to check it against. The list wins because the figures
                    are the point: a clinic reconciling the day wants the
                    amount, not the angle.
                  */}
                  {loading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : (
                    <BarList
                      rows={(financialAnalytics?.paymentMethodBreakdown ?? []).map((method) => ({
                        key: method.method,
                        // `BANK_TRANSFER`, as written in the database, is not a label.
                        label: humanise(method.method),
                        value: method.amount,
                        display: formatCurrency(method.amount, WHOLE_RUPEES),
                        detail: formatPercentage(method.percentage),
                      }))}
                      emptyMessage="Nothing collected in this period"
                    />
                  )}
                </CardContent>
              </Card>

              {/* Revenue Trends */}
              <Card>
                <CardHeader>
                  <CardTitle>Monthly trend</CardTitle>
                  <CardDescription>
                    Billed and collected by month, with expenses and profit (collected less
                    expenses)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-64 w-full" />
                  ) : financialAnalytics?.revenueByMonth &&
                    financialAnalytics.revenueByMonth.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      {/*
                        Four series on one axis, which is legitimate here: all
                        four are money in the same currency, so a bar twice as
                        tall really is twice as much. The profit line stays a
                        line because it is a different kind of fact — a
                        difference rather than a total — and reading it as a
                        fourth bar beside its own inputs invites adding it to
                        them.
                      */}
                      <ComposedChart
                        data={financialAnalytics.revenueByMonth}
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
                        <Legend content={<ChartLegend />} />
                        <Bar
                          dataKey="billed"
                          fill={seriesColor(0)}
                          name="Billed"
                          radius={BAR_RADIUS}
                          maxBarSize={28}
                        />
                        <Bar
                          dataKey="collected"
                          fill={seriesColor(2)}
                          name="Collected"
                          radius={BAR_RADIUS}
                          maxBarSize={28}
                        />
                        <Bar
                          dataKey="expenses"
                          fill={seriesColor(1)}
                          name="Expenses"
                          radius={BAR_RADIUS}
                          maxBarSize={28}
                        />
                        <Line
                          type="monotone"
                          dataKey="profit"
                          stroke={seriesColor(4)}
                          name="Profit"
                          {...lineProps}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      Nothing billed or collected
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Operational Analytics Tab */}
            <TabsContent value="operational" className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total appointments</CardTitle>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-2xl font-bold">
                        {operationalAnalytics?.totalAppointments || 0}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Completed</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          {operationalAnalytics?.completedAppointments || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatPercentage(operationalAnalytics?.appointmentUtilization || 0)}{' '}
                          utilization
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">No-show rate</CardTitle>
                    <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {formatPercentage(operationalAnalytics?.noShowRate || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {operationalAnalytics?.noShowCount || 0} appointments
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg. wait time</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold">
                          {operationalAnalytics?.avgWaitTime || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">minutes</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Staff Productivity */}
              <Card>
                <CardHeader>
                  <CardTitle>Staff productivity</CardTitle>
                  <CardDescription>
                    Appointments seen and treatments completed in the period
                    {seesMoney ? ', and what was invoiced for their treatments' : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {operationalAnalytics?.staffProductivity.map((staff) => (
                        <div
                          key={staff.staffId}
                          className="flex items-center justify-between p-4 border rounded-lg"
                        >
                          <div>
                            <div className="font-medium">{staff.name}</div>
                            <div className="text-sm text-muted-foreground">{staff.role}</div>
                          </div>
                          <div className="flex gap-8 text-center">
                            <div>
                              <div className="text-sm text-muted-foreground">Appointments</div>
                              <div className="text-xl font-bold">{staff.appointmentsHandled}</div>
                            </div>
                            <div>
                              <div className="text-sm text-muted-foreground">
                                Treatments completed
                              </div>
                              <div className="text-xl font-bold">{staff.treatmentsCompleted}</div>
                            </div>
                            {staff.invoiced !== undefined && (
                              <div>
                                <div className="text-sm text-muted-foreground">Invoiced</div>
                                <div className="text-xl font-bold text-green-600 dark:text-green-400">
                                  {formatCurrency(staff.invoiced)}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Inventory Metrics */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Inventory turnover</CardTitle>
                    <CardDescription>How quickly inventory is being used</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-16 w-full" />
                    ) : (
                      <div className="space-y-2">
                        <div className="text-3xl font-bold">
                          {operationalAnalytics?.inventoryTurnover?.toFixed(2) || '0.00'}x
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Average turnover rate per period
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Low stock alert</CardTitle>
                    <CardDescription>Items requiring reorder</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <Skeleton className="h-16 w-full" />
                    ) : (
                      <div className="space-y-2">
                        <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                          {operationalAnalytics?.lowStockItems || 0}
                        </div>
                        <p className="text-sm text-muted-foreground">Items below reorder level</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
