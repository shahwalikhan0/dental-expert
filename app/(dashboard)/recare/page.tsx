'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useListParams } from '@/hooks/use-list-params'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconTooltip } from '@/components/ui/icon-action'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ClickableRow,
  GridActionsHead,
  GridBody,
  GridPagination,
  SortableHeader,
  type SortControl,
  type SortDirection,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import { useToast } from '@/hooks/use-toast'
import { DUE_BAND_LABELS, RECALL_COOLDOWN_DAYS, daysUntil, type DueBand } from '@/lib/recare'
import type { RecallRun } from '@/lib/recall'
import { communicationPreferences, mayContact } from '@/lib/communication-preferences'
import {
  CalendarClock,
  CalendarPlus,
  Check,
  Clock,
  Loader2,
  Send,
  Settings2,
  X,
} from 'lucide-react'
import { displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

/**
 * The recall list — who should be in the chair and is not booked.
 *
 * Worked band by band, because that is how a practice works it: overdue first,
 * then this month. Each row does one of three things — book them, mark it done,
 * or defer it with a reason — and all three are one click from the list, since
 * this screen exists to be worked through quickly rather than read.
 *
 * The list can also be *worked in bulk*, which is the thing it was missing. A
 * recall list nobody contacts is a report; ticking forty overdue patients and
 * queueing forty messages is the loop closing. Whether it closed is the strip
 * at the top: contacted out of due, and booked out of contacted.
 */

type Channel = 'SMS' | 'EMAIL' | 'WHATSAPP'

interface Recare {
  id: string
  dueDate: string
  lastDoneAt: string | null
  snoozedUntil: string | null
  snoozeReason: string | null
  lastContactedAt: string | null
  contactAttempts: number
  band: DueBand
  recareType: { id: string; name: string; intervalMonths: number }
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string | null
    email: string | null
    communicationPrefs: unknown
  }
}

interface Performance {
  due: number
  contacted: number
  booked: number
  attended: number
  bookingRate: number
  coverage: number
  messagesSent: number
}

const BANDS: DueBand[] = ['OVERDUE', 'DUE_SOON', 'UPCOMING', 'SNOOZED']

const CHANNEL_LABELS: Record<Channel, string> = {
  SMS: 'Text message',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
}

/** The contacted filter; the values are what the route reads as `contacted`. */
const CONTACTED_OPTIONS = [
  { value: 'no', label: 'Not contacted recently' },
  { value: 'yes', label: `Contacted in the last ${RECALL_COOLDOWN_DAYS} days` },
]

function dueLabel(dueDate: string): string {
  const days = daysUntil(dueDate)
  if (days === 0) return 'today'
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  return `in ${days} day${days === 1 ? '' : 's'}`
}

/**
 * Why this patient cannot be sent a recall on this channel, or null.
 *
 * Checked here as well as on the server so the desk sees the refusal before it
 * selects somebody rather than afterwards in a skipped count. The server still
 * decides — this is a courtesy, not the control.
 */
function contactRefusal(recare: Recare, channel: Channel): string | null {
  const verdict = mayContact(
    communicationPreferences(recare.patient.communicationPrefs),
    channel,
    'recallReminders'
  )
  if (!verdict.allowed) return verdict.reason

  if (channel === 'EMAIL' && !recare.patient.email) return 'No email address on file'
  if (channel !== 'EMAIL' && !recare.patient.phone) return 'No phone number on file'

  return null
}

export default function RecarePage() {
  const trail = useTrail('Recare')
  const { toast } = useToast()

  /**
   * The band, search, filters, sort and page, kept in the address bar, so
   * opening a patient and coming back — or refreshing, or sharing the link —
   * keeps the place in the list. The hook debounces the search and goes back
   * to page 1 on any change.
   */
  const list = useListParams({
    defaults: {
      band: 'OVERDUE',
      typeId: 'all',
      contacted: 'all',
      sort: 'dueDate',
      direction: 'asc',
    },
  })
  const band: DueBand = (BANDS as string[]).includes(list.filters.band)
    ? (list.filters.band as DueBand)
    : 'OVERDUE'
  const { typeId, contacted } = list.filters

  /**
   * Column sorting, in the URL with the rest. Ascending, descending, then back
   * to the list's own order — due date, soonest first.
   */
  const sortColumn = list.filters.sort || 'dueDate'
  const sortDirection: SortDirection = list.filters.direction === 'desc' ? 'desc' : 'asc'
  const sort: SortControl = {
    column: sortColumn,
    direction: sortDirection,
    toggle: (column) => {
      if (column !== sortColumn) list.setFilters({ sort: column, direction: 'asc' })
      else if (sortDirection === 'asc') list.setFilters({ direction: 'desc' })
      else list.setFilters({ sort: 'dueDate', direction: 'asc' })
    },
    params: { sort: sortColumn, direction: sortDirection },
  }

  // The search and the two filters — not the band or the sort, which are the
  // view rather than a narrowing of it.
  const filtered = list.query !== '' || typeId !== 'all' || contacted !== 'all'
  const clearFilters = () => {
    list.clear()
    // `clear` puts every filter back, the band and sort included; keep those.
    list.setFilters({ band, sort: sortColumn, direction: sortDirection })
  }

  // What the route is asked, as a string, so the fetch runs once per question.
  const query = (() => {
    const params = list.apiParams()
    params.set('band', band)
    params.set('sort', sortColumn)
    params.set('direction', sortDirection)
    return params.toString()
  })()

  const [recares, setRecares] = useState<Recare[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [types, setTypes] = useState<{ id: string; name: string }[]>([])
  const [performance, setPerformance] = useState<Performance | null>(null)
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [channel, setChannel] = useState<Channel>('SMS')
  const [sending, setSending] = useState(false)

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/recare?${query}`)
      if (!res.ok) throw new Error('The recall list could not be loaded')
      const data = await res.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setRecares(data.recares ?? [])
      setCounts(data.counts ?? {})
      setTotal(data.pagination?.total ?? 0)
      // Selection belongs to the list that was on screen. Keeping ticks across
      // a filter change is how somebody messages a patient they cannot see.
      setSelected(new Set())
    } catch (err) {
      console.error('Error loading the recall list:', err)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // Loading is the effect's job: it fetches and stores what comes back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  useEffect(() => {
    fetch('/api/recare/types')
      .then((res) => res.json())
      .then((data) => setTypes(data.types ?? []))
      .catch(() => setTypes([]))
  }, [])

  const typeOptions = useMemo(
    () => types.map((type) => ({ value: type.id, label: type.name })),
    [types]
  )

  const loadPerformance = useCallback(() => {
    // Reports are a separate permission from the list. Somebody who may work
    // the recall list but not read reports simply does not get the strip.
    fetch('/api/recare/performance?range=this_month')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPerformance(data))
      .catch(() => setPerformance(null))
  }, [])

  useEffect(() => {
    loadPerformance()
  }, [loadPerformance])

  const act = async (recare: Recare, action: 'complete' | 'snooze' | 'unsnooze') => {
    setBusyId(recare.id)
    const who = `${recare.patient.firstName} ${recare.patient.lastName}`
    try {
      const body: Record<string, unknown> = { action }

      if (action === 'snooze') {
        // A month is the deferral a front desk actually makes — "ring me after
        // the holidays". Anything finer belongs on the patient's record.
        const until = new Date()
        until.setMonth(until.getMonth() + 1)
        body.until = until.toISOString().slice(0, 10)
        body.reason = 'Deferred from the recall list'
      }

      await readJson(
        await fetch(`/api/recare/${recare.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      )

      toast(
        toastSuccess(
          action === 'complete'
            ? 'Marked as done'
            : action === 'snooze'
              ? 'Deferred a month'
              : 'Back on the list',
          `${who} · ${recare.recareType.name}`
        )
      )
      await load()
    } catch (err) {
      toast(
        toastError(
          action === 'complete'
            ? `mark ${who}'s recare as done`
            : action === 'snooze'
              ? `defer ${who}'s recare`
              : `put ${who}'s recare back on the list`,
          err
        )
      )
    } finally {
      setBusyId(null)
    }
  }

  /** The rows this channel could actually reach, in the order they are shown. */
  const contactable = useMemo(
    () => recares.filter((recare) => contactRefusal(recare, channel) === null),
    [recares, channel]
  )

  /**
   * The ticks that still mean something.
   *
   * Switching channel can make a selected patient unreachable — somebody with
   * an email address and no mobile, ticked and then switched to SMS. Narrowing
   * the selection as it is read, rather than pruning it in an effect, keeps the
   * tick if the desk switches back and never sends a request the server would
   * only skip.
   */
  const effective = useMemo(() => {
    const reachable = new Set(contactable.map((recare) => recare.id))
    return [...selected].filter((id) => reachable.has(id))
  }, [contactable, selected])

  const allSelected = contactable.length > 0 && effective.length === contactable.length

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(contactable.map((recare) => recare.id)))
  }

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const send = async (force = false) => {
    setSending(true)
    try {
      const data = await readJson<RecallRun>(
        await fetch('/api/recare/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recareIds: effective, channel, force }),
        })
      )

      // A cooling-off skip is the one worth offering to override: the desk
      // usually knows the first message did not land.
      const cooled = data.outcomes.filter((o) => o.reason === 'RECENTLY_CONTACTED').length

      toast({
        title:
          data.queued > 0
            ? `${data.queued} message${data.queued === 1 ? '' : 's'} queued`
            : 'Nothing was queued',
        description: [
          data.queued > 0 && 'They go out in the clinic’s next send window.',
          data.skipped > 0 && `${data.skipped} skipped.`,
          cooled > 0 && `${cooled} were contacted in the last ${RECALL_COOLDOWN_DAYS} days.`,
        ]
          .filter(Boolean)
          .join(' '),
        variant: data.queued === 0 ? 'destructive' : undefined,
      })

      setSelected(new Set())
      await load()
      loadPerformance()
    } catch (err) {
      toast(toastError('queue the recall messages', err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recare"
        description="Patients due to be seen again who have nothing booked."
        actions={
          <Button variant="outline" asChild>
            <Link href={trail.to('/settings/recare')}>
              <Settings2 className="h-4 w-4 mr-2" />
              Recare types
            </Link>
          </Button>
        }
      />

      {performance && performance.due > 0 && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Figure label="Due this month" value={String(performance.due)} />
            <Figure
              label="Contacted"
              value={`${performance.contacted}`}
              hint={`${performance.coverage}% of those due`}
            />
            <Figure
              label="Booked after contact"
              value={`${performance.booked}`}
              hint={`${performance.bookingRate}% of those contacted`}
            />
            <Figure label="Attended" value={String(performance.attended)} />
          </CardContent>
        </Card>
      )}

      <SegmentedControl<DueBand>
        aria-label="Due"
        size="md"
        value={band}
        onChange={(next) => list.setFilter('band', next)}
        options={BANDS.map((option) => ({
          value: option,
          label: DUE_BAND_LABELS[option],
          badge: counts[option] ?? 0,
        }))}
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search the recall list"
            placeholder="Search by name, patient ID or phone…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Recare type"
              plural="recare types"
              value={typeId}
              onValueChange={(value) => list.setFilter('typeId', value)}
              options={typeOptions}
              className="w-full sm:w-[220px]"
            />
            <FilterSelect
              label="Contacted"
              plural="patients"
              value={contacted}
              onValueChange={(value) => list.setFilter('contacted', value)}
              options={CONTACTED_OPTIONS}
              className="w-full sm:w-[260px]"
            />
          </>
        }
        active={{
          noun: 'patients',
          onClearAll: clearFilters,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Recare type',
              value: typeId === 'all' ? null : (filterValueLabel(typeOptions, typeId) ?? 'Unknown'),
              onClear: () => list.setFilter('typeId', 'all'),
            },
            {
              label: 'Contact',
              value: filterValueLabel(CONTACTED_OPTIONS, contacted),
              onClear: () => list.setFilter('contacted', 'all'),
            },
          ],
        }}
      />

      {effective.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3">
          <span className="text-sm font-medium">{effective.length} selected</span>
          <Select value={channel} onValueChange={(value) => setChannel(value as Channel)}>
            <SelectTrigger className="w-[180px]" aria-label="How to contact them">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CHANNEL_LABELS) as Channel[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {CHANNEL_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SubmitButton
            type="button"
            size="sm"
            busy={sending}
            busyLabel="Sending…"
            icon={Send}
            onClick={() => send(false)}
          >
            Send reminder
          </SubmitButton>
          {/* Clears the ticks, not the search: that has its own X in the box. */}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Clear selection
          </Button>
          <span className="text-xs text-muted-foreground">
            Queued for the clinic’s next send window. Anyone contacted in the last{' '}
            {RECALL_COOLDOWN_DAYS} days is skipped.
          </span>
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    disabled={contactable.length === 0}
                    onCheckedChange={toggleAll}
                    aria-label="Select everyone who can be contacted"
                  />
                </TableHead>
                <SortableHeader column="patient" sort={sort}>
                  Patient
                </SortableHeader>
                <TableHead>Recare</TableHead>
                <SortableHeader column="dueDate" sort={sort}>
                  Due
                </SortableHeader>
                <SortableHeader column="lastDone" sort={sort}>
                  Last seen
                </SortableHeader>
                <TableHead>Contacted</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              failed={failed}
              onRetry={load}
              empty={recares.length === 0}
              emptyIcon={CalendarClock}
              emptyTitle={
                filtered
                  ? 'No patients found'
                  : band === 'OVERDUE'
                    ? 'Nobody is overdue'
                    : 'Nothing in this band'
              }
              emptyDescription={
                filtered
                  ? 'Nothing in this band matches these filters.'
                  : band === 'OVERDUE'
                    ? 'That is the number to keep at zero.'
                    : 'Recare falling due in this window will appear here.'
              }
              emptyActionLabel={filtered ? 'Clear the filters' : undefined}
              onEmptyAction={filtered ? clearFilters : undefined}
            >
              {recares.map((recare) => {
                const refusal = contactRefusal(recare, channel)
                return (
                  <ClickableRow
                    key={recare.id}
                    href={trail.to(`/patients/${recare.patient.id}`)}
                    label={`Open ${recare.patient.firstName} ${recare.patient.lastName}`}
                  >
                    <TableCell data-no-row-click onClick={(event) => event.stopPropagation()}>
                      <IconTooltip label={refusal ?? 'Select for a recall message'}>
                        <span className="inline-flex">
                          <Checkbox
                            checked={selected.has(recare.id)}
                            disabled={refusal !== null}
                            onCheckedChange={() => toggleOne(recare.id)}
                            aria-label={`Select ${recare.patient.firstName} ${recare.patient.lastName}`}
                          />
                        </span>
                      </IconTooltip>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {recare.patient.firstName} {recare.patient.lastName}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {recare.patient.patientId}
                        {recare.patient.phone ? ` · ${formatPhone(recare.patient.phone)}` : ''}
                      </div>
                      {refusal && (
                        <div className="text-xs text-muted-foreground italic">{refusal}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>{recare.recareType.name}</div>
                      <div className="text-xs text-muted-foreground">
                        every {recare.recareType.intervalMonths} months
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{displayDate(recare.dueDate)}</span>
                        <StatusBadge kind="recare" status={recare.band} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {dueLabel(recare.dueDate)}
                      </div>
                      {recare.snoozedUntil && (
                        <div className="text-xs text-muted-foreground">
                          deferred to {displayDate(recare.snoozedUntil)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {recare.lastDoneAt ? displayDate(recare.lastDoneAt) : 'Never'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {recare.lastContactedAt ? (
                        <>
                          <div>{displayDate(recare.lastContactedAt)}</div>
                          <div className="text-xs">
                            {recare.contactAttempts} attempt
                            {recare.contactAttempts === 1 ? '' : 's'}
                          </div>
                        </>
                      ) : (
                        'Not yet'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            href={trail.to(
                              `/appointments/new?patientId=${recare.patient.id}&reason=${encodeURIComponent(
                                recare.recareType.name
                              )}`
                            )}
                            data-no-row-click
                          >
                            <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />
                            Book
                          </Link>
                        </Button>
                        {/*
                          Book stays put: it is what the recall list is for,
                          and an invitation nobody can see until they hover
                          over the right row is not an invitation. The two
                          icons beside it fade like every other grid's.
                        */}
                        <span className="row-actions inline-flex gap-1">
                          <IconTooltip label="Mark this recare as done">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === recare.id}
                              onClick={() => act(recare, 'complete')}
                              aria-label="Mark this recare as done"
                            >
                              {busyId === recare.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </IconTooltip>
                          <IconTooltip
                            label={
                              recare.snoozedUntil ? 'Put back on the list' : 'Defer for a month'
                            }
                          >
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === recare.id}
                              onClick={() =>
                                act(recare, recare.snoozedUntil ? 'unsnooze' : 'snooze')
                              }
                              aria-label={
                                recare.snoozedUntil ? 'Put back on the list' : 'Defer for a month'
                              }
                            >
                              <Clock className="h-3.5 w-3.5" />
                            </Button>
                          </IconTooltip>
                        </span>
                      </div>
                    </TableCell>
                  </ClickableRow>
                )
              })}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="patients"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
