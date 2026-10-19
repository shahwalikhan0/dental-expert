'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { addDays, monthEndOf, monthStartOf, weekStartOf } from '@/lib/attendance'
import { cn } from '@/lib/utils'

/**
 * The date range and the download, shared by the clinic report and one
 * person's record so the two ask the same question the same way.
 */

interface Preset {
  label: string
  range: (today: string) => [string, string]
}

const PRESETS: Preset[] = [
  { label: 'This week', range: (today) => [weekStartOf(today), today] },
  {
    label: 'Last week',
    range: (today) => {
      const start = addDays(weekStartOf(today), -7)
      return [start, addDays(start, 6)]
    },
  },
  { label: 'This month', range: (today) => [monthStartOf(today), today] },
  {
    label: 'Last month',
    range: (today) => {
      const end = addDays(monthStartOf(today), -1)
      return [monthStartOf(end), monthEndOf(end)]
    },
  },
  {
    label: 'Last 3 months',
    range: (today) => [monthStartOf(addDays(monthStartOf(today), -62)), today],
  },
  { label: 'This year', range: (today) => [`${today.slice(0, 4)}-01-01`, today] },
]

export function RangeControls({
  from,
  to,
  today,
  onChange,
}: {
  from: string
  to: string
  today: string
  onChange: (from: string, to: string) => void
}) {
  return (
    // One bar for the question "which days": the two dates on the left, the
    // usual ranges as pills on the right.
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            From
          </span>
          <Input
            type="date"
            className="h-9 w-[10.5rem]"
            value={from}
            max={to || today || undefined}
            onChange={(event) => event.target.value && onChange(event.target.value, to)}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            To
          </span>
          <Input
            type="date"
            className="h-9 w-[10.5rem]"
            value={to}
            min={from || undefined}
            onChange={(event) => event.target.value && onChange(from, event.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => {
          const [start, end] = today ? preset.range(today) : ['', '']
          const active = start === from && end === to
          return (
            <Button
              key={preset.label}
              size="sm"
              variant={active ? 'default' : 'outline'}
              className="rounded-full"
              disabled={!today}
              onClick={() => onChange(start, end)}
            >
              {preset.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Excel or CSV, as a plain link to the export route.
 *
 * A link rather than a fetch-and-blob: the browser streams the file, names it
 * from the server's `Content-Disposition`, and shows its own progress — and
 * the page is not holding a year's register in memory to hand it over.
 */
export function DownloadMenu({
  href,
  disabled,
  className,
}: {
  /** The export route with its query, without `format`. */
  href: string
  disabled?: boolean
  className?: string
}) {
  const withFormat = (format: 'xlsx' | 'csv') =>
    `${href}${href.includes('?') ? '&' : '?'}format=${format}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled} className={cn(className)}>
          <Download className="h-4 w-4" />
          Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={withFormat('xlsx')} download>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={withFormat('csv')} download>
            <FileText className="mr-2 h-4 w-4" />
            CSV
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
