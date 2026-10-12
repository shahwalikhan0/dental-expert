'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GridBody, GridPagination } from '@/components/ui/data-grid'
import { ActiveFilters } from '@/components/ui/active-filters'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { ALL_ROLES, ROLE_LABELS } from '@/lib/rbac'
import {
  DEFAULT_REGISTER_PAGE_SIZE,
  LATES_PER_ABSENCE,
  REGISTER_PAGE_SIZES,
  rangeLabel,
  type AttendanceSummary,
} from '@/lib/attendance'
import { DownloadMenu, RangeControls } from '@/components/attendance/range-controls'
import { cn } from '@/lib/utils'
import { ChevronDown, FileSpreadsheet, Search } from 'lucide-react'

/**
 * The attendance report: any range, any roles, and the file to keep.
 *
 * The preview is the totals, a row per person, because that is the question
 * asked of a range — who was away, and how often. The file is the whole
 * register, a column per day, because that is what is kept. Both come from the
 * same query, so the totals on screen are the totals at the end of each row
 * in the spreadsheet.
 */

type RoleKey = keyof typeof ROLE_LABELS

interface ReportRow {
  id: string
  name: string
  role: RoleKey
  clinicalRole: RoleKey | null
  employeeId: string | null
  isActive: boolean
  summary: AttendanceSummary
}

interface ReportResponse {
  from: string
  to: string
  today: string
  workingDays: number
  rows: ReportRow[]
  pagination: { page: number; limit: number; total: number }
  canExport: boolean
}

export default function AttendanceReportPage() {
  const trail = useTrail('Report')
  const { toast } = useToast()

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [roles, setRoles] = useState<RoleKey[]>([])
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(DEFAULT_REGISTER_PAGE_SIZE)

  const [data, setData] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const latestRequest = useRef(0)

  /** The query both the preview and the download are built from. */
  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (roles.length) params.set('role', roles.join(','))
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    return params
  }, [from, to, roles, debouncedSearch])

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    try {
      const params = new URLSearchParams(query)
      params.set('page', String(page))
      params.set('limit', String(limit))
      const res = await fetch(`/api/attendance/report?${params}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'The report could not be built')
      if (requestId !== latestRequest.current) return
      setData(body)
      // The server fills in the month so far when no range was asked for.
      // Adopt it, so the date fields show what the preview is showing.
      if (!from) setFrom(body.from)
      if (!to) setTo(body.to)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'The report could not be built',
        variant: 'destructive',
      })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [query, page, limit, from, to, toast])

  useEffect(() => {
    load()
  }, [load])

  const toggleRole = (role: RoleKey) => {
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role]
    )
    setPage(1)
  }

  const rows = data?.rows ?? []
  const pageTotals = rows.reduce(
    (sum, row) => ({
      present: sum.present + row.summary.present,
      absent: sum.absent + row.summary.absent,
      late: sum.late + row.summary.late,
      lateAbsences: sum.lateAbsences + row.summary.lateAbsences,
      totalAbsent: sum.totalAbsent + row.summary.totalAbsent,
      unmarked: sum.unmarked + row.summary.unmarked,
    }),
    { present: 0, absent: 0, late: 0, lateAbsences: 0, totalAbsent: 0, unmarked: 0 }
  )

  return (
    <div className="space-y-6">
      <BackLink fallback="/attendance" fallbackLabel="Attendance" trail={trail} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Attendance report</h1>
          <p className="text-muted-foreground">
            {data ? rangeLabel(data.from, data.to) : 'Choose a range and the roles to include.'}
          </p>
        </div>
        {data?.canExport && (
          <DownloadMenu
            href={`/api/attendance/report?${query}`}
            disabled={!data || data.pagination.total === 0}
          />
        )}
      </div>

      <RangeControls
        from={from}
        to={to}
        today={data?.today ?? ''}
        onChange={(start, end) => {
          setFrom(start)
          setTo(end)
          setPage(1)
        }}
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Search by name, email or employee ID…"
            className="pl-9"
            aria-label="Search the report"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-[220px] justify-between">
              <span className="truncate">
                {roles.length === 0
                  ? 'All roles'
                  : roles.length === 1
                    ? ROLE_LABELS[roles[0]]
                    : `${roles.length} roles`}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[220px]">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Include these roles
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_ROLES.map((role) => (
              <DropdownMenuCheckboxItem
                key={role}
                checked={roles.includes(role)}
                // Keep the menu open: choosing three roles is three ticks, not
                // three trips back to the button.
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggleRole(role)}
              >
                {ROLE_LABELS[role]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ActiveFilters
        noun="people"
        onClearAll={() => {
          setSearch('')
          setRoles([])
          setPage(1)
        }}
        filters={[
          { label: 'Search', value: search, onClear: () => setSearch('') },
          {
            label: 'Roles',
            value: roles.length ? roles.map((role) => ROLE_LABELS[role]).join(', ') : null,
            onClear: () => setRoles([]),
          },
        ]}
      />

      {data && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Figure label="Working days" value={data.workingDays} hint="Open days up to today" />
          <Figure label="Present" value={pageTotals.present} tone="PRESENT" />
          <Figure label="Late" value={pageTotals.late} tone="LATE" />
          <Figure
            label="Absent"
            value={pageTotals.totalAbsent}
            tone="ABSENT"
            hint={
              pageTotals.lateAbsences > 0
                ? `${pageTotals.absent} marked + ${pageTotals.lateAbsences} from lates`
                : undefined
            }
          />
          <Figure
            label="Not marked"
            value={pageTotals.unmarked}
            hint={pageTotals.unmarked > 0 ? 'Working days nobody saved' : undefined}
          />
        </dl>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Present</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Absent</TableHead>
                <TableHead
                  className="text-right"
                  title={`Absent, plus one for every ${LATES_PER_ABSENCE} lates`}
                >
                  Total absent
                </TableHead>
                <TableHead className="text-right">Off</TableHead>
                <TableHead className="text-right">Not marked</TableHead>
                <TableHead className="text-right">Attendance</TableHead>
              </TableRow>
            </TableHeader>
            <GridBody
              columns={9}
              loading={loading && !data}
              empty={rows.length === 0}
              emptyIcon={FileSpreadsheet}
              emptyTitle="Nobody matches"
              emptyDescription="Nobody on the register matches these filters for this range."
            >
              {rows.map((row) => {
                const href = `/attendance/${row.id}?start=${data?.from}&end=${data?.to}`
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={trail.to(href)} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                      {!row.isActive && (
                        <span className="ml-2 text-xs text-muted-foreground">left</span>
                      )}
                      {row.employeeId && (
                        <div className="text-xs text-muted-foreground">{row.employeeId}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {ROLE_LABELS[row.role]}
                      {row.clinicalRole ? ` + ${ROLE_LABELS[row.clinicalRole]}` : ''}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.summary.present}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        row.summary.late > 0 && 'text-amber-700 dark:text-amber-300'
                      )}
                    >
                      {row.summary.late}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        row.summary.absent > 0 && 'font-medium text-red-700 dark:text-red-300'
                      )}
                    >
                      {row.summary.absent}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        row.summary.totalAbsent > 0 && 'font-medium text-red-700 dark:text-red-300'
                      )}
                      title={
                        row.summary.lateAbsences > 0
                          ? `Includes ${row.summary.lateAbsences} for ${row.summary.late} lates`
                          : undefined
                      }
                    >
                      {row.summary.totalAbsent}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.summary.off}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        row.summary.unmarked > 0 && 'text-amber-700 dark:text-amber-300'
                      )}
                    >
                      {row.summary.unmarked}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.summary.rate === null ? '—' : `${row.summary.rate}%`}
                    </TableCell>
                  </TableRow>
                )
              })}
            </GridBody>
          </Table>

          {data && (
            <GridPagination
              page={page}
              pageSize={limit}
              total={data.pagination.total}
              noun="people"
              pageSizeOptions={REGISTER_PAGE_SIZES}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setLimit(size)
                setPage(1)
              }}
            />
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Every {LATES_PER_ABSENCE} lates in the range count as one absence, in Total absent and in
        Attendance. A working day nobody saved counts as not marked, never as present. The totals
        above are for the people on this page; the download covers everyone who matches.
      </p>
    </div>
  )
}

const FIGURE_TONE: Record<string, string> = {
  PRESENT: 'text-emerald-700 dark:text-emerald-300',
  ABSENT: 'text-red-700 dark:text-red-300',
  LATE: 'text-amber-700 dark:text-amber-300',
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number
  hint?: string
  tone?: keyof typeof FIGURE_TONE
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 text-xl font-semibold tabular-nums', tone && FIGURE_TONE[tone])}>
        {value}
      </dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}
