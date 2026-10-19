'use client'

import Link from 'next/link'
import type { ClinicSchedule, ClinicianDay } from '@/lib/schedule'
import { formatTime } from '@/lib/appointment-utils'
import { dayMonth, hoursLabel, weekdayShort } from './labels'

/**
 * A week of availability: each clinician against each day, with their hours
 * and how much of the day is still free. A cell opens that day's timeline,
 * where the free slots can be booked.
 */
export function WeekAvailability({
  schedules,
  dayHref,
  staffHref,
}: {
  schedules: ClinicSchedule[]
  dayHref: (day: string) => string
  staffHref: (clinician: ClinicianDay) => string | null
}) {
  const clinicians = schedules[0]?.clinicians ?? []
  if (clinicians.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nobody who sees patients is set up yet. Add dentists and assistants under Staff.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-1 text-xs">
        <caption className="sr-only">Each clinician&apos;s hours and free slots, by day</caption>
        <thead>
          <tr>
            <th scope="col" className="w-36 px-2 text-left font-medium text-muted-foreground">
              Clinician
            </th>
            {schedules.map((schedule) => (
              <th key={schedule.day} scope="col" className="px-1 text-left font-medium">
                <Link href={dayHref(schedule.day)} className="hover:underline">
                  {weekdayShort(schedule.day)}{' '}
                  <span className="font-normal text-muted-foreground">
                    {dayMonth(schedule.day)}
                  </span>
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clinicians.map((clinician) => {
            const href = staffHref(clinician)
            return (
              <tr key={clinician.id}>
                <th scope="row" className="px-2 text-left font-normal">
                  {href ? (
                    <Link href={href} className="font-medium hover:underline">
                      {clinician.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{clinician.name}</span>
                  )}
                  <span className="block text-[11px] text-muted-foreground">
                    {clinician.kind === 'dentist' ? 'Dentist' : 'Assistant'}
                  </span>
                </th>
                {schedules.map((schedule) => {
                  const day = schedule.clinicians.find((c) => c.id === clinician.id)
                  return (
                    <td key={schedule.day} className="align-top">
                      <DayCell day={day} href={dayHref(schedule.day)} />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DayCell({ day, href }: { day: ClinicianDay | undefined; href: string }) {
  if (!day || day.closed || !day.open) {
    return (
      <Link
        href={href}
        className="block h-full rounded-md bg-muted px-2 py-1.5 text-muted-foreground hover:bg-muted/70"
        title={day?.closed ?? undefined}
      >
        <span className="line-clamp-3">{day?.closed ?? 'Off'}</span>
      </Link>
    )
  }

  const total = day.slots.length || 1
  const booked = day.slots.filter((s) => s.state === 'booked').length
  return (
    <Link
      href={href}
      className="block rounded-md border px-2 py-1.5 hover:bg-accent"
      aria-label={`${day.name}: ${formatTime(day.open)} to ${formatTime(day.close!)}, ${day.counts.free} free, ${day.counts.visits} booked`}
    >
      <span className="block whitespace-nowrap text-muted-foreground">
        {hoursLabel(day.open, day.close!)}
      </span>
      <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-emerald-500/20" aria-hidden>
        <span className="bg-primary" style={{ width: `${(booked / total) * 100}%` }} />
      </span>
      <span className="mt-1 block font-medium">
        {day.counts.free} free · {day.counts.visits} booked
      </span>
    </Link>
  )
}
