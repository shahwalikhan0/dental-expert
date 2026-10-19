'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ProfileHeader } from '@/components/ui/profile-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { BackLink, useTrail } from '@/components/ui/trail'
import { Users, Stethoscope, Banknote, Clock, FileText, IdCard, UserX } from 'lucide-react'
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
      {/* Whose figures, as a profile like their record's, with the period
          the figures cover where the record has its buttons. */}
      <ProfileHeader
        eyebrow="Performance"
        name={data.staff.name}
        initials={data.staff.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0))
          .join('')
          .toUpperCase()}
        facts={[
          { icon: IdCard, label: data.staff.employeeId },
          ...(data.staff.specialization
            ? [{ icon: Stethoscope, label: data.staff.specialization }]
            : []),
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
            <span className="text-sm text-muted-foreground">to</span>
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Invoiced',
            value: formatCurrency(data.revenue.total),
            note: `Avg: ${formatCurrency(data.revenue.averagePerTreatment)} / treatment billed`,
            icon: Banknote,
          },
          {
            label: 'Patients treated',
            value: data.patientsTreated,
            note: 'Unique patients this period',
            icon: Users,
          },
          {
            label: 'Treatments done',
            value: data.treatments.completed,
            note: `${data.treatments.inProgress} in progress`,
            icon: Stethoscope,
          },
          {
            label: 'Prescriptions',
            value: data.prescriptionsWritten,
            note: 'Written this period',
            icon: FileText,
          },
        ].map((tile) => (
          <div key={tile.label} className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {tile.label}
                </p>
                <p className="mt-1 text-2xl font-bold tracking-tight">{tile.value}</p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <tile.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{tile.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Appointments Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Appointments</CardTitle>
            <CardDescription>Appointment statistics for the selected period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Completion rate</span>
              <span className="text-sm font-medium">{getCompletionRate()}%</span>
            </div>
            <Progress value={getCompletionRate()} className="h-2" />

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-muted p-4">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold tabular-nums">{data.appointments.total}</p>
              </div>
              <div className="rounded-xl bg-green-50 p-4 dark:bg-green-950/30">
                <p className="text-sm text-green-600 dark:text-green-400">Completed</p>
                <p className="text-2xl font-bold tabular-nums text-green-700 dark:text-green-300">
                  {data.appointments.completed}
                </p>
              </div>
              <div className="rounded-xl bg-red-50 p-4 dark:bg-red-950/30">
                <p className="text-sm text-red-600 dark:text-red-400">Cancelled</p>
                <p className="text-2xl font-bold tabular-nums text-red-700 dark:text-red-300">
                  {data.appointments.cancelled}
                </p>
              </div>
              <div className="rounded-xl bg-yellow-50 p-4 dark:bg-yellow-950/30">
                <p className="text-sm text-yellow-600 dark:text-yellow-400">No-show</p>
                <p className="text-2xl font-bold tabular-nums text-yellow-700 dark:text-yellow-300">
                  {data.appointments.noShow}
                </p>
              </div>
            </div>

            {data.appointments.avgWaitTime > 0 && (
              <div className="flex items-center gap-2 border-t pt-4">
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
            <CardTitle>Attendance</CardTitle>
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

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-green-50 p-4 text-center dark:bg-green-950/30">
                    <p className="text-sm text-green-600 dark:text-green-400">Present</p>
                    <p className="text-2xl font-bold tabular-nums text-green-700 dark:text-green-300">
                      {data.attendance.present}
                    </p>
                  </div>
                  <div className="rounded-xl bg-yellow-50 p-4 text-center dark:bg-yellow-950/30">
                    <p className="text-sm text-yellow-600 dark:text-yellow-400">Late</p>
                    <p className="text-2xl font-bold tabular-nums text-yellow-700 dark:text-yellow-300">
                      {data.attendance.late}
                    </p>
                  </div>
                  <div className="rounded-xl bg-red-50 p-4 text-center dark:bg-red-950/30">
                    <p className="text-sm text-red-600 dark:text-red-400">Absent</p>
                    <p className="text-2xl font-bold tabular-nums text-red-700 dark:text-red-300">
                      {data.attendance.totalAbsent}
                    </p>
                  </div>
                  <div className="rounded-xl bg-muted p-4 text-center">
                    <p className="text-sm text-muted-foreground">Not marked</p>
                    <p className="text-2xl font-bold tabular-nums">{data.attendance.unmarked}</p>
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
            <CardTitle>Procedure breakdown</CardTitle>
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
