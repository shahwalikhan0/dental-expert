'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { minutesOf, timeOf } from '@/lib/working-hours'
import { formatTime } from '@/lib/appointment-utils'
import { appointmentBlockClass, appointmentStatusLabel } from './status-tone'

/**
 * The appointment book.
 *
 * Every practice management system is built around this screen — a grid of
 * dentists against time, with appointments as blocks you can see at a glance.
 * This application had a "Calendar" button that set a `viewMode` state nobody
 * read, so it highlighted itself and rendered the same list. The backend had
 * supported `view=day|week|month` the whole time.
 *
 * Deliberately a CSS grid rather than a table or a charting library. Each
 * column is a dentist, each row a slot of the day, and an appointment spans the
 * rows its duration covers — which is the one thing this screen has to get
 * right, because an hour-long appointment that looks the same size as a
 * fifteen-minute one defeats the point of having a book at all.
 */

export interface BookAppointment {
  id: string
  appointmentNo: string
  tokenNumber: string | null
  scheduledTime: string
  duration: number
  status: string
  appointmentType: string
  patient: { id: string; firstName: string; lastName: string } | null
  visitor: { id: string; name: string } | null
  doctor: { id: string; firstName: string; lastName: string } | null
}

export interface BookDoctor {
  id: string
  firstName: string
  lastName: string
}

/**
 * How tall a minute is: 28px for fifteen, enough to read two lines in a
 * 30-minute block. The scale stays the same whatever the clinic's slot length.
 */
const MINUTE_HEIGHT = 28 / 15

/** Finer than this and the rows are too thin to click or read. */
const FINEST_SLOT_MINUTES = 15

const subjectOf = (a: BookAppointment) =>
  a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : (a.visitor?.name ?? 'Unknown')

export function AppointmentBook({
  day,
  appointments,
  doctors,
  openFrom,
  closeAt,
  slotMinutes = FINEST_SLOT_MINUTES,
  href,
  onPick,
}: {
  /** The day being shown, as YYYY-MM-DD. Used only for the empty message. */
  day: string
  appointments: BookAppointment[]
  doctors: BookDoctor[]
  /** The clinic's opening hours, as HH:MM. */
  openFrom: string
  closeAt: string
  /** The clinic's slot length; one row per slot. */
  slotMinutes?: number
  /** Where an appointment block goes. */
  href: (appointment: BookAppointment) => string
  /** Clicking empty space books that slot — this is the click-cost fix. */
  onPick?: (doctorId: string, time: string) => void
}) {
  const start = minutesOf(openFrom)
  const end = minutesOf(closeAt)
  const step = Math.max(FINEST_SLOT_MINUTES, slotMinutes)
  const slotHeight = step * MINUTE_HEIGHT

  const slots = useMemo(() => {
    const rows: number[] = []
    for (let minute = start; minute < end; minute += step) rows.push(minute)
    return rows
  }, [start, end, step])

  // An appointment outside opening hours still has to appear. A book that
  // silently drops the emergency seen at 21:30 is worse than one that shows it
  // hanging off the end.
  const byDoctor = useMemo(() => {
    const map = new Map<string, BookAppointment[]>()
    for (const doctor of doctors) map.set(doctor.id, [])
    for (const appointment of appointments) {
      const key = appointment.doctor?.id ?? 'unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(appointment)
    }
    return map
  }, [appointments, doctors])

  const columns =
    doctors.length > 0 ? doctors : [{ id: 'unassigned', firstName: 'Clinic', lastName: '' }]

  if (slots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        The clinic&rsquo;s opening hours are not set, so there is no day to draw.
      </p>
    )
  }

  return (
    /*
      Scrolls in both directions, with the clock and the dentists pinned.

      A clinic open round the clock draws 1440 minutes at this scale — about
      2700px — so the page scrolled the whole book off the top and took the
      dentists' names with it. Boxing the grid keeps the day inside the screen
      and leaves the headers where they can be read against the row you are
      looking at.
    */
    <div className="max-h-[70vh] overflow-auto">
      <div
        className="grid min-w-[640px]"
        style={{ gridTemplateColumns: `4.5rem repeat(${columns.length}, minmax(9rem, 1fr))` }}
      >
        {/* Header */}
        <div className="sticky left-0 top-0 z-40 bg-background border-b border-r" />
        {columns.map((doctor) => (
          <div
            key={doctor.id}
            className="sticky top-0 z-30 border-b border-r px-3 py-2 text-sm font-medium truncate bg-background"
          >
            {doctor.id === 'unassigned'
              ? 'Unassigned'
              : `Dr. ${doctor.firstName} ${doctor.lastName}`}
          </div>
        ))}

        {/* Time gutter and the slot grid behind the appointments */}
        {slots.map((minute) => (
          <div key={`row-${minute}`} className="contents">
            <div
              className="sticky left-0 z-10 bg-background border-r border-b px-2 text-[11px] text-muted-foreground text-right tabular-nums"
              style={{ height: slotHeight }}
            >
              {/* Only on the hour: a label every fifteen minutes is noise. */}
              {minute % 60 === 0 ? timeOf(minute) : ''}
            </div>
            {columns.map((doctor) => (
              <button
                key={`${doctor.id}-${minute}`}
                type="button"
                onClick={() => onPick?.(doctor.id, timeOf(minute))}
                disabled={!onPick}
                aria-label={`Book ${timeOf(minute)} with ${doctor.id === 'unassigned' ? 'the clinic' : `Dr. ${doctor.firstName} ${doctor.lastName}`}`}
                className={cn(
                  'border-b border-r',
                  minute % 60 === 0 ? 'border-b-border' : 'border-b-border/40',
                  onPick &&
                    'hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset'
                )}
                style={{ height: slotHeight }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Appointments, positioned over the grid.

          A second pass rather than placing them inside the cells: an
          appointment spans several slots, and a block inside the first one
          would be clipped by it. */}
      {/* `pointer-events-none` on the wrapper as well as the grid: the wrapper
          sits directly over the slot buttons, and without it every click to
          book an empty slot landed on this layer instead. */}
      <div
        className="relative pointer-events-none"
        style={{ marginTop: -slots.length * slotHeight }}
      >
        <div
          className="grid min-w-[640px] pointer-events-none"
          style={{ gridTemplateColumns: `4.5rem repeat(${columns.length}, minmax(9rem, 1fr))` }}
        >
          <div />
          {columns.map((doctor) => (
            <div key={doctor.id} className="relative" style={{ height: slots.length * slotHeight }}>
              {(byDoctor.get(doctor.id) ?? []).map((appointment) => {
                const from = minutesOf(appointment.scheduledTime)
                const top = (from - start) * MINUTE_HEIGHT
                const height = Math.max(
                  FINEST_SLOT_MINUTES * MINUTE_HEIGHT - 2,
                  appointment.duration * MINUTE_HEIGHT - 2
                )

                return (
                  <Link
                    key={appointment.id}
                    href={href(appointment)}
                    aria-label={`${subjectOf(appointment)}, ${formatTime(appointment.scheduledTime)}, ${appointmentStatusLabel(appointment.status)}`}
                    className={cn(
                      'pointer-events-auto absolute left-1 right-1 rounded border px-1.5 py-0.5 overflow-hidden text-[11px] leading-tight',
                      'hover:ring-2 hover:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      appointmentBlockClass(appointment.status),
                      // Over, and not going to happen: drawn faded, a cancelled one struck through.
                      appointment.status === 'NO_SHOW' && 'opacity-70',
                      appointment.status === 'CANCELLED' && 'line-through opacity-60'
                    )}
                    style={{ top, height }}
                  >
                    <span className="font-medium truncate block">
                      {appointment.tokenNumber ? `#${appointment.tokenNumber.slice(-3)} ` : ''}
                      {subjectOf(appointment)}
                    </span>
                    {height > FINEST_SLOT_MINUTES * MINUTE_HEIGHT && (
                      <span className="truncate block opacity-80">
                        {formatTime(appointment.scheduledTime)} · {appointment.duration}m
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {appointments.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">Nothing booked for {day}.</p>
      )}
    </div>
  )
}
