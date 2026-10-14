'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { ClickableRow, GridBody, GridPagination, usePagedRows } from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import {
  Users,
  Stethoscope,
  Calendar,
  AlertCircle,
  CreditCard,
  Banknote,
  FileText,
} from 'lucide-react'
import { dateRangePresets, formatCurrency } from '@/lib/billing-utils'
import { AGEING_BUCKETS, type AgeingBucketKey } from '@/lib/ageing'
import { ExportMenu } from '@/components/ui/export-menu'
import { BLANK, displayDate } from '@/lib/dates'

interface OutstandingInvoice {
  id: string
  invoiceNo: string
  createdAt: string
  dueDate: string | null
  totalAmount: string | number
  balanceAmount: string | number
  status: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
  }
}

const EMPTY_INVOICES: OutstandingInvoice[] = []

type AgingData = Record<AgeingBucketKey, { amount: number; count: number }>

/** Title colour per ageing bucket, in AGEING_BUCKETS order. */
const AGEING_TONES = [
  'text-green-600 dark:text-green-400',
  'text-yellow-600 dark:text-yellow-400',
  'text-orange-600 dark:text-orange-400',
  'text-red-500 dark:text-red-400',
  'text-red-700 dark:text-red-300',
]

interface ProcedureRevenue {
  procedureId: string
  code: string
  name: string
  category: string
  /** Invoiced: line amounts less their share of the discount, before tax. */
  totalRevenue: number
  count: number
  avgRevenue: number
}

interface DoctorRevenue {
  doctorId: string
  name: string
  specialization: string | null
  totalRevenue: number
  treatmentCount: number
  avgPerTreatment: number
  topProcedures: Array<{ name: string; count: number }>
}

export default function FinancialReportsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Financial reports')
  const [loading, setLoading] = useState(true)
  // The report on screen could not be fetched — said in its grid, with a
  // retry, rather than as an empty one.
  const [failed, setFailed] = useState(false)
  const [datePreset, setDatePreset] = useState('this_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeTab, setActiveTab] = useState('outstanding')

  // Report data
  const [outstandingData, setOutstandingData] = useState<{
    invoices: OutstandingInvoice[]
    aging: AgingData
    totals: { totalOutstanding: number; invoiceCount: number }
  } | null>(null)

  const [procedureData, setProcedureData] = useState<{
    byProcedure: ProcedureRevenue[]
    totals: { totalRevenue: number; totalTreatments: number }
  } | null>(null)

  const [doctorData, setDoctorData] = useState<{
    byDoctor: DoctorRevenue[]
    totals: { totalRevenue: number; totalTreatments: number; doctorCount: number }
  } | null>(null)

  const [dailyData, setDailyData] = useState<{
    dailyData: Array<{
      date: string
      cash: number
      card: number
      wallet: number
      bankTransfer: number
      total: number
      count: number
    }>
    totals: { totalCollection: number; totalPayments: number }
  } | null>(null)

  const fetchReport = async (type: string) => {
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

      const response = await fetch(`/api/billing/reports?${params}`)
      if (!response.ok) throw new Error('Failed to fetch report')
      const data = await response.json()

      switch (type) {
        case 'outstanding':
          setOutstandingData(data)
          break
        case 'procedure_revenue':
          setProcedureData(data)
          break
        case 'doctor_revenue':
          setDoctorData(data)
          break
        case 'daily_collection':
          setDailyData(data)
          break
      }
    } catch (error) {
      console.error(`Error fetching ${type} report:`, error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetching on mount and on change is what this effect is for; the state it
    // sets is the answer arriving.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReport(activeTab)
    // The tab and the period are the whole question; `fetchReport` reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, datePreset, dateFrom, dateTo])

  const retry = () => fetchReport(activeTab)

  // Every outstanding invoice comes back at once; paged here.
  const outstandingRows = usePagedRows(outstandingData?.invoices ?? EMPTY_INVOICES)

  /**
   * The rows of whichever report is on screen.
   *
   * This button used to be an `alert('Export functionality coming soon!')` —
   * a control whose only function was to announce that it had none. The export
   * machinery already existed and every other list screen used it.
   */
  const exportRows = (): Record<string, unknown>[] => {
    switch (activeTab) {
      case 'outstanding':
        return (outstandingData?.invoices ?? []).map((invoice) => ({
          Invoice: invoice.invoiceNo,
          Patient: `${invoice.patient.firstName} ${invoice.patient.lastName}`,
          'Patient ID': invoice.patient.patientId,
          Phone: invoice.patient.phone ?? '',
          Raised: displayDate(invoice.createdAt),
          Due: displayDate(invoice.dueDate),
          Total: Number(invoice.totalAmount),
          Outstanding: Number(invoice.balanceAmount),
          Status: invoice.status,
        }))

      case 'procedure_revenue':
        return (procedureData?.byProcedure ?? []).map((row) => ({
          Code: row.code,
          Procedure: row.name,
          Category: row.category,
          'Treatments billed': row.count,
          Invoiced: row.totalRevenue,
          'Average invoiced': row.avgRevenue,
        }))

      case 'doctor_revenue':
        return (doctorData?.byDoctor ?? []).map((row) => ({
          Doctor: row.name,
          Specialisation: row.specialization ?? '',
          'Treatments billed': row.treatmentCount,
          Invoiced: row.totalRevenue,
          'Average invoiced': row.avgPerTreatment,
        }))

      case 'daily_collection':
        return (dailyData?.dailyData ?? []).map((day) => ({
          Date: displayDate(day.date),
          Cash: day.cash,
          Card: day.card,
          'Bank transfer': day.bankTransfer,
          Wallet: day.wallet,
          Payments: day.count,
          Total: day.total,
        }))

      default:
        return []
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial reports"
        description="View detailed financial analytics and reports"
        actions={
          <>
            <Select
              value={datePreset}
              onValueChange={(v) => {
                setDatePreset(v)
                setDateFrom('')
                setDateTo('')
              }}
            >
              <SelectTrigger className="w-[160px]" aria-label="Period">
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
                  aria-label="From"
                  className="w-[140px]"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="To"
                  className="w-[140px]"
                />
              </>
            )}
            <ExportMenu filename={`billing-${activeTab}`} getData={exportRows} />
          </>
        }
      />

      {/* Report Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="outstanding" className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Outstanding
          </TabsTrigger>
          <TabsTrigger value="procedure_revenue" className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            By procedure
          </TabsTrigger>
          <TabsTrigger value="doctor_revenue" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            By doctor
          </TabsTrigger>
          <TabsTrigger value="daily_collection" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Daily collection
          </TabsTrigger>
        </TabsList>

        {/* Outstanding Report */}
        <TabsContent value="outstanding" className="space-y-6">
          {/* Aging Summary */}
          <div className="grid gap-4 md:grid-cols-5">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="pt-6">
                      <Skeleton className="h-8 w-24" />
                    </CardContent>
                  </Card>
                ))
              : outstandingData
                ? // The buckets every ageing screen uses (lib/ageing.ts), counted in
                  // days past each invoice's due date.
                  AGEING_BUCKETS.map((bucket, index) => (
                    <Card key={bucket.key}>
                      <CardHeader className="pb-2">
                        <CardTitle className={`text-sm font-medium ${AGEING_TONES[index]}`}>
                          {bucket.label}
                        </CardTitle>
                        <CardDescription>
                          {bucket.key === 'notDue' ? 'Within its terms' : 'Days overdue'}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {formatCurrency(outstandingData.aging[bucket.key].amount)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {outstandingData.aging[bucket.key].count} invoices
                        </p>
                      </CardContent>
                    </Card>
                  ))
                : null}
          </div>

          {/* Outstanding Invoices Table */}
          <Card>
            <CardHeader>
              <CardTitle>Outstanding invoices</CardTitle>
              <CardDescription>
                Total: {formatCurrency(outstandingData?.totals.totalOutstanding || 0)} from{' '}
                {outstandingData?.totals.invoiceCount || 0} invoices
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Invoice date</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <GridBody
                  columns={6}
                  skeletonRows={5}
                  loading={loading}
                  failed={failed}
                  onRetry={retry}
                  empty={outstandingRows.total === 0}
                  emptyIcon={FileText}
                  emptyTitle="No outstanding invoices"
                  emptyDescription="Every issued invoice has been paid."
                >
                  {outstandingRows.rows.map((invoice) => (
                    <ClickableRow
                      key={invoice.id}
                      href={trail.to(`/billing/invoices/${invoice.id}`)}
                      label={`Open invoice ${invoice.invoiceNo}`}
                    >
                      <TableCell className="font-medium">{invoice.invoiceNo}</TableCell>
                      <TableCell>
                        {invoice.patient.firstName} {invoice.patient.lastName}
                      </TableCell>
                      <TableCell>{displayDate(invoice.createdAt)}</TableCell>
                      <TableCell>
                        {invoice.dueDate ? displayDate(invoice.dueDate) : BLANK}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(invoice.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                        {formatCurrency(invoice.balanceAmount)}
                      </TableCell>
                    </ClickableRow>
                  ))}
                </GridBody>
              </Table>

              <GridPagination
                page={outstandingRows.page}
                pageSize={outstandingRows.pageSize}
                total={outstandingRows.total}
                noun="invoices"
                onPageChange={outstandingRows.setPage}
                onPageSizeChange={outstandingRows.setPageSize}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Procedure Revenue Report */}
        <TabsContent value="procedure_revenue" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total invoiced</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">
                    {formatCurrency(procedureData?.totals.totalRevenue || 0)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Treatments billed</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">
                    {procedureData?.totals.totalTreatments || 0}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Invoiced by procedure</CardTitle>
              <CardDescription>
                Invoice lines less their share of any discount, before tax, on invoices issued in
                the period. Not cash collected — see Daily collection.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Procedure</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-center">Billed</TableHead>
                    <TableHead className="text-right">Avg. invoiced</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                  </TableRow>
                </TableHeader>
                <GridBody
                  columns={5}
                  skeletonRows={5}
                  loading={loading}
                  failed={failed}
                  onRetry={retry}
                  empty={(procedureData?.byProcedure.length ?? 0) === 0}
                  emptyIcon={Stethoscope}
                  emptyTitle="No procedures invoiced"
                  emptyDescription="Nothing was invoiced for a procedure in this period."
                >
                  {procedureData?.byProcedure.map((proc) => (
                    <TableRow key={proc.procedureId}>
                      <TableCell>
                        <div className="font-medium">{proc.name}</div>
                        <div className="text-sm text-muted-foreground">{proc.code}</div>
                      </TableCell>
                      <TableCell>{proc.category}</TableCell>
                      <TableCell className="text-center">{proc.count}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(proc.avgRevenue)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(proc.totalRevenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </GridBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Doctor Revenue Report */}
        <TabsContent value="doctor_revenue" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total invoiced</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">
                    {formatCurrency(doctorData?.totals.totalRevenue || 0)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Treatments billed</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">
                    {doctorData?.totals.totalTreatments || 0}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Active doctors</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">{doctorData?.totals.doctorCount || 0}</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Invoiced by doctor</CardTitle>
              <CardDescription>
                The same invoice lines, by the doctor on the treatment each one bills.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Doctor</TableHead>
                    <TableHead className="text-center">Treatments billed</TableHead>
                    <TableHead className="text-right">Avg. invoiced</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                  </TableRow>
                </TableHeader>
                <GridBody
                  columns={4}
                  skeletonRows={3}
                  loading={loading}
                  failed={failed}
                  onRetry={retry}
                  empty={(doctorData?.byDoctor.length ?? 0) === 0}
                  emptyIcon={Users}
                  emptyTitle="No doctors invoiced"
                  emptyDescription="No treatment by a doctor was invoiced in this period."
                >
                  {doctorData?.byDoctor.map((doc) => (
                    <TableRow key={doc.doctorId}>
                      <TableCell>
                        <div className="font-medium">Dr. {doc.name}</div>
                        {doc.specialization && (
                          <div className="text-sm text-muted-foreground">{doc.specialization}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{doc.treatmentCount}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(doc.avgPerTreatment)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(doc.totalRevenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </GridBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily Collection Report */}
        <TabsContent value="daily_collection" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total collection</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(dailyData?.totals.totalCollection || 0)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total payments</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">{dailyData?.totals.totalPayments || 0}</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Daily collection breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Banknote className="h-4 w-4" />
                        Cash
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <CreditCard className="h-4 w-4" />
                        Card
                      </div>
                    </TableHead>
                    {/*
                      Was "UPI", which is India's rail — the column was always
                      zero. The wallet total was already being computed by the
                      report and thrown away for want of a column to put it in.
                    */}
                    <TableHead className="text-right">Mobile wallet</TableHead>
                    <TableHead className="text-right">Bank transfer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-center">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <GridBody
                  columns={7}
                  skeletonRows={5}
                  loading={loading}
                  failed={failed}
                  onRetry={retry}
                  empty={(dailyData?.dailyData.length ?? 0) === 0}
                  emptyIcon={Calendar}
                  emptyTitle="No payments collected"
                  emptyDescription="No payment was taken in this period."
                >
                  {dailyData?.dailyData.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell className="font-medium">{displayDate(day.date)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(day.cash)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(day.card)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(day.wallet)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(day.bankTransfer)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                        {formatCurrency(day.total)}
                      </TableCell>
                      <TableCell className="text-center">{day.count}</TableCell>
                    </TableRow>
                  ))}
                </GridBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
