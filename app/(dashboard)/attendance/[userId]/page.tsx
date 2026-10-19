'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  usePagedRows,
} from '@/components/ui/data-grid'
import { IconTooltip } from '@/components/ui/icon-action'
import { ProfileHeader } from '@/components/ui/profile-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { ROLE_LABELS } from '@/lib/rbac'
import { BLANK, displayDate, displayDateTime } from '@/lib/dates'
import {
  ATTENDANCE_STATUSES,
  REGISTER_PAGE_SIZES,
  STATUS_CODE,
  STATUS_LABEL,
  STATUS_TONE,
  blankCode,
  isEditable,
  rangeLabel,
  weekdayIndex,
  weekdayShort,
  type AttendanceMark,
  type AttendanceSummary,
  type RegisterCell,
} from '@/lib/attendance'
import { DownloadMenu, RangeControls } from '@/components/attendance/range-controls'
import { cn } from '@/lib/utils'
import { Briefcase, CalendarDays, IdCard, Pencil, Save, UserX } from 'lucide-react'

/**
 * One person's attendance.
 *
 * The screen for the conversation — "I was not absent on the ninth" — so every
 * day says who marked it and when, and a day can be corrected here with a note
 * saying why. The calendar above the list is for the other conversation, the
 * one about a pattern: four Mondays in a row reads at a glance on a calendar
 * and not at all in a list.
 */

type RoleKey = keyof typeof ROLE_LABELS

interface RecordDay extends RegisterCell {
  markedBy: string | null
  markedAt: string | null
}

interface RecordResponse {
  person: {
    id: string
    name: string
    email: string
    role: RoleKey
    clinicalRole: RoleKey | null
    isActive: boolean
    employeeId: string | null
    joinedOn: string
  }
  calendar: { today: string }
  days: RecordDay[]
  summary: AttendanceSummary
  from: string
  to: string
  canWrite: boolean
  canExport: boolean
}

export default function AttendanceRecordPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params)
  const searchParams = useSearchParams()
  const { toast } = useToast()

  // `start` and `end`, not `from` and `to`: `from` is the breadcrumb trail's
  // parameter (lib/trail.ts), and a date read out of it is a trail read as a
  // date. With neither, the server opens on the week so far.
  const [from, setFrom] = useState(searchParams.get('start') ?? '')
  const [to, setTo] = useState(searchParams.get('end') ?? '')
  const [data, setData] = useState<RecordResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<RecordDay | null>(null)
  const latestRequest = useRef(0)

  const trail = useTrail(data?.person.name ?? null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return params
  }, [from, to])

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/attendance/${userId}?${query}`)
      if (requestId !== latestRequest.current) return
      // Set both ways: a 404 used to stick, so the record stayed "not found"
      // after a later load for the same person succeeded.
      setMissing(res.status === 404)
      if (res.status === 404) return
      const body = await readJson<RecordResponse>(res)
      if (requestId !== latestRequest.current) return
      setData(body)
      if (!from) setFrom(body.from)
      if (!to) setTo(body.to)
    } catch (err) {
      if (requestId !== latestRequest.current) return
      setFailed(true)
      toast(toastError('load the attendance record', err))
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [userId, query, from, to, toast])

  useEffect(() => {
    load()
  }, [load])

  // Newest first: the day being asked about is almost always a recent one.
  const listed = useMemo(
    () => (data?.days ?? []).filter((day) => day.state !== 'FUTURE').reverse(),
    [data]
  )
  const paged = usePagedRows(listed, 50)

  const backLink = <BackLink fallback="/attendance" fallbackLabel="Attendance" trail={trail} />

  if (missing) {
    return (
      <div className="space-y-4">
        {backLink}
        <EmptyState
          icon={UserX}
          title="Not on the register"
          description="That person is not on this clinic’s attendance register."
          actionLabel="Open the register"
          actionHref={trail.back('/attendance')}
        />
      </div>
    )
  }

  if (!data) {
    if (failed) {
      return (
        <div className="space-y-4">
          {backLink}
          <LoadFailed what="this attendance record" onRetry={load} />
        </div>
      )
    }
    return <PageSkeleton variant="detail" />
  }

  const person = data.person
  const summary = data.summary

  return (
    <div className="space-y-6">
      {/* The person as a profile, as on their staff record: who, their role and
          when they joined, with the download where a record keeps its buttons. */}
      <ProfileHeader
        eyebrow="Attendance"
        name={person.name}
        initials={person.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0))
          .join('')
          .toUpperCase()}
        badges={!person.isActive && <StatusBadge kind="staff" status={false} label="Left" />}
        facts={[
          {
            icon: Briefcase,
            label: `${ROLE_LABELS[person.role]}${
              person.clinicalRole ? ` + ${ROLE_LABELS[person.clinicalRole]}` : ''
            }`,
          },
          ...(person.employeeId ? [{ icon: IdCard, label: person.employeeId }] : []),
          { icon: CalendarDays, label: `Joined ${displayDate(person.joinedOn)}` },
        ]}
        actions={
          data.canExport && (
            <DownloadMenu href={`/api/attendance/${userId}/export?${query}`} disabled={!data} />
          )
        }
      />

      <RangeControls
        from={from}
        to={to}
        today={data?.calendar.today ?? ''}
        onChange={(start, end) => {
          setFrom(start)
          setTo(end)
        }}
      />

      {summary && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label="Present" value={summary.present} tone={STATUS_TONE.PRESENT} />
          <Figure label="Late" value={summary.late} tone={STATUS_TONE.LATE} />
          <Figure
            label="Absent"
            value={summary.totalAbsent}
            tone={STATUS_TONE.ABSENT}
            hint={
              summary.lateAbsences > 0
                ? `${summary.absent} marked + ${summary.lateAbsences} for ${summary.late} lates`
                : undefined
            }
          />
          <Figure label="Off" value={summary.off} />
          <Figure label="Not marked" value={summary.unmarked} />
          <Figure label="Attendance" value={summary.rate === null ? BLANK : `${summary.rate}%`} />
        </dl>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>{rangeLabel(data.from, data.to)}</CardTitle>
            <CardDescription>
              {data.canWrite
                ? 'Choose a day to correct it.'
                : 'Faded days have not been saved yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MonthGrid days={data.days} onChoose={data.canWrite ? setEditing : undefined} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Day by day</CardTitle>
          <CardDescription>Newest first, with who marked each day and when.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto border-t p-0">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Marked by</TableHead>
                {data?.canWrite && <GridActionsHead />}
              </TableRow>
            </TableHeader>
            <GridBody
              columns={data?.canWrite ? 5 : 4}
              loading={loading && !data}
              empty={paged.rows.length === 0}
              emptyIcon={CalendarDays}
              emptyTitle="Nothing in this range"
              emptyDescription="Days appear here once they have happened."
            >
              {paged.rows.map((day) => (
                <TableRow key={day.date}>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{displayDate(day.date)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {weekdayShort(day.date)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusPill day={day} />
                  </TableCell>
                  <TableCell className="max-w-[280px] text-sm text-muted-foreground">
                    {day.note ?? day.reason ?? ''}
                  </TableCell>
                  <TableCell className="text-sm">
                    {day.markedBy ? (
                      <>
                        {day.markedBy}
                        <div className="text-xs text-muted-foreground">
                          {day.markedAt ? displayDateTime(day.markedAt) : ''}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{BLANK}</span>
                    )}
                  </TableCell>
                  {data?.canWrite && (
                    <GridActionsCell>
                      {isEditable(day) && (
                        <IconTooltip label="Correct this day">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Correct ${displayDate(day.date)}`}
                            onClick={() => setEditing(day)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </IconTooltip>
                      )}
                    </GridActionsCell>
                  )}
                </TableRow>
              ))}
            </GridBody>
          </Table>
          <GridPagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="days"
            pageSizeOptions={REGISTER_PAGE_SIZES}
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </CardContent>
      </Card>

      {person && (
        <EditDayDialog
          day={editing}
          personId={person.id}
          personName={person.name}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function Figure({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: number | string
  tone?: string
  hint?: string
}) {
  return (
    <div className={cn('rounded-2xl border p-5 shadow-sm', tone ?? 'bg-card')}>
      <dt className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</dd>
      {hint && <dd className="text-xs opacity-80">{hint}</dd>}
    </div>
  )
}

function StatusPill({ day }: { day: RegisterCell }) {
  if (day.state === 'MARKED' && day.status) {
    return (
      <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_TONE[day.status])}>
        {STATUS_LABEL[day.status]}
      </span>
    )
  }
  if (day.state === 'DEFAULT') {
    return <span className="text-xs text-amber-700 dark:text-amber-400">Not marked</span>
  }
  if (day.state === 'OFF') return <span className="text-xs text-muted-foreground">Off</span>
  if (day.state === 'NOT_JOINED') {
    return <span className="text-xs text-muted-foreground">Before joining</span>
  }
  return null
}

/**
 * The range as calendar months, Monday first.
 *
 * Each month is laid out on its own grid with blanks before the first, so a
 * weekday is always the same column — which is the whole point of drawing it
 * as a calendar.
 */
function MonthGrid({ days, onChoose }: { days: RecordDay[]; onChoose?: (day: RecordDay) => void }) {
  const months = useMemo(() => {
    const groups = new Map<string, RecordDay[]>()
    for (const day of days) {
      const month = day.date.slice(0, 7)
      groups.set(month, [...(groups.get(month) ?? []), day])
    }
    return [...groups]
  }, [days])

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {months.map(([month, list]) => {
        const lead = (weekdayIndex(list[0].date) + 6) % 7
        const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        })
        return (
          <div key={month}>
            <p className="mb-2 text-sm font-medium">{title}</p>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, index) => (
                <span key={index}>{letter}</span>
              ))}
              {Array.from({ length: lead }, (_, index) => (
                <span key={`blank-${index}`} />
              ))}
              {list.map((day) => {
                const marked = day.state === 'MARKED' && day.status
                const shown = day.status
                const clickable = !!onChoose && isEditable(day)
                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={!clickable}
                    onClick={() => onChoose?.(day)}
                    title={`${displayDate(day.date)} — ${
                      marked
                        ? STATUS_LABEL[day.status!]
                        : day.state === 'DEFAULT'
                          ? 'not marked'
                          : (day.reason ?? blankCode(day.state) ?? '')
                    }`}
                    className={cn(
                      'flex aspect-square flex-col items-center justify-center rounded text-[11px] leading-none',
                      clickable && 'cursor-pointer hover:ring-2 hover:ring-primary/40',
                      marked && STATUS_TONE[day.status!],
                      day.state === 'DEFAULT' &&
                        shown &&
                        cn(STATUS_TONE[shown], 'border border-dashed opacity-50'),
                      day.state === 'OFF' && 'bg-muted/70',
                      (day.state === 'FUTURE' || day.state === 'NOT_JOINED') && 'opacity-40'
                    )}
                  >
                    <span className="tabular-nums">{Number(day.date.slice(8, 10))}</span>
                    <span className="mt-0.5 font-semibold">
                      {marked ? STATUS_CODE[day.status!] : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Correct one day, with a note saying why.
 *
 * A note is what turns "someone changed my Tuesday" into "the manager changed
 * my Tuesday because I had a doctor's letter".
 */
function EditDayDialog({
  day,
  personId,
  personName,
  onClose,
  onSaved,
}: {
  day: RecordDay | null
  personId: string
  personName: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { toast } = useToast()
  const [status, setStatus] = useState<AttendanceMark | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  // Reset the form each time a different day is opened — keyed on the date so
  // reopening the same day after a save shows what was saved.
  if (day && openedFor !== day.date) {
    setOpenedFor(day.date)
    setStatus(day.status)
    setNote(day.note ?? '')
  }
  if (!day && openedFor !== null) setOpenedFor(null)

  const save = async () => {
    if (!day) return
    setSaving(true)
    try {
      await readJson(
        await fetch('/api/attendance', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marks: [{ userId: personId, date: day.date, status, note: note.trim() || null }],
          }),
        })
      )
      toast(toastSuccess('Day saved', `${personName} · ${displayDate(day.date)}`))
      await onSaved()
    } catch (err) {
      toast(toastError(`save ${displayDate(day.date)}`, err))
    } finally {
      setSaving(false)
    }
  }

  // Off is on offer only for a day the clinic was closed.
  const offerOff = !!day?.reason && (day.state === 'OFF' || day.state === 'MARKED')

  return (
    <Dialog open={!!day} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {personName} — {day ? displayDate(day.date) : ''}
          </DialogTitle>
          <DialogDescription>
            {day?.state === 'MARKED' && day.markedBy
              ? `Marked ${day.status ? STATUS_LABEL[day.status].toLowerCase() : ''} by ${day.markedBy}.`
              : day?.state === 'DEFAULT'
                ? 'Not marked yet.'
                : (day?.reason ?? '')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Status">
            {ATTENDANCE_STATUSES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={status === option}
                onClick={() => setStatus(option)}
                className={cn(
                  'h-9 min-w-[5.5rem] rounded-md border px-3 text-sm font-medium',
                  status === option
                    ? cn(STATUS_TONE[option], 'border-current')
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {STATUS_LABEL[option]}
              </button>
            ))}
            {offerOff && (
              <button
                type="button"
                role="radio"
                aria-checked={status === null}
                onClick={() => setStatus(null)}
                className={cn(
                  'h-9 rounded-md border px-3 text-sm font-medium',
                  status === null ? 'bg-muted' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                Off
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="attendance-note">Note</Label>
            <Textarea
              id="attendance-note"
              value={note}
              maxLength={500}
              rows={3}
              placeholder="Arrived at 10:30, on leave, came in for an emergency…"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            type="button"
            busy={saving}
            busyLabel="Saving…"
            icon={Save}
            onClick={save}
            disabled={status === null && !offerOff}
          >
            Save changes
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
