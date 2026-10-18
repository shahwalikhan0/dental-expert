'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { BackLink, useTrail } from '@/components/ui/trail'
import {
  Calendar,
  TrendingUp,
  Users,
  Stethoscope,
  Banknote,
  Clock,
  FileText,
  UserCheck,
  UserX,
} from 'lucide-react'
import { BLANK, isoDay } from '@/lib/dates'
import { formatCurrency } from '@/lib/i18n/format'
import { LATES_PER_ABSENCE } from '@/lib/attendance'

interface PerformanceData {
  staff: {
    id: string
    employeeId: string
    name: string
    role: string
    specialization: string | null
  }
  period: {
    start: string
    end: string
  }
  appointments: {
    total: number
    completed: number
    cancelled: number
    noShow: number
    avgWaitTime: number
  }
  treatments: {
    total: number
    completed: number
    inProgress: number
    cancelled: number
  }
  revenue: {
    total: number
    averagePerTreatment: number
  }
  procedureBreakdown: Array<{
    category: string
    count: number
    revenue: number
  }>
  patientsTreated: number
  prescriptionsWritten: number
  /** From the attendance register; null when the person is not on it. */
  attendance: {
    userId: string
    present: number
    late: number
    absent: number
    /** Absences plus those charged for lateness — see LATES_PER_ABSENCE. */
    totalAbsent: number
    unmarked: number
    rate: number | null
  } | null
}

const categoryLabels: Record<string, string> = {
  PREVENTIVE: 'Preventive',
  RESTORATIVE: 'Restorative',
  ENDODONTIC: 'Endodontic',
  PERIODONTIC: 'Periodontic',
  PROSTHODONTIC: 'Prosthodontic',
  ORTHODONTIC: 'Orthodontic',
  ORAL_SURGERY: 'Oral surgery',
  COSMETIC: 'Cosmetic',
  DIAGNOSTIC: 'Diagnostic',
  EMERGENCY: 'Emergency',
}

export default function PerformancePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PerformanceData | null>(null)
  // The figures could not be fetched (failed), or the person does not exist (missing).
  const [failed, setFailed] = useState(false)
  const [missing, setMissing] = useState(false)
  const trail = useTrail(data ? `${data.staff.name} — performance` : null)

  // Date filters
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(1)
    return isoDay(date)
  })
  const [endDate, setEndDate] = useState(() => {
    return isoDay(new Date())
  })

  const fetchPerformance = async () => {
    try {
      setLoading(true)
      setFailed(false)
      setMissing(false)
      const params = new URLSearchParams({
        startDate,
        endDate,
      })

      const response = await fetch(`/api/staff/${resolvedParams.id}/performance?${params}`)
      if (response.status === 404) {
        setMissing(true)
        return
      }
      if (!response.ok) throw new Error('Failed to fetch performance data')

      const result = await response.json()
      setData(result)
    } catch (error) {
      console.error('Error fetching performance:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Loading the screen's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPerformance()
    // Refetch when what is asked changes; `fetchPerformance` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedParams.id, startDate, endDate])

  const getCompletionRate = () => {
    if (!data || data.appointments.total === 0) return 0
    return Math.round((data.appointments.completed / data.appointments.total) * 100)
  }

  const back = (
    <BackLink
      trail={trail}
      fallback={`/staff/${resolvedParams.id}`}
      fallbackLabel={data?.staff.name ?? 'Staff member'}
    />
  )

  // Only the first load: changing the dates keeps the page and its controls.
  if (loading && !data) return <PageSkeleton variant="dashboard" />

  if (missing) {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState
          icon={UserX}
          title="Staff member not found"
          description="They may have been removed, or the link is wrong."
          actionLabel="Back to staff"
          actionHref="/staff"
        />
      </div>
    )
  }

  if (failed || !data) {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="the performance figures" onRetry={fetchPerformance} />
      </div>
    )
  }

  return (
    <div className="space-y-6" aria-busy={loading || undefined}>
      <PageHeader
        title="Performance"
        back={back}
        description={
          <>
            {data.staff.name} ({data.staff.employeeId})
            {data.staff.specialization && ` — ${data.staff.specialization}`}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="performance-from" className="sr-only">
              From
            </Label>
            <Input
              id="performance-from"
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-[160px]"
            />
            <span className="text-muted-foreground">to</span>
            <Label htmlFor="performance-to" className="sr-only">
              To
            </Label>
            <Input
              id="performance-to"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-[160px]"
            />
          </div>
        }
      />

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Invoiced</p>
                <p className="text-2xl font-bold">{formatCurrency(data.revenue.total)}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center dark:bg-green-950/40">
                <Banknote className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Avg: {formatCurrency(data.revenue.averagePerTreatment)} / treatment billed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Patients treated</p>
                <p className="text-2xl font-bold">{data.patientsTreated}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center dark:bg-blue-950/40">
                <Users className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2">Unique patients this period</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Treatments done</p>
                <p className="text-2xl font-bold">{data.treatments.completed}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center dark:bg-purple-950/40">
                <Stethoscope className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {data.treatments.inProgress} in progress
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Prescriptions</p>
                <p className="text-2xl font-bold">{data.prescriptionsWritten}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-orange-100 flex items-center justify-center dark:bg-orange-950/40">
                <FileText className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2">Written this period</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Appointments Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Appointments
            </CardTitle>
            <CardDescription>Appointment statistics for the selected period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Completion rate</span>
              <span className="text-sm font-medium">{getCompletionRate()}%</span>
            </div>
            <Progress value={getCompletionRate()} className="h-2" />

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-xl font-bold">{data.appointments.total}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg dark:bg-green-950/30">
                <p className="text-sm text-green-600 dark:text-green-400">Completed</p>
                <p className="text-xl font-bold text-green-700 dark:text-green-300">
                  {data.appointments.completed}
                </p>
              </div>
              <div className="p-3 bg-red-50 rounded-lg dark:bg-red-950/30">
                <p className="text-sm text-red-600 dark:text-red-400">Cancelled</p>
                <p className="text-xl font-bold text-red-700 dark:text-red-300">
                  {data.appointments.cancelled}
                </p>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg dark:bg-yellow-950/30">
                <p className="text-sm text-yellow-600 dark:text-yellow-400">No-show</p>
                <p className="text-xl font-bold text-yellow-700 dark:text-yellow-300">
                  {data.appointments.noShow}
                </p>
              </div>
            </div>

            {data.appointments.avgWaitTime > 0 && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Average wait time: {data.appointments.avgWaitTime} minutes
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attendance Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-4 w-4" />
              Attendance
            </CardTitle>
            <CardDescription>Attendance statistics for the selected period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!data.attendance ? (
              <p className="text-sm text-muted-foreground">
                Not on the attendance register — they have not signed in yet.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Attendance rate</span>
                  <span className="text-sm font-medium">
                    {data.attendance.rate === null ? BLANK : `${data.attendance.rate}%`}
                  </span>
                </div>
                <Progress value={data.attendance.rate ?? 0} className="h-2" />

                <div className="grid grid-cols-2 gap-4 mt-4 sm:grid-cols-4">
                  <div className="p-3 bg-green-50 rounded-lg text-center dark:bg-green-950/30">
                    <p className="text-sm text-green-600 dark:text-green-400">Present</p>
                    <p className="text-xl font-bold text-green-700 dark:text-green-300">
                      {data.attendance.present}
                    </p>
                  </div>
                  <div className="p-3 bg-yellow-50 rounded-lg text-center dark:bg-yellow-950/30">
                    <p className="text-sm text-yellow-600 dark:text-yellow-400">Late</p>
                    <p className="text-xl font-bold text-yellow-700 dark:text-yellow-300">
                      {data.attendance.late}
                    </p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg text-center dark:bg-red-950/30">
                    <p className="text-sm text-red-600 dark:text-red-400">Absent</p>
                    <p className="text-xl font-bold text-red-700 dark:text-red-300">
                      {data.attendance.totalAbsent}
                    </p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">Not marked</p>
                    <p className="text-xl font-bold">{data.attendance.unmarked}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Absent includes one day for every {LATES_PER_ABSENCE} lates.{' '}
                  <Link
                    href={trail.to(
                      `/attendance/${data.attendance.userId}?start=${startDate}&end=${endDate}`
                    )}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Open the attendance record
                  </Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Procedure Breakdown */}
      {data.procedureBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Procedure breakdown
            </CardTitle>
            <CardDescription>Completed and invoiced, by procedure category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...data.procedureBreakdown]
                .sort((a, b) => b.revenue - a.revenue)
                .map((proc) => {
                  const maxRevenue = Math.max(...data.procedureBreakdown.map((p) => p.revenue))
                  const percentage = maxRevenue > 0 ? (proc.revenue / maxRevenue) * 100 : 0

                  return (
                    <div key={proc.category} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {categoryLabels[proc.category] || proc.category}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {proc.count} procedures
                          </span>
                        </div>
                        <span className="font-medium">{formatCurrency(proc.revenue)}</span>
                      </div>
                      <Progress value={percentage} className="h-2" />
                    </div>
                  )
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
