'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/hooks/use-toast'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { ClickableRow } from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import {
  BarChart3,
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Stethoscope,
  Calendar,
  Clock,
  AlertCircle,
  IndianRupee,
  CreditCard,
  Banknote,
} from 'lucide-react'
import { dateRangePresets, formatCurrency, formatDate } from '@/lib/billing-utils'
import { ExportMenu } from '@/components/ui/export-menu'
import { displayDate } from '@/lib/dates'

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

interface AgingData {
  current: { amount: number; count: number }
  days1_30: { amount: number; count: number }
  days31_60: { amount: number; count: number }
  days61_90: { amount: number; count: number }
  over90: { amount: number; count: number }
}

interface ProcedureRevenue {
  procedureId: string
  code: string
  name: string
  category: string
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
  const trail = useTrail('Billing Reports')
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
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
      toast({
        variant: 'destructive',
        title: 'Could not load the report',
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReport(activeTab)
  }, [activeTab, datePreset, dateFrom, dateTo])

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
          Treatments: row.count,
          Revenue: row.totalRevenue,
          'Average per treatment': row.avgRevenue,
        }))

      case 'doctor_revenue':
        return (doctorData?.byDoctor ?? []).map((row) => ({
          Doctor: row.name,
          Specialisation: row.specialization ?? '',
          Treatments: row.treatmentCount,
          Revenue: row.totalRevenue,
          'Average per treatment': row.avgPerTreatment,
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
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Financial Reports</h1>
          <p className="text-muted-foreground">View detailed financial analytics and reports</p>
        </div>
        <div className="flex gap-2">
          <Select
            value={datePreset}
            onValueChange={(v) => {
              setDatePreset(v)
              setDateFrom('')
              setDateTo('')
            }}
          >
            <SelectTrigger className="w-[160px]">
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
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[140px]"
              />
            </>
          )}
          <ExportMenu filename={`billing-${activeTab}`} getData={exportRows} />
        </div>
      </div>

      {/* Report Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="outstanding" className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Outstanding
          </TabsTrigger>
          <TabsTrigger value="procedure_revenue" className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            By Procedure
          </TabsTrigger>
          <TabsTrigger value="doctor_revenue" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            By Doctor
          </TabsTrigger>
          <TabsTrigger value="daily_collection" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Daily Collection
          </TabsTrigger>
        </TabsList>

        {/* Outstanding Report */}
        <TabsContent value="outstanding" className="space-y-6">
          {/* Aging Summary */}
          <div className="grid gap-4 md:grid-cols-5">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="pt-6">
                    <Skeleton className="h-8 w-24" />
                  </CardContent>
                </Card>
              ))
            ) : outstandingData ? (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400">
                      Current
                    </CardTitle>
                    <CardDescription>Not yet due</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.current.amount)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.current.count} invoices
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                      1-30 Days
                    </CardTitle>
                    <CardDescription>Overdue</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.days1_30.amount)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.days1_30.count} invoices
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-orange-600 dark:text-orange-400">
                      31-60 Days
                    </CardTitle>
                    <CardDescription>Overdue</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.days31_60.amount)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.days31_60.count} invoices
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-red-500 dark:text-red-400">
                      61-90 Days
                    </CardTitle>
                    <CardDescription>Overdue</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.days61_90.amount)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.days61_90.count} invoices
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-red-700 dark:text-red-300">
                      90+ Days
                    </CardTitle>
                    <CardDescription>Critical</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.over90.amount)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.over90.count} invoices
                    </p>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </div>

          {/* Outstanding Invoices Table */}
          <Card>
            <CardHeader>
              <CardTitle>Outstanding Invoices</CardTitle>
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
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : outstandingData?.invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        No outstanding invoices
                      </TableCell>
                    </TableRow>
                  ) : (
                    outstandingData?.invoices.map((invoice) => (
                      <ClickableRow
                        key={invoice.id}
                        href={trail.to(`/billing/invoices/${invoice.id}`)}
                        label={`Open invoice ${invoice.invoiceNo}`}
                      >
                        <TableCell className="font-medium">{invoice.invoiceNo}</TableCell>
                        <TableCell>
                          {invoice.patient.firstName} {invoice.patient.lastName}
                        </TableCell>
                        <TableCell>{formatDate(invoice.createdAt)}</TableCell>
                        <TableCell>{invoice.dueDate ? formatDate(invoice.dueDate) : '-'}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(invoice.totalAmount)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                          {formatCurrency(invoice.balanceAmount)}
                        </TableCell>
                      </ClickableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Procedure Revenue Report */}
        <TabsContent value="procedure_revenue" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
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
                <CardTitle className="text-sm font-medium">Total Treatments</CardTitle>
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
              <CardTitle>Revenue by Procedure</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Procedure</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-center">Count</TableHead>
                    <TableHead className="text-right">Avg. Revenue</TableHead>
                    <TableHead className="text-right">Total Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : procedureData?.byProcedure.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        No procedure data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    procedureData?.byProcedure.map((proc) => (
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
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Doctor Revenue Report */}
        <TabsContent value="doctor_revenue" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
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
                <CardTitle className="text-sm font-medium">Total Treatments</CardTitle>
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
                <CardTitle className="text-sm font-medium">Active Doctors</CardTitle>
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
              <CardTitle>Revenue by Doctor</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Doctor</TableHead>
                    <TableHead className="text-center">Treatments</TableHead>
                    <TableHead className="text-right">Avg. per Treatment</TableHead>
                    <TableHead className="text-right">Total Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : doctorData?.byDoctor.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        No doctor data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    doctorData?.byDoctor.map((doc) => (
                      <TableRow key={doc.doctorId}>
                        <TableCell>
                          <div className="font-medium">Dr. {doc.name}</div>
                          {doc.specialization && (
                            <div className="text-sm text-muted-foreground">
                              {doc.specialization}
                            </div>
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
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily Collection Report */}
        <TabsContent value="daily_collection" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total Collection</CardTitle>
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
                <CardTitle className="text-sm font-medium">Total Payments</CardTitle>
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
              <CardTitle>Daily Collection Breakdown</CardTitle>
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
                    <TableHead className="text-right">Mobile Wallet</TableHead>
                    <TableHead className="text-right">Bank Transfer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-center">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-12" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : dailyData?.dailyData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        No collection data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    dailyData?.dailyData.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className="font-medium">{formatDate(day.date)}</TableCell>
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
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
