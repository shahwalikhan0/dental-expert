'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconTooltip } from '@/components/ui/icon-action'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  useSort,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
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
  Search,
  Send,
  Settings2,
  X,
} from 'lucide-react'
import { displayDate } from '@/lib/dates'
import { ActiveFilters } from '@/components/ui/active-filters'

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

const CONTACTED_LABELS: Record<string, string> = {
  no: 'Not contacted recently',
  yes: `Contacted in the last ${RECALL_COOLDOWN_DAYS} days`,
}

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
  const sort = useSort({ column: 'dueDate', direction: 'asc' })

  const [recares, setRecares] = useState<Recare[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [types, setTypes] = useState<{ id: string; name: string }[]>([])
  const [performance, setPerformance] = useState<Performance | null>(null)
  const [band, setBand] = useState<DueBand>('OVERDUE')
  const [typeId, setTypeId] = useState('all')
  const [contacted, setContacted] = useState('all')
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0 })

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
    try {
      const params = new URLSearchParams({
        band,
        page: String(pagination.page),
        limit: String(pagination.limit),
        sort: sort.column ?? 'dueDate',
        direction: sort.direction,
      })
      if (typeId !== 'all') params.set('typeId', typeId)
      if (contacted !== 'all') params.set('contacted', contacted)
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())

      const res = await fetch(`/api/recare?${params}`)
      if (!res.ok) throw new Error('The recall list could not be loaded')
      const data = await res.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setRecares(data.recares ?? [])
      setCounts(data.counts ?? {})
      setPagination((p) => ({ ...p, total: data.pagination?.total ?? 0 }))
      // Selection belongs to the list that was on screen. Keeping ticks across
      // a filter change is how somebody messages a patient they cannot see.
      setSelected(new Set())
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load the recall list',
        variant: 'destructive',
      })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [
    band,
    typeId,
    contacted,
    debouncedSearch,
    pagination.page,
    pagination.limit,
    sort.column,
    sort.direction,
    toast,
  ])

  useEffect(() => {
    // The wait now lives in `useDebouncedValue` above, which `load` depends on.
    // This used to hold a second timer of its own, so a keystroke waited twice.
    load()
  }, [load])

  useEffect(() => {
    fetch('/api/recare/types')
      .then((res) => res.json())
      .then((data) => setTypes(data.types ?? []))
      .catch(() => setTypes([]))
  }, [])

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

      const res = await fetch(`/api/recare/${recare.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That did not work')

      toast({
        title:
          action === 'complete'
            ? 'Marked as done'
            : action === 'snooze'
              ? 'Deferred a month'
              : 'Back on the list',
        description: `${recare.patient.firstName} ${recare.patient.lastName} · ${recare.recareType.name}`,
      })
      await load()
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'That did not work',
        variant: 'destructive',
      })
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
      const res = await fetch('/api/recare/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recareIds: effective, channel, force }),
      })
      const data: RecallRun & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error || 'The messages were not queued')

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
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'The messages were not queued',
        variant: 'destructive',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Recare</h1>
          <p className="text-muted-foreground">
            Patients due to be seen again who have nothing booked.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={trail.to('/settings/recare')}>
            <Settings2 className="h-4 w-4 mr-2" />
            Recare types
          </Link>
        </Button>
      </div>

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

      <div className="flex flex-wrap gap-2">
        {BANDS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={band === option ? 'default' : 'outline'}
            onClick={() => {
              setBand(option)
              setPagination((p) => ({ ...p, page: 1 }))
            }}
          >
            {DUE_BAND_LABELS[option]}
            <Badge variant="secondary" className="ml-2">
              {counts[option] ?? 0}
            </Badge>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPagination((p) => ({ ...p, page: 1 }))
            }}
            placeholder="Search by name, patient ID or phone…"
            className="pl-9"
            aria-label="Search the recall list"
          />
        </div>
        <Select
          value={typeId}
          onValueChange={(value) => {
            setTypeId(value)
            setPagination((p) => ({ ...p, page: 1 }))
          }}
        >
          <SelectTrigger className="w-[220px]" aria-label="Filter by recare type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All recare types</SelectItem>
            {types.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={contacted}
          onValueChange={(value) => {
            setContacted(value)
            setPagination((p) => ({ ...p, page: 1 }))
          }}
        >
          <SelectTrigger className="w-[220px]" aria-label="Filter by whether they were contacted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Contacted or not</SelectItem>
            <SelectItem value="no">{CONTACTED_LABELS.no}</SelectItem>
            <SelectItem value="yes">{CONTACTED_LABELS.yes}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ActiveFilters
        noun="patients"
        onClearAll={() => {
          setSearch('')
          setTypeId('all')
          setContacted('all')
          setPagination((p) => ({ ...p, page: 1 }))
        }}
        filters={[
          {
            label: 'Search',
            value: search,
            onClear: () => {
              setSearch('')
              setPagination((p) => ({ ...p, page: 1 }))
            },
          },
          {
            label: 'Recare type',
            value:
              typeId === 'all' ? null : (types.find((t) => t.id === typeId)?.name ?? 'Unknown'),
            onClear: () => {
              setTypeId('all')
              setPagination((p) => ({ ...p, page: 1 }))
            },
          },
          {
            label: 'Contact',
            value: contacted === 'all' ? null : CONTACTED_LABELS[contacted],
            onClear: () => {
              setContacted('all')
              setPagination((p) => ({ ...p, page: 1 }))
            },
          },
        ]}
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
          <Button size="sm" disabled={sending} onClick={() => send(false)}>
            {sending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-2 h-3.5 w-3.5" />
            )}
            Send reminder
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Clear
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
              empty={recares.length === 0}
              emptyIcon={CalendarClock}
              emptyTitle={
                debouncedSearch || typeId !== 'all' || contacted !== 'all'
                  ? 'No records found'
                  : band === 'OVERDUE'
                    ? 'Nobody is overdue'
                    : 'Nothing in this band'
              }
              emptyDescription={
                debouncedSearch || typeId !== 'all' || contacted !== 'all'
                  ? 'Nothing in this band matches that search.'
                  : band === 'OVERDUE'
                    ? 'That is the number to keep at zero.'
                    : 'Recare falling due in this window will appear here.'
              }
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
                        {recare.patient.phone ? ` · ${recare.patient.phone}` : ''}
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
                      <div
                        className={
                          recare.band === 'OVERDUE'
                            ? 'text-red-600 font-medium dark:text-red-400'
                            : ''
                        }
                      >
                        {displayDate(recare.dueDate)}
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
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="patients"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
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
