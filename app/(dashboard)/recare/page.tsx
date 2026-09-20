'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

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
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0 })

  const load = useCallback(async () => {
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
      if (search.trim()) params.set('search', search.trim())

      const res = await fetch(`/api/recare?${params}`)
      if (!res.ok) throw new Error('The recall list could not be loaded')
      const data = await res.json()
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
      setLoading(false)
    }
  }, [band, typeId, search, pagination.page, pagination.limit, sort.column, sort.direction, toast])

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

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
        <Link href={trail.to('/settings/recare')}>
          <Button variant="outline">
            <Settings2 className="h-4 w-4 mr-2" />
            Recare types
          </Button>
        </Link>
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
                    {band === 'OVERDUE'
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
                      <div className={recare.band === 'OVERDUE' ? 'text-red-600 font-medium' : ''}>
                        {shortDate(recare.dueDate)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {dueLabel(recare.dueDate)}
                      </div>
                      {recare.snoozedUntil && (
                        <div className="text-xs text-muted-foreground">
                          deferred to {shortDate(recare.snoozedUntil)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {recare.lastDoneAt ? shortDate(recare.lastDoneAt) : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link
                          href={trail.to(`/appointments/new?patientId=${recare.patient.id}`)}
                          data-no-row-click
                        >
                          <Button size="sm" variant="outline">
                            <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />
                            Book
                          </Button>
                        </Link>
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
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === recare.id}
                          onClick={() => act(recare, recare.snoozedUntil ? 'unsnooze' : 'snooze')}
                          aria-label={
                            recare.snoozedUntil ? 'Put back on the list' : 'Defer for a month'
                          }
                        >
                          <Clock className="h-3.5 w-3.5" />
                        </Button>
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
