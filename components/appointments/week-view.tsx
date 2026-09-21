'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { BookAppointment } from './appointment-book'

/** A booking, plus the day it falls on — which a week has to read off each row. */
export type WeekAppointment = BookAppointment & { scheduledDate: string }

/**
 * A week of the book.
 *
 * The backend has supported `view=day|week|month` since before the book was
 * written, and nothing ever asked it for a week. The day book answers "who is
 * in at eleven"; this answers the question a practice actually plans around —
 * where the gaps are, which afternoon is empty, when the next free Tuesday is.
 * Without it the only way to find out was to page forward one day at a time.
 *
 * Deliberately not the dentist-by-time grid the day book uses. Seven of those
 * side by side is unreadable at any screen width, and it is not the question
 * being asked: a week is read by day, looking for the light column.
 */

const STATUS_DOT: Record<string, string> = {
  SCHEDULED: 'bg-slate-500',
  CONFIRMED: 'bg-blue-500',
  CHECKED_IN: 'bg-amber-500',
  IN_PROGRESS: 'bg-violet-500',
  COMPLETED: 'bg-green-500',
  NO_SHOW: 'bg-red-500',
  CANCELLED: 'bg-muted-foreground',
}

const DEAD = ['CANCELLED', 'NO_SHOW']

const subjectOf = (a: BookAppointment) =>
  a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : (a.visitor?.name ?? 'Unknown')

/** `2026-09-21` plus n days, in calendar days rather than instants. */
function addDays(day: string, n: number): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

/** `14:30` as `2:30 pm`. */
function clockLabel(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const suffix = hours < 12 ? 'am' : 'pm'
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${hour}:${String(minutes).padStart(2, '0')}${suffix}`
}

export function WeekView({
  weekStart,
  today,
  appointments,
  href,
  onPickDay,
}: {
  /** The Sunday the week runs from, as YYYY-MM-DD. */
  weekStart: string
  /** The clinic's today, so it can be marked. */
  today: string
  appointments: WeekAppointment[]
  href: (appointment: BookAppointment) => string
  /** Clicking a day's header opens that day in the book. */
  onPickDay?: (day: string) => void
}) {
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }, [weekStart])

  const byDay = useMemo(() => {
    const map = new Map<string, WeekAppointment[]>()
    for (const day of days) map.set(day, [])
    for (const appointment of appointments) {
      const day = appointment.scheduledDate?.slice(0, 10)
      // An appointment outside the week the caller asked for is not dropped
      // silently — but it has no column, so there is nowhere honest to put it.
      if (!day || !map.has(day)) continue
      map.get(day)!.push(appointment)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
    }
    return map
  }, [appointments, days])

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[820px] grid-cols-7 gap-px rounded-lg border bg-border">
        {days.map((day) => {
          const list = byDay.get(day) ?? []
          const live = list.filter((a) => !DEAD.includes(a.status))
          const isToday = day === today
          const date = new Date(`${day}T12:00:00.000Z`)

          return (
            <div key={day} className="flex min-h-[18rem] flex-col bg-background">
              <button
                type="button"
                onClick={() => onPickDay?.(day)}
                className={cn(
                  'border-b px-2 py-2 text-left hover:bg-muted/50 focus:bg-muted focus:outline-none',
                  isToday && 'bg-primary/5'
                )}
              >
                <span className="block text-xs text-muted-foreground">
                  {date.toLocaleDateString('en-PK', { weekday: 'short', timeZone: 'UTC' })}
                </span>
                <span className={cn('block text-lg font-semibold', isToday && 'text-primary')}>
                  {date.getUTCDate()}
                </span>
                {/*
                  The count is the point of a week view: an empty column is a
                  day with room on it, and that is what somebody is scanning for.
                */}
                <span className="block text-xs text-muted-foreground">
                  {live.length === 0 ? 'Free' : `${live.length} booked`}
                </span>
              </button>

              <div className="flex-1 space-y-1 overflow-y-auto p-1">
                {list.map((appointment) => (
                  <Link
                    key={appointment.id}
                    href={href(appointment)}
                    className={cn(
                      'block rounded border px-1.5 py-1 text-xs hover:bg-muted/50 focus:bg-muted focus:outline-none',
                      DEAD.includes(appointment.status) && 'opacity-60 line-through'
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          STATUS_DOT[appointment.status] ?? 'bg-muted-foreground'
                        )}
                        aria-hidden
                      />
                      <span className="font-medium">{clockLabel(appointment.scheduledTime)}</span>
                    </span>
                    <span className="block truncate">{subjectOf(appointment)}</span>
                    {appointment.doctor && (
                      <span className="block truncate text-muted-foreground">
                        Dr. {appointment.doctor.lastName}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
