'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { BackLink, useTrail } from '@/components/ui/trail'
import { ClinicianTimeline } from '@/components/schedule/clinician-timeline'
import { SeenDay, SeenWeek } from '@/components/schedule/seen-views'
import { WeekAvailability } from '@/components/schedule/week-availability'
import { useScheduleLinks } from '@/components/schedule/use-schedule-links'
import { addDays, dayMonth, weekStart, weekdayShort } from '@/components/schedule/labels'
import { displayDate } from '@/lib/dates'
import { readJson } from '@/lib/toast-utils'
import type { ClinicSchedule, SeenCounts } from '@/lib/schedule'

/**
 * The clinician schedule: who is free when, across every dentist and
 * assistant, and how many patients each hour saw.
 *
 * The dashboard shows today. This is any day or week, kept in the address
 * bar (`view`, `day`) so a view can be sent to somebody or come back to.
 */

type View = 'day' | 'week'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The schedule and the patients seen for a day, or for the week holding it. */
async function fetchSchedule(day: string, view: View) {
  const days = view === 'week' ? 7 : 1
  // A week starts on its Sunday, so with no day given today has to be known
  // first; a day view without one simply gets the server's today.
  const anchor =
    day ||
    (view === 'week' ? (await readJson<{ today: string }>(await fetch('/api/schedule'))).today : '')
  const first = anchor ? (view === 'week' ? weekStart(anchor) : anchor) : ''
  const scheduleData = await readJson<{ today: string; schedules: ClinicSchedule[] }>(
    await fetch(`/api/schedule?days=${days}${first ? `&day=${first}` : ''}`)
  )
  const from = first || scheduleData.schedules[0].day
  const seen = await readJson<SeenCounts>(
    await fetch(`/api/schedule/seen?from=${from}&days=${days}`)
  )
  return { today: scheduleData.today, schedules: scheduleData.schedules, seen }
}

export default function ClinicianSchedulePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const trail = useTrail('Clinician schedule')
  const links = useScheduleLinks(trail.to)

  const view: View = searchParams.get('view') === 'week' ? 'week' : 'day'
  const requestedDay = searchParams.get('day') ?? ''
  const [clinicToday, setClinicToday] = useState<string | null>(null)
  // The day asked for, or '' for the clinic's today, which only the server
  // knows: the browser's own date can be a different one.
  const day = DAY.test(requestedDay) ? requestedDay : ''

  const [schedules, setSchedules] = useState<ClinicSchedule[] | null>(null)
  const [seen, setSeen] = useState<SeenCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const go = useCallback(
    (next: { view?: View; day?: string }) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next.view) params.set('view', next.view)
      if (next.day) params.set('day', next.day)
      router.replace(`/appointments/schedule?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  // Bumped by "Try again", which loads the same day and view once more.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // A newer day or view supersedes this answer; a late reply is dropped
    // rather than shown over the day now being looked at.
    let current = true
    // Loading from the server when the day or view changes is what this is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setFailed(false)
    fetchSchedule(day, view)
      .then((data) => {
        if (!current) return
        setClinicToday(data.today)
        setSchedules(data.schedules)
        setSeen(data.seen)
      })
      .catch((error) => {
        if (!current) return
        console.error('Failed to load the schedule:', error)
        setFailed(true)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [day, view, attempt])

  const header = (
    <PageHeader
      back={<BackLink trail={trail} fallback="/appointments" fallbackLabel="Appointments" />}
      title="Clinician schedule"
      description="Who is free when, and how many patients each hour saw"
    />
  )

  if (loading && !schedules) return <PageSkeleton variant="dashboard" />

  if (failed || !schedules || !seen) {
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed what="the schedule" onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    )
  }

  const shown = day || clinicToday || schedules[0].day
  const step = view === 'week' ? 7 : 1
  const first = schedules[0].day
  const last = schedules[schedules.length - 1].day
  const heading =
    view === 'week'
      ? `${weekdayShort(first)} ${dayMonth(first)} – ${weekdayShort(last)} ${dayMonth(last)}`
      : `${weekdayShort(shown)}, ${displayDate(shown)}`
  const totalFree = schedules.reduce(
    (sum, s) => sum + s.clinicians.reduce((n, c) => n + c.counts.free, 0),
    0
  )

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="View"
          value={view}
          onChange={(next) => go({ view: next, day: shown })}
          options={[
            { value: 'day', label: 'Day', icon: CalendarDays },
            { value: 'week', label: 'Week', icon: CalendarRange },
          ]}
        />
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={view === 'week' ? 'Previous week' : 'Previous day'}
            onClick={() => go({ day: addDays(shown, -step) })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={view === 'week' ? 'Next week' : 'Next day'}
            onClick={() => go({ day: addDays(shown, step) })}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {clinicToday && (
            <Button
              variant="outline"
              onClick={() => go({ day: clinicToday })}
              disabled={
                view === 'day' ? shown === clinicToday : weekStart(shown) === weekStart(clinicToday)
              }
            >
              Today
            </Button>
          )}
        </div>
        <Input
          type="date"
          aria-label="Go to a day"
          className="w-auto"
          value={shown}
          onChange={(event) => DAY.test(event.target.value) && go({ day: event.target.value })}
        />
        <span className="text-sm font-medium" aria-live="polite">
          {heading}
        </span>
        <Button variant="link" asChild className="ml-auto">
          <Link href={links.dayBook(shown)}>Open the day book</Link>
        </Button>
      </div>

      <Card className={loading ? 'opacity-60 transition-opacity' : undefined}>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <CardDescription>
            {view === 'week'
              ? `${totalFree} free slots this week. Open a day to book one.`
              : `${totalFree} free slots of ${schedules[0].slotMinutes} minutes. Select a free slot to book it.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view === 'week' ? (
            <WeekAvailability
              schedules={schedules}
              dayHref={(d) => `/appointments/schedule?view=day&day=${d}`}
              staffHref={links.staff}
            />
          ) : (
            <ClinicianTimeline schedule={schedules[0]} links={links.timeline(shown)} />
          )}
        </CardContent>
      </Card>

      <Card className={loading ? 'opacity-60 transition-opacity' : undefined}>
        <CardHeader>
          <CardTitle>Patients seen</CardTitle>
          <CardDescription>
            {seen.total === 0
              ? `Nobody seen ${view === 'week' ? 'this week' : 'on this day'} yet.`
              : `${seen.total} ${seen.total === 1 ? 'patient' : 'patients'} seen ${view === 'week' ? 'this week' : 'on this day'}. Counted once they have checked in.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view === 'week' ? (
            <SeenWeek seen={seen} links={links.seen} />
          ) : (
            <SeenDay seen={seen} links={links.seen} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
