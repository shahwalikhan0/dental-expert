'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GridBody, GridPagination } from '@/components/ui/data-grid'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SubmitButton } from '@/components/ui/submit-button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { useListParams } from '@/hooks/use-list-params'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { BLANK, displayDate, displayDateShort } from '@/lib/dates'
import { ALL_ROLES, ROLE_LABELS } from '@/lib/rbac'
import {
  ATTENDANCE_STATUSES,
  DEFAULT_REGISTER_PAGE_SIZE,
  LATES_PER_ABSENCE,
  REGISTER_PAGE_SIZES,
  STATUS_CODE,
  STATUS_LABEL,
  STATUS_TONE,
  addDays,
  blankCode,
  isEditable,
  rangeLabel,
  weekStartOf,
  weekdayLong,
  weekdayShort,
  type AttendanceMark,
  type RegisterCell,
} from '@/lib/attendance'
import { cn } from '@/lib/utils'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Save,
  UserCheck,
  Undo2,
} from 'lucide-react'

/**
 * The attendance register.
 *
 * A week at a time, a row per person, a column per day — the paper register a
 * practice already keeps, so there is nothing to learn. Every past working day
 * starts as Present, because the manager's job is the exceptions: find the
 * two people who were not in and change their letter. Saving then records the
 * week as it stands.
 *
 * Until it is saved, though, a Present is only a suggestion. Those cells are
 * drawn faded and dashed, the save bar counts them, and the report prints
 * them blank — so a week nobody got round to cannot pass for a week everybody
 * attended.
 *
 * The day view is the same register one column wide, with buttons instead of
 * a drop-down, for the manager who marks attendance each morning.
 */

type View = 'week' | 'day'

interface Row {
  id: string
  name: string
  role: keyof typeof ROLE_LABELS
  clinicalRole: keyof typeof ROLE_LABELS | null
  employeeId: string | null
  joinedOn: string
  cells: RegisterCell[]
}

interface Day {
  date: string
  closed: string | null
}

interface RegisterResponse {
  from: string
  to: string
  today: string
  days: Day[]
  rows: Row[]
  pagination: { page: number; limit: number; total: number }
  canWrite: boolean
}

/** What a cell has been changed to. `null` is Off — the day cleared back to closed. */
type Edits = Record<string, AttendanceMark | null>

const cellKey = (userId: string, date: string) => `${userId}|${date}`

/** Up to two initials for the avatar beside a name. */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()

const VIEW_OPTIONS = [
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
] as const satisfies readonly { value: View; label: string }[]

const ROLE_OPTIONS = ALL_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))

/**
 * The marks a save would send, from the page as it stands.
 *
 * Edited cells that differ from what is saved, plus every default nobody
 * touched — saving the register records the whole page, which is what "the
 * week is done" means. Off days that were left Off send nothing: a closed day
 * has no row.
 */
function pendingMarks(rows: Row[], edits: Edits) {
  const marks: { userId: string; date: string; status: AttendanceMark | null }[] = []
  let changed = 0
  let defaults = 0

  for (const row of rows) {
    for (const cell of row.cells) {
      if (!isEditable(cell)) continue
      const key = cellKey(row.id, cell.date)

      if (key in edits) {
        const value = edits[key]
        const same =
          (cell.state === 'MARKED' && value === cell.status) ||
          (cell.state === 'OFF' && value === null)
        if (same) continue
        marks.push({ userId: row.id, date: cell.date, status: value })
        changed += 1
      } else if (cell.state === 'DEFAULT') {
        marks.push({ userId: row.id, date: cell.date, status: cell.status })
        defaults += 1
      }
    }
  }

  return { marks, changed, defaults }
}

export default function AttendancePage() {
  const trail = useTrail('Attendance')
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const [view, setView] = useState<View>('week')
  /** The day the register is looking at; the week around it in week view. Null is today. */
  const [anchor, setAnchor] = useState<string | null>(null)

  /**
   * Search, role and page, kept in the address bar, so opening somebody's
   * record and coming back keeps the register where it was. The week on
   * screen and the view stay in the page: moving a week is not a filter, and
   * does not send the reader back to page 1.
   */
  const list = useListParams({
    defaults: { role: 'all' },
    pageSize: DEFAULT_REGISTER_PAGE_SIZE,
  })

  const [data, setData] = useState<RegisterResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [edits, setEdits] = useState<Edits>({})

  const latestRequest = useRef(0)

  // The whole question, as a string, so the fetch runs once per question.
  const listQuery = list.apiParams().toString()

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams(listQuery)
      params.set('days', view === 'week' ? '7' : '1')
      if (anchor) params.set('start', anchor)

      const body = await readJson<RegisterResponse>(await fetch(`/api/attendance?${params}`))
      if (requestId !== latestRequest.current) return
      setData(body)
      setEdits({})
    } catch (err) {
      if (requestId !== latestRequest.current) return
      setFailed(true)
      toast(toastError('load the register', err))
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [view, anchor, listQuery, toast])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const pending = useMemo(() => pendingMarks(rows, edits), [rows, edits])
  const dirty = pending.changed > 0
  const canWrite = data?.canWrite ?? false

  useUnsavedChanges(dirty && !saving)

  /**
   * Anything that replaces the page asks first when there are edits on it.
   * Agreeing discards them at once, so a second keystroke in the search box
   * does not ask again while the new page loads.
   */
  const leaving = async (next: () => void) => {
    if (dirty) {
      const count = pending.changed
      const ok = await confirm({
        title: `Discard ${count} unsaved ${count === 1 ? 'mark' : 'marks'}?`,
        description:
          'The marks changed on this page have not been saved. Moving on loses them; the saved register is not touched.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
      })
      if (!ok) return
      setEdits({})
    }
    next()
  }

  const valueOf = (row: Row, cell: RegisterCell): AttendanceMark | null => {
    const key = cellKey(row.id, cell.date)
    return key in edits ? edits[key] : cell.status
  }

  const setCell = (row: Row, cell: RegisterCell, value: AttendanceMark | null) => {
    setEdits((current) => ({ ...current, [cellKey(row.id, cell.date)]: value }))
  }

  /** Set one day for everybody on this page who can be marked on it. */
  const setDay = (date: string, value: AttendanceMark | null) => {
    setEdits((current) => {
      const next = { ...current }
      for (const row of rows) {
        const cell = row.cells.find((c) => c.date === date)
        if (!cell || !isEditable(cell)) continue
        // Off only makes sense on a day the clinic was shut.
        if (value === null && !cell.reason) continue
        next[cellKey(row.id, date)] = value
      }
      return next
    })
  }

  const save = async () => {
    if (pending.marks.length === 0) return
    setSaving(true)
    try {
      const body = await readJson<{
        created: number
        updated: number
        cleared: number
        altered: number
      }>(
        await fetch('/api/attendance', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marks: pending.marks }),
        })
      )

      const saved = body.created + body.updated + body.cleared
      toast(
        toastSuccess(
          'Register saved',
          [
            `${saved} day${saved === 1 ? '' : 's'} recorded.`,
            body.altered > 0 &&
              `${body.altered} earlier mark${body.altered === 1 ? ' was' : 's were'} changed.`,
          ]
            .filter(Boolean)
            .join(' ')
        )
      )
      setEdits({})
      await load()
    } catch (err) {
      toast(toastError('save the register', err))
    } finally {
      setSaving(false)
    }
  }

  const days = data?.days ?? []
  const today = data?.today ?? ''
  const step = view === 'week' ? 7 : 1
  const from = data?.from ?? ''
  const canGoForward = !!data && addDays(from, step) <= today

  const move = (target: string) => leaving(() => setAnchor(target))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Every past working day starts as Present. Change the exceptions, then save."
        actions={
          <Button variant="outline" asChild>
            <Link href={trail.to('/attendance/report')}>
              <FileSpreadsheet className="h-4 w-4" />
              Report
            </Link>
          </Button>
        }
      />

      {/*
        Which stretch of the register is on screen, as one bar: the view on the
        left, the period and the arrows that move it in the middle, and the
        jumps (today, a date) on the right — apart from the search and filters
        below, which choose who is on it rather than when.
      */}
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-sm md:flex-row md:items-center md:justify-between">
        <SegmentedControl
          aria-label="View"
          size="md"
          options={VIEW_OPTIONS}
          value={view}
          onChange={(option) =>
            leaving(() => {
              setView(option)
              list.setPage(1)
              // Switching to the day view lands on today when today is in
              // the week on screen, and on the week's Monday otherwise.
              if (option === 'day' && data) {
                setAnchor(today >= data.from && today <= data.to ? today : data.from)
              }
            })
          }
        />

        <div className="flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={view === 'week' ? 'Previous week' : 'Previous day'}
            disabled={!data}
            onClick={() => move(addDays(from, -step))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[11rem] px-2 text-center text-sm font-semibold">
            {data
              ? view === 'week'
                ? rangeLabel(data.from, data.to)
                : `${weekdayLong(data.from)}, ${displayDate(data.from)}`
              : '…'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={view === 'week' ? 'Next week' : 'Next day'}
            disabled={!canGoForward}
            onClick={() => move(addDays(from, step))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={
              !data || (view === 'week' ? data.from === weekStartOf(today) : from === today)
            }
            onClick={() => move(today)}
          >
            Today
          </Button>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            <span className="sr-only">Go to a date</span>
            <Input
              type="date"
              className="h-9 w-[10.5rem]"
              max={today || undefined}
              value={from}
              onChange={(event) => {
                const target = event.target.value
                if (target && (!today || target <= today)) move(target)
              }}
            />
          </label>
        </div>
      </div>

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={(value) => leaving(() => list.setSearch(value))}
            aria-label="Search the register"
            placeholder="Search by name, email or employee ID…"
          />
        }
        filters={
          <FilterSelect
            label="Role"
            plural="roles"
            value={list.filters.role}
            onValueChange={(value) => leaving(() => list.setFilter('role', value))}
            options={ROLE_OPTIONS}
            className="w-full sm:w-[200px]"
          />
        }
        active={{
          noun: 'people',
          onClearAll: () => leaving(list.clear),
          filters: [
            {
              label: 'Search',
              value: list.query,
              onClear: () => leaving(() => list.setSearch('')),
            },
            {
              label: 'Role',
              value: filterValueLabel(ROLE_OPTIONS, list.filters.role),
              onClear: () => leaving(() => list.setFilter('role', 'all')),
            },
          ],
        }}
      />

      <Card>
        {/* The key to the letters, at the head of the register it explains. */}
        <div className="border-b px-4 py-3">
          <Legend />
        </div>
        <CardContent className="overflow-x-auto p-0">
          <Table className={view === 'week' ? 'min-w-[900px]' : 'min-w-[560px]'}>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 min-w-[200px] bg-card">Name</TableHead>
                {days.map((day) => (
                  <DayHeading
                    key={day.date}
                    day={day}
                    today={today}
                    rows={rows}
                    edits={edits}
                    canWrite={canWrite}
                    onSetDay={setDay}
                  />
                ))}
                {view === 'week' && <TableHead className="text-right">Week</TableHead>}
              </TableRow>
            </TableHeader>
            <GridBody
              columns={days.length + (view === 'week' ? 2 : 1)}
              loading={loading && !data}
              failed={failed && !data}
              onRetry={load}
              empty={rows.length === 0}
              emptyIcon={UserCheck}
              emptyTitle={list.isFiltered ? 'Nobody matches' : 'Nobody to mark'}
              emptyDescription={
                list.isFiltered
                  ? 'Nobody on the register matches that search.'
                  : 'Staff appear here once they have accepted their invitation. Your own attendance is marked by somebody else.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : undefined}
              onEmptyAction={list.isFiltered ? () => leaving(list.clear) : undefined}
            >
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="sticky left-0 z-10 bg-card">
                    <div className="flex items-center gap-3">
                      <div
                        aria-hidden="true"
                        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary sm:flex"
                      >
                        {initialsOf(row.name)}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={trail.to(
                            // The week on screen, stopping at today — opening
                            // somebody from last week's register should show
                            // last week, not this one.
                            data
                              ? `/attendance/${row.id}?start=${data.from}&end=${data.to > today ? today : data.to}`
                              : `/attendance/${row.id}`
                          )}
                          className="font-semibold hover:underline"
                        >
                          {row.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {ROLE_LABELS[row.role]}
                          {row.clinicalRole ? ` + ${ROLE_LABELS[row.clinicalRole]}` : ''}
                          {row.employeeId ? ` · ${row.employeeId}` : ''}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.date} className="text-center">
                      {view === 'week' ? (
                        <MarkSelect
                          name={row.name}
                          cell={cell}
                          value={valueOf(row, cell)}
                          edited={cellKey(row.id, cell.date) in edits}
                          disabled={!canWrite || saving}
                          onChange={(value) => setCell(row, cell, value)}
                        />
                      ) : (
                        <MarkButtons
                          name={row.name}
                          cell={cell}
                          value={valueOf(row, cell)}
                          edited={cellKey(row.id, cell.date) in edits}
                          disabled={!canWrite || saving}
                          onChange={(value) => setCell(row, cell, value)}
                        />
                      )}
                    </TableCell>
                  ))}
                  {view === 'week' && (
                    <TableCell className="text-right">
                      <RowTotals values={row.cells.map((cell) => valueOf(row, cell))} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </GridBody>
          </Table>

          {data && (
            <GridPagination
              page={list.page}
              pageSize={list.pageSize}
              total={data.pagination.total}
              noun="people"
              pageSizeOptions={REGISTER_PAGE_SIZES}
              onPageChange={(next) => leaving(() => list.setPage(next))}
              onPageSizeChange={(size) => leaving(() => list.setPageSize(size))}
            />
          )}
        </CardContent>
      </Card>

      {canWrite && pending.marks.length > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-sm">
            {[
              pending.changed > 0 && `${pending.changed} change${pending.changed === 1 ? '' : 's'}`,
              pending.defaults > 0 &&
                `${pending.defaults} day${pending.defaults === 1 ? '' : 's'} not yet saved`,
            ]
              .filter(Boolean)
              .join(' · ')}
            <span className="ml-2 text-muted-foreground">Saving records this page as shown.</span>
          </p>
          <div className="flex gap-2">
            {dirty && (
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEdits({})}>
                <Undo2 className="h-3.5 w-3.5" />
                Discard changes
              </Button>
            )}
            <SubmitButton
              type="button"
              size="sm"
              busy={saving}
              busyLabel="Saving…"
              icon={Save}
              onClick={save}
            >
              Save {pending.marks.length} day{pending.marks.length === 1 ? '' : 's'}
            </SubmitButton>
          </div>
        </div>
      )}

      {ConfirmDialogComponent}
    </div>
  )
}

/**
 * A day's column heading: the date, whether it is done, and — for somebody who
 * may write — a way to set the whole column at once.
 *
 * The text is kept to "Mon 28 Sept" with nothing else readable in it, because
 * the table copies each heading onto its cells as the label a phone's card
 * layout draws.
 */
function DayHeading({
  day,
  today,
  rows,
  edits,
  canWrite,
  onSetDay,
}: {
  day: Day
  today: string
  rows: Row[]
  edits: Edits
  canWrite: boolean
  onSetDay: (date: string, value: AttendanceMark | null) => void
}) {
  const cells = rows.flatMap((row) => {
    const cell = row.cells.find((c) => c.date === day.date)
    return cell ? [{ row, cell }] : []
  })
  const editable = cells.filter(({ cell }) => isEditable(cell))
  const unsaved = editable.filter(
    ({ row, cell }) => cell.state === 'DEFAULT' && !(cellKey(row.id, day.date) in edits)
  ).length
  const future = day.date > today
  const isToday = day.date === today

  return (
    <TableHead
      className={cn(
        'min-w-[76px] text-center align-top',
        isToday && 'bg-primary/5',
        day.closed && 'text-muted-foreground'
      )}
      title={day.closed ?? undefined}
    >
      <div className="flex flex-col items-center gap-0.5 py-1">
        <span className={cn('text-xs uppercase tracking-wide', isToday && 'text-primary')}>
          {weekdayShort(day.date)}
        </span>{' '}
        <span className={cn('font-medium', isToday && 'text-primary')}>
          {displayDateShort(day.date)}
        </span>
        {/*
          Drawn from a data attribute rather than written as text: the table
          copies each heading's text onto its cells as the phone layout's
          label, and "Mon 28 Sept3" is not a label.
        */}
        <span className="flex h-4 items-center" aria-hidden>
          {future ? null : day.closed ? (
            <span
              data-text="Off"
              className="text-[10px] font-normal after:content-[attr(data-text)]"
            />
          ) : unsaved === 0 && editable.length > 0 ? (
            <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          ) : unsaved > 0 ? (
            <span
              data-text={`${unsaved} unsaved`}
              className="text-[10px] font-normal text-amber-700 after:content-[attr(data-text)] dark:text-amber-400"
            />
          ) : null}
        </span>
        {canWrite && !future && editable.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-muted-foreground"
                aria-label={`Set everyone on ${displayDateShort(day.date)}`}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Everyone on this page, {weekdayShort(day.date)} {displayDateShort(day.date)}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ATTENDANCE_STATUSES.map((status) => (
                <DropdownMenuItem key={status} onClick={() => onSetDay(day.date, status)}>
                  <span
                    className={cn(
                      'mr-2 inline-flex h-5 w-5 items-center justify-center rounded text-xs font-semibold',
                      STATUS_TONE[status]
                    )}
                  >
                    {STATUS_CODE[status]}
                  </span>
                  {STATUS_LABEL[status]}
                </DropdownMenuItem>
              ))}
              {day.closed && (
                <DropdownMenuItem onClick={() => onSetDay(day.date, null)}>
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded bg-muted text-[10px]">
                    Off
                  </span>
                  Clinic closed
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </TableHead>
  )
}

interface MarkControlProps {
  name: string
  cell: RegisterCell
  value: AttendanceMark | null
  edited: boolean
  disabled: boolean
  onChange: (value: AttendanceMark | null) => void
}

/** Why a cell cannot be changed, for its tooltip. */
function lockedReason(cell: RegisterCell): string | undefined {
  if (cell.state === 'FUTURE') return 'This day has not happened yet'
  if (cell.state === 'NOT_JOINED') return 'Before this person joined'
  return undefined
}

/**
 * The week view's control: a native drop-down.
 *
 * Native rather than the styled Select, because a week for two hundred people
 * is fourteen hundred of them, and a portalled menu per cell is a page that
 * takes seconds to paint. The native control is also the one a keyboard user
 * can work down a column fastest — tab, type the letter, tab. A deliberate
 * exception to the Radix `Select` standard (docs/UX_STANDARDS.md): it stays
 * 32px high, so the grid keeps its row height, and costs nothing per cell.
 */
function MarkSelect({ name, cell, value, edited, disabled, onChange }: MarkControlProps) {
  if (!isEditable(cell)) {
    return (
      <span
        className="inline-flex h-8 w-12 items-center justify-center text-sm text-muted-foreground"
        title={lockedReason(cell)}
      >
        {blankCode(cell.state) || ''}
      </span>
    )
  }

  // A day the clinic was shut can be put back to Off; a working day cannot,
  // because a working day with nothing recorded is simply unmarked.
  const offerOff = !!cell.reason && (cell.state === 'OFF' || cell.state === 'MARKED')
  const provisional = cell.state === 'DEFAULT' && !edited

  return (
    <select
      aria-label={`${name}, ${weekdayLong(cell.date)} ${displayDateShort(cell.date)}`}
      title={
        provisional
          ? `${cell.reason ? `${cell.reason} · ` : ''}Not saved yet`
          : (cell.note ?? cell.reason ?? undefined)
      }
      disabled={disabled}
      value={value ?? ''}
      onChange={(event) => onChange((event.target.value || null) as AttendanceMark | null)}
      className={cn(
        'h-8 w-12 cursor-pointer appearance-none rounded-md border text-center text-sm font-semibold',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
        value ? STATUS_TONE[value] : 'bg-muted/60 text-muted-foreground',
        provisional && 'border-dashed opacity-60',
        edited && 'ring-2 ring-primary/40'
      )}
    >
      {ATTENDANCE_STATUSES.map((status) => (
        <option key={status} value={status}>
          {STATUS_CODE[status]}
        </option>
      ))}
      {offerOff && <option value="">Off</option>}
    </select>
  )
}

/** The day view's control: three buttons, because one day leaves the room for them. */
function MarkButtons({ name, cell, value, edited, disabled, onChange }: MarkControlProps) {
  if (!isEditable(cell)) {
    return (
      <span className="text-sm text-muted-foreground">
        {lockedReason(cell) ?? blankCode(cell.state)}
      </span>
    )
  }

  const provisional = cell.state === 'DEFAULT' && !edited
  const offerOff = !!cell.reason && (cell.state === 'OFF' || cell.state === 'MARKED')

  return (
    <div
      className={cn('inline-flex gap-1 rounded-lg p-0.5', provisional && 'opacity-60')}
      role="radiogroup"
      aria-label={`${name}, ${weekdayLong(cell.date)} ${displayDateShort(cell.date)}`}
    >
      {ATTENDANCE_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          role="radio"
          aria-checked={value === status}
          disabled={disabled}
          onClick={() => onChange(status)}
          className={cn(
            'h-8 min-w-[4.5rem] rounded-md border px-2 text-xs font-medium transition-colors',
            'disabled:cursor-not-allowed',
            value === status
              ? cn(STATUS_TONE[status], 'border-current', provisional && 'border-dashed')
              : 'text-muted-foreground hover:bg-muted'
          )}
        >
          {STATUS_LABEL[status]}
        </button>
      ))}
      {offerOff && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          disabled={disabled}
          onClick={() => onChange(null)}
          className={cn(
            'h-8 rounded-md border px-2 text-xs font-medium',
            value === null ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
          )}
        >
          Off
        </button>
      )}
    </div>
  )
}

/** P/A/L counts for what the row currently shows, saved or not. */
function RowTotals({ values }: { values: (AttendanceMark | null)[] }) {
  const counts = ATTENDANCE_STATUSES.map((status) => ({
    status,
    count: values.filter((value) => value === status).length,
  })).filter(({ count }) => count > 0)

  if (counts.length === 0) return <span className="text-sm text-muted-foreground">{BLANK}</span>

  return (
    <span className="inline-flex gap-1">
      {counts.map(({ status, count }) => (
        <span
          key={status}
          className={cn(
            'rounded px-1.5 py-0.5 text-xs font-medium tabular-nums',
            STATUS_TONE[status]
          )}
          title={STATUS_LABEL[status]}
        >
          {count}
          {STATUS_CODE[status]}
        </span>
      ))}
    </span>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {ATTENDANCE_STATUSES.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex h-5 w-5 items-center justify-center rounded font-semibold',
              STATUS_TONE[status]
            )}
          >
            {STATUS_CODE[status]}
          </span>
          {STATUS_LABEL[status]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-5 w-7 items-center justify-center rounded bg-muted text-[10px]">
          Off
        </span>
        Clinic closed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-dashed opacity-60">
          P
        </span>
        Not saved yet
      </span>
      <span>Every {LATES_PER_ABSENCE} lates count as one absence in reports.</span>
    </div>
  )
}
