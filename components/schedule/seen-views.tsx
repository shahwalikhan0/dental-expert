'use client'

import Link from 'next/link'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeenCounts, SeenClinician } from '@/lib/schedule'
import { dayMonth, hourLabel, hourRange, weekdayShort } from './labels'

/**
 * How many patients were seen, and when.
 *
 * A visit counts once the patient has arrived (lib/schedule.ts, SEEN_STATUSES).
 * Each counts once for the clinic and once for each clinician on it, so a
 * dentist's row and their assistant's row can both show the same patient, and
 * the clinic's total is not their sum.
 */

export interface SeenLinks {
  /** A clinician's own figures, or null when the viewer may not open them. */
  clinician: (clinician: SeenClinician) => string | null
  /** The day book for a day. */
  day: (day: string) => string
}

interface HeatRow {
  key: string
  label: string
  sublabel?: string
  href?: string | null
  values: number[]
}

/**
 * A table of counts, each cell shaded by how busy it was against the busiest.
 * Plain numbers rather than a chart because a front desk asks "how many at
 * eleven?", and a number answers that where a colour only hints.
 */
export function HeatTable({
  caption,
  corner,
  columns,
  rows,
  totals = true,
}: {
  caption: string
  corner: string
  columns: { key: string; label: string; title: string; href?: string }[]
  rows: HeatRow[]
  totals?: boolean
}) {
  const max = Math.max(1, ...rows.flatMap((row) => row.values))
  const columnTotals = columns.map((_, index) =>
    rows.reduce((sum, row) => sum + (row.values[index] ?? 0), 0)
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-40 px-2 py-1 text-left font-medium text-muted-foreground">
              {corner}
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-1 py-1 text-center font-medium text-muted-foreground"
              >
                {column.href ? (
                  <Link href={column.href} className="hover:underline" aria-label={column.title}>
                    {column.label}
                  </Link>
                ) : (
                  <>
                    <span className="sr-only">{column.title}</span>
                    <span aria-hidden>{column.label}</span>
                  </>
                )}
              </th>
            ))}
            {totals && (
              <th scope="col" className="px-2 py-1 text-right font-medium text-muted-foreground">
                Total
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const total = row.values.reduce((sum, value) => sum + value, 0)
            return (
              <tr key={row.key}>
                <th scope="row" className="px-2 py-1 text-left font-normal">
                  {row.href ? (
                    <Link href={row.href} className="font-medium hover:underline">
                      {row.label}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.label}</span>
                  )}
                  {row.sublabel && (
                    <span className="block text-[11px] text-muted-foreground">{row.sublabel}</span>
                  )}
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={columns[index].key}
                    className="h-8 rounded text-center tabular-nums"
                    style={
                      value > 0
                        ? {
                            backgroundColor: `hsl(var(--primary) / ${0.12 + (value / max) * 0.6})`,
                            color:
                              value / max > 0.55 ? 'hsl(var(--primary-foreground))' : undefined,
                          }
                        : undefined
                    }
                  >
                    {value > 0 ? value : <span className="text-muted-foreground/40">·</span>}
                  </td>
                ))}
                {totals && <td className="px-2 text-right font-semibold tabular-nums">{total}</td>}
              </tr>
            )
          })}
        </tbody>
        {totals && rows.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row" className="px-2 py-1 text-left font-medium text-muted-foreground">
                All
              </th>
              {columnTotals.map((value, index) => (
                <td
                  key={columns[index].key}
                  className="text-center font-medium tabular-nums text-muted-foreground"
                >
                  {value || ''}
                </td>
              ))}
              <td className="px-2 text-right font-semibold tabular-nums">
                {columnTotals.reduce((sum, value) => sum + value, 0)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

const KIND_LABEL = { dentist: 'Dentist', assistant: 'Assistant' } as const

function clinicianRows(
  seen: SeenCounts,
  values: (c: SeenClinician) => number[],
  links: SeenLinks
): HeatRow[] {
  return seen.clinicians.map((clinician) => ({
    key: clinician.id,
    label: clinician.name,
    sublabel: KIND_LABEL[clinician.kind],
    href: links.clinician(clinician),
    values: values(clinician),
  }))
}

/** One day: the clinic by the hour, then each clinician by the hour. */
export function SeenDay({ seen, links }: { seen: SeenCounts; links: SeenLinks }) {
  const byHour = seen.hours.map((hour, index) => ({
    hour: hourLabel(hour),
    seen: seen.grid[0]?.[index] ?? 0,
  }))
  const hourColumns = seen.hours.map((hour) => ({
    key: String(hour),
    label: hourLabel(hour),
    title: hourRange(hour),
  }))

  return (
    <div className="space-y-6">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={byHour} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={0} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: 'hsl(var(--muted))' }}
            labelStyle={{ color: 'inherit' }}
            formatter={(value) => [value, 'Patients seen']}
          />
          <Bar
            dataKey="seen"
            name="Patients seen"
            fill="hsl(var(--primary))"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

      <HeatTable
        caption="Patients seen by each clinician, by hour"
        corner="Clinician"
        columns={hourColumns}
        rows={clinicianRows(seen, (c) => c.byHour, links)}
        totals
      />
    </div>
  )
}

/** A week: the clinic by day and hour, then each clinician by day. */
export function SeenWeek({ seen, links }: { seen: SeenCounts; links: SeenLinks }) {
  const dayColumns = seen.days.map((day) => ({
    key: day,
    label: `${weekdayShort(day)} ${dayMonth(day)}`,
    title: `${weekdayShort(day)} ${dayMonth(day)}`,
    href: links.day(day),
  }))
  const hourColumns = seen.hours.map((hour) => ({
    key: String(hour),
    label: hourLabel(hour),
    title: hourRange(hour),
  }))

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Each clinician, by day</h3>
        <HeatTable
          caption="Patients seen by each clinician, by day"
          corner="Clinician"
          columns={dayColumns}
          rows={clinicianRows(seen, (c) => c.byDay, links)}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">The clinic, by day and hour</h3>
        <HeatTable
          caption="Patients seen at the clinic, by day and hour"
          corner="Day"
          columns={hourColumns}
          rows={seen.days.map((day, index) => ({
            key: day,
            label: `${weekdayShort(day)} ${dayMonth(day)}`,
            href: links.day(day),
            values: seen.grid[index],
          }))}
        />
      </section>
    </div>
  )
}
