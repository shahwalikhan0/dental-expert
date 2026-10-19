'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { useListParams } from '@/hooks/use-list-params'
import { readJson, toastError } from '@/lib/toast-utils'
import { BLANK } from '@/lib/dates'
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
import { ChevronDown, FileSpreadsheet } from 'lucide-react'

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

  /**
   * Range, roles, search and page, kept in the address bar, so opening
   * somebody's record from the report and coming back keeps the report. The
   * roles are one comma-separated value, as the route takes them.
   */
  const list = useListParams({
    defaults: { from: '', to: '', role: '' },
    pageSize: DEFAULT_REGISTER_PAGE_SIZE,
  })
  const roles = useMemo(
    () =>
      list.filters.role
        .split(',')
        .filter((role): role is RoleKey => (ALL_ROLES as readonly string[]).includes(role)),
    [list.filters.role]
  )

  const [data, setData] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const latestRequest = useRef(0)

  // The whole question, as a string, so the fetch runs once per question.
  const listQuery = list.apiParams().toString()

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const body = await readJson<ReportResponse>(
        await fetch(`/api/attendance/report?${listQuery}`)
      )
      if (requestId !== latestRequest.current) return
      setData(body)
    } catch (err) {
      if (requestId !== latestRequest.current) return
      setFailed(true)
      toast(toastError('build the report', err))
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [listQuery, toast])

  useEffect(() => {
    load()
  }, [load])

  // The server fills in the month so far when no range was asked for. The
  // date fields show that range, and the download asks for it by name, so the
  // file is the range the preview is showing.
  const from = list.filters.from || data?.from || ''
  const to = list.filters.to || data?.to || ''

  /** The query the download is built from: the preview's, without the page. */
  const downloadQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (roles.length) params.set('role', roles.join(','))
    if (list.query) params.set('search', list.query)
    return params
  }, [from, to, roles, list.query])

  const toggleRole = (role: RoleKey) => {
    const next = roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role]
    list.setFilter('role', next.join(','))
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
      <PageHeader
        title="Attendance report"
        description={
          data ? rangeLabel(data.from, data.to) : 'Choose a range and the roles to include.'
        }
        back={<BackLink fallback="/attendance" fallbackLabel="Attendance" trail={trail} />}
        actions={
          data?.canExport && (
            <DownloadMenu
              href={`/api/attendance/report?${downloadQuery}`}
              disabled={!data || data.pagination.total === 0}
            />
          )
        }
      />

      <RangeControls
        from={from}
        to={to}
        today={data?.today ?? ''}
        onChange={(start, end) => list.setFilters({ from: start, to: end })}
      />

      {/* The range's totals first, under the range that sets them, then who to
          include and the row per person. */}
      {data && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search the report"
            placeholder="Search by name, email or employee ID…"
          />
        }
        filters={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between sm:w-[220px]"
                aria-label="Roles"
              >
                <span className="truncate">
                  {roles.length === 0
                    ? 'All roles'
                    : roles.length === 1
                      ? ROLE_LABELS[roles[0]]
                      : `${roles.length} roles`}
                </span>
                <ChevronDown className="h-4 w-4 opacity-60" />
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
        }
        active={{
          noun: 'people',
          // The range is not a filter to clear: there is always one.
          onClearAll: () => {
            list.setSearch('')
            list.setFilter('role', '')
          },
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Roles',
              value: roles.length ? roles.map((role) => ROLE_LABELS[role]).join(', ') : null,
              onClear: () => list.setFilter('role', ''),
            },
          ],
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>By person</CardTitle>
          <CardDescription>
            Every {LATES_PER_ABSENCE} lates in the range count as one absence, in Total absent and
            in Attendance. A working day nobody saved counts as not marked, never as present. The
            totals above are for the people on this page; the download covers everyone who matches.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto border-t p-0">
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
              failed={failed && !data}
              onRetry={load}
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
                      <div className="flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary"
                        >
                          {row.name
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part.charAt(0))
                            .join('')
                            .toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <Link href={trail.to(href)} className="font-semibold hover:underline">
                            {row.name}
                          </Link>
                          {!row.isActive && (
                            <span className="ml-2 text-xs text-muted-foreground">left</span>
                          )}
                          {row.employeeId && (
                            <div className="text-xs text-muted-foreground">{row.employeeId}</div>
                          )}
                        </div>
                      </div>
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
                      {row.summary.rate === null ? BLANK : `${row.summary.rate}%`}
                    </TableCell>
                  </TableRow>
                )
              })}
            </GridBody>
          </Table>

          {data && (
            <GridPagination
              page={list.page}
              pageSize={list.pageSize}
              total={data.pagination.total}
              noun="people"
              pageSizeOptions={REGISTER_PAGE_SIZES}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          )}
        </CardContent>
      </Card>
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
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-2xl font-bold tracking-tight tabular-nums',
          tone && FIGURE_TONE[tone]
        )}
      >
        {value}
      </dd>
      {hint && <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}
