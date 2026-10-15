'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, CalendarRange } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadFailed } from '@/components/ui/load-failed'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { readJson } from '@/lib/toast-utils'
import type { ClinicSchedule, SeenCounts } from '@/lib/schedule'
import { ClinicianTimeline } from './clinician-timeline'
import { SeenDay, SeenWeek } from './seen-views'
import { useScheduleLinks } from './use-schedule-links'
import { weekStart } from './labels'

type Range = 'day' | 'week'

/**
 * The dashboard's view of the clinic's chairs: who is free for the rest of
 * today, and how many patients were seen today or this week, by the hour and
 * by clinician. Any other day is on the clinician schedule, which every part
 * of this links to.
 */
export function DashboardSchedule({ to }: { to: (href: string) => string }) {
  const links = useScheduleLinks(to)
  const [schedule, setSchedule] = useState<ClinicSchedule | null>(null)
  // The counts with the period they are for, so switching period never shows
  // the old period's numbers under the new one's name while the new ones load.
  const [seen, setSeen] = useState<{ range: Range; counts: SeenCounts } | null>(null)
  const [range, setRange] = useState<Range>('day')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    // Loading from the server when the range changes is what this is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false)
    ;(async () => {
      const today = await readJson<{ today: string; schedules: ClinicSchedule[] }>(
        await fetch('/api/schedule')
      )
      const from = range === 'week' ? weekStart(today.today) : today.today
      const counts = await readJson<SeenCounts>(
        await fetch(`/api/schedule/seen?from=${from}&days=${range === 'week' ? 7 : 1}`)
      )
      if (!current) return
      setSchedule(today.schedules[0])
      setSeen({ range, counts })
    })().catch((error) => {
      if (!current) return
      console.error('Failed to load the schedule:', error)
      setFailed(true)
    })
    return () => {
      current = false
    }
  }, [range, attempt])

  const scheduleHref = (view: Range) =>
    to(`/appointments/schedule?view=${view}${schedule ? `&day=${schedule.day}` : ''}`)

  if (failed) {
    return (
      <Card>
        <CardContent className="pt-6">
          <LoadFailed what="the schedule" onRetry={() => setAttempt((n) => n + 1)} />
        </CardContent>
      </Card>
    )
  }

  const free = schedule?.clinicians.reduce((n, c) => n + c.counts.free, 0) ?? 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Who&apos;s free today</CardTitle>
            <CardDescription>
              {schedule
                ? `${free} free ${free === 1 ? 'slot' : 'slots'} left today. Select one to book it.`
                : 'Every dentist and assistant, slot by slot'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={scheduleHref('day')}>Open the schedule</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {schedule ? (
            <ClinicianTimeline schedule={schedule} links={links.timeline(schedule.day)} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Patients seen</CardTitle>
            <CardDescription>
              {seen
                ? `${seen.counts.total} ${seen.counts.total === 1 ? 'patient' : 'patients'} ${seen.range === 'week' ? 'this week' : 'today'}, counted once they check in`
                : 'By the hour and by clinician'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl
              aria-label="Period"
              value={range}
              onChange={setRange}
              options={[
                { value: 'day', label: 'Today', icon: CalendarDays },
                { value: 'week', label: 'This week', icon: CalendarRange },
              ]}
            />
            <Button variant="link" size="sm" asChild>
              <Link href={scheduleHref(range)}>Details</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent
          className={seen && seen.range !== range ? 'opacity-60 transition-opacity' : undefined}
        >
          {!seen ? (
            <Skeleton className="h-56 w-full" />
          ) : seen.range === 'week' ? (
            <SeenWeek seen={seen.counts} links={links.seen} />
          ) : (
            <SeenDay seen={seen.counts} links={links.seen} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
