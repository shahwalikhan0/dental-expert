'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { minutesOf } from '@/lib/working-hours'
import { formatTime } from '@/lib/appointment-utils'
import type { ClinicSchedule, ClinicianDay, ScheduleSlot } from '@/lib/schedule'
import {
  appointmentBlockClass,
  appointmentStatusLabel,
} from '@/components/appointments/status-tone'
import { hourLabel, hoursLabel } from './labels'

/**
 * Everybody who sees patients, against the day's slots.
 *
 * One row per dentist or assistant, one cell per slot, on a shared clock so
 * the gaps line up down the page: a free 11:30 for three people reads as a
 * column of green. A free cell books that person at that time, a booked one
 * opens the visit, and the lunch break and slots already gone are greyed out.
 * The rules are booking's own (lib/schedule.ts), so a cell shown free is one
 * the booking form will take.
 */

export interface TimelineLinks {
  /** The staff page, or null when the viewer may not open it. */
  staff: (clinician: ClinicianDay) => string | null
  appointment: (appointmentId: string) => string
  /** Booking that slot, or null when the viewer may not book. */
  book: (clinician: ClinicianDay, time: string) => string | null
}

/** A run of slots drawn as one cell: one visit, one break, or the past. */
interface Run {
  first: ScheduleSlot
  span: number
}

/** Free slots stay one cell each, since each is a time to book; the rest merge. */
function runsOf(slots: ScheduleSlot[]): Run[] {
  const runs: Run[] = []
  for (const slot of slots) {
    const last = runs[runs.length - 1]
    const same =
      last &&
      slot.state !== 'free' &&
      last.first.state === slot.state &&
      last.first.appointmentId === slot.appointmentId &&
      last.first.what === slot.what
    if (same) last.span += 1
    else runs.push({ first: slot, span: 1 })
  }
  return runs
}

const KIND_LABEL = { dentist: 'Dentist', assistant: 'Assistant' } as const

/** The narrowest a slot cell may be drawn before it stops being clickable. */
const SLOT_MIN_PX = 14

/** Roughly what `12 AM` needs at this font size. */
const HOUR_LABEL_PX = 34

export function ClinicianTimeline({
  schedule,
  links,
}: {
  schedule: ClinicSchedule
  links: TimelineLinks
}) {
  const step = schedule.slotMinutes
  const working = schedule.clinicians.filter((c) => c.open && c.close)

  if (schedule.clinicians.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nobody who sees patients is set up yet. Add dentists and assistants under Staff.
      </p>
    )
  }

  // One clock for every row: from the earliest start to the latest finish,
  // squared off to the hour.
  const start = working.length
    ? Math.floor(Math.min(...working.map((c) => minutesOf(c.open!))) / 60) * 60
    : 9 * 60
  const end = working.length
    ? Math.ceil(Math.max(...working.map((c) => minutesOf(c.close!))) / 60) * 60
    : 17 * 60
  const columns = Math.max(1, Math.round((end - start) / step))
  const columnOf = (time: string) => Math.round((minutesOf(time) - start) / step) + 1
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(${SLOT_MIN_PX}px, 1fr))` }

  /*
   * How often to write the hour.
   *
   * A clinic open round the clock gives this strip 48 half-hour columns, and
   * at their narrowest an hour is 28px — too little for "12 AM", so the labels
   * collided into a grey smear. Writing every second or third hour instead
   * keeps the clock readable at any opening hours, and the stride is worked
   * out from the width an hour actually gets rather than from a guess about
   * how long the day is.
   */
  const hourWidth = (60 / step) * SLOT_MIN_PX
  const stride = Math.max(1, Math.ceil(HOUR_LABEL_PX / hourWidth))
  const hours: number[] = []
  for (let minute = start; minute < end; minute += 60) hours.push(minute)
  const labelled = hours.filter((_, index) => index % stride === 0)

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* The clock */}
          <div className="flex">
            <div className="sticky left-0 z-20 w-44 shrink-0 bg-card" />
            <div className="grid flex-1" style={grid}>
              {labelled.map((minute) => (
                <div
                  key={minute}
                  className="border-l pl-1 text-[10px] text-muted-foreground"
                  style={{
                    gridColumn: `${(minute - start) / step + 1} / span ${(60 / step) * stride}`,
                  }}
                >
                  {hourLabel(minute / 60)}
                </div>
              ))}
            </div>
          </div>

          <ul className="divide-y">
            {schedule.clinicians.map((clinician) => {
              const staffHref = links.staff(clinician)
              return (
                <li key={clinician.id} className="flex items-center py-2">
                  {/* Stays put while the day scrolls: on a 24-hour clock the
                      strip is wider than any screen, and a row of cells with
                      no name against it says nothing. */}
                  <div className="sticky left-0 z-20 w-44 shrink-0 bg-card pr-3">
                    {staffHref ? (
                      <Link
                        href={staffHref}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {clinician.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm font-medium">{clinician.name}</span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">
                      {KIND_LABEL[clinician.kind]}
                      {clinician.open && ` · ${hoursLabel(clinician.open, clinician.close!)}`}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {clinician.closed
                        ? 'Not available'
                        : `${clinician.counts.free} free · ${clinician.counts.seen} seen`}
                    </span>
                  </div>

                  <div className="grid flex-1 gap-y-1" style={grid}>
                    {clinician.closed || !clinician.open ? (
                      <div
                        className="flex h-8 items-center rounded-md bg-muted px-2 text-xs text-muted-foreground"
                        style={{ gridColumn: `1 / span ${columns}` }}
                      >
                        {clinician.closed ?? 'Not working today'}
                      </div>
                    ) : (
                      runsOf(clinician.slots).map(({ first, span }) => (
                        <SlotCell
                          key={first.time}
                          clinician={clinician}
                          slot={first}
                          span={span}
                          column={columnOf(first.time)}
                          links={links}
                        />
                      ))
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <Legend />
    </div>
  )
}

function SlotCell({
  clinician,
  slot,
  span,
  column,
  links,
}: {
  clinician: ClinicianDay
  slot: ScheduleSlot
  span: number
  column: number
  links: TimelineLinks
}) {
  const place = { gridColumn: `${column} / span ${span}` }
  const time = formatTime(slot.time)

  if (slot.state === 'booked' && slot.appointmentId) {
    const status = appointmentStatusLabel(slot.status ?? '')
    return (
      <Link
        href={links.appointment(slot.appointmentId)}
        style={place}
        aria-label={`${time}, ${slot.patientName}, ${status}. Open the appointment.`}
        className={cn(
          'mx-px flex h-8 items-center overflow-hidden rounded-md border px-1.5 text-[11px] font-medium leading-tight hover:brightness-95',
          appointmentBlockClass(slot.status ?? '')
        )}
      >
        <span className="truncate">{span > 1 ? slot.patientName : ''}</span>
      </Link>
    )
  }

  if (slot.state === 'free') {
    const href = links.book(clinician, slot.time)
    const className =
      'mx-px h-8 rounded-md border border-dashed border-emerald-500/60 bg-emerald-500/10'
    return href ? (
      <Link
        href={href}
        style={place}
        aria-label={`Book ${clinician.name} at ${time}`}
        className={cn(className, 'hover:bg-emerald-500/25')}
      />
    ) : (
      <div style={place} className={className} aria-label={`${clinician.name} free at ${time}`} />
    )
  }

  if (slot.state === 'blocked') {
    return (
      <div
        style={place}
        className="mx-px flex h-8 items-center overflow-hidden rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground"
        aria-label={`${time}, ${slot.what}`}
      >
        <span className="truncate">{span > 1 ? slot.what : ''}</span>
      </div>
    )
  }

  return <div style={place} className="mx-px h-8 rounded-md bg-muted/40" aria-hidden />
}

function Legend() {
  const items = [
    ['border border-dashed border-emerald-500/60 bg-emerald-500/10', 'Free'],
    [appointmentBlockClass('SCHEDULED'), 'Booked'],
    [appointmentBlockClass('CHECKED_IN'), 'Arrived'],
    [appointmentBlockClass('COMPLETED'), 'Seen'],
    ['bg-muted', 'Break or closed'],
    ['bg-muted/40', 'Gone'],
  ]
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([className, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-4 rounded-sm border', className)} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  )
}
