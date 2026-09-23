'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ClickableRow, GridPagination, SortableHeader, useSort } from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { DUE_BAND_LABELS, daysUntil, type DueBand } from '@/lib/recare'
import { CalendarPlus, Check, Clock, Loader2, Search, Settings2 } from 'lucide-react'
import { displayDate } from '@/lib/dates'
import { ActiveFilters } from '@/components/ui/active-filters'

/**
 * The recall list — who should be in the chair and is not booked.
 *
 * Worked band by band, because that is how a practice works it: overdue first,
 * then this month. Each row does one of three things — book them, mark it done,
 * or defer it with a reason — and all three are one click from the list, since
 * this screen exists to be worked through quickly rather than read.
 */

interface Recare {
  id: string
  dueDate: string
  lastDoneAt: string | null
  snoozedUntil: string | null
  snoozeReason: string | null
  band: DueBand
  recareType: { id: string; name: string; intervalMonths: number }
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string | null
    email: string | null
  }
}

const BANDS: DueBand[] = ['OVERDUE', 'DUE_SOON', 'UPCOMING', 'SNOOZED']

function dueLabel(dueDate: string): string {
  const days = daysUntil(dueDate)
  if (days === 0) return 'today'
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  return `in ${days} day${days === 1 ? '' : 's'}`
}

export default function RecarePage() {
  const trail = useTrail('Recare')
  const { toast } = useToast()
  const sort = useSort({ column: 'dueDate', direction: 'asc' })

  const [recares, setRecares] = useState<Recare[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [types, setTypes] = useState<{ id: string; name: string }[]>([])
  const [band, setBand] = useState<DueBand>('OVERDUE')
  const [typeId, setTypeId] = useState('all')
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0 })

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
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())

      const res = await fetch(`/api/recare?${params}`)
      if (!res.ok) throw new Error('The recall list could not be loaded')
      const data = await res.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setRecares(data.recares ?? [])
      setCounts(data.counts ?? {})
      setPagination((p) => ({ ...p, total: data.pagination?.total ?? 0 }))
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Recare</h1>
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
      </div>

      <ActiveFilters
        noun="patients"
        onClearAll={() => {
          setSearch('')
          setTypeId('all')
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
        ]}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : recares.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    {/*
                      A filtered list needs a different sentence. "Nobody is
                      overdue" is good news and, under a search that matched
                      nothing, it is also false — there may be plenty overdue,
                      none of them called what was typed.
                    */}
                    {debouncedSearch || typeId !== 'all'
                      ? 'No records found for this search.'
                      : band === 'OVERDUE'
                        ? 'Nobody is overdue. That is the number to keep at zero.'
                        : 'Nothing in this band.'}
                  </TableCell>
                </TableRow>
              ) : (
                recares.map((recare) => (
                  <ClickableRow
                    key={recare.id}
                    href={trail.to(`/patients/${recare.patient.id}`)}
                    label={`Open ${recare.patient.firstName} ${recare.patient.lastName}`}
                  >
                    <TableCell>
                      <div className="font-medium">
                        {recare.patient.firstName} {recare.patient.lastName}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {recare.patient.patientId}
                        {recare.patient.phone ? ` · ${recare.patient.phone}` : ''}
                      </div>
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
                ))
              )}
            </TableBody>
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
