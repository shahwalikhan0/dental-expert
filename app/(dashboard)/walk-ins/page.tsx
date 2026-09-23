'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { Loader2, Search, UserPlus } from 'lucide-react'
import { displayDate } from '@/lib/dates'
import { ActiveFilters } from '@/components/ui/active-filters'

/**
 * Walk-ins — people the clinic has seen but not registered.
 *
 * The decision queue is the default view, because it is the only one anybody
 * works: who came in, and should they be on the register or not. Converted and
 * discarded are kept because a clinic that saw somebody should be able to say
 * afterwards what became of them.
 */

interface Visitor {
  id: string
  name: string
  phone: string | null
  notes: string | null
  createdAt: string
  convertedAt: string | null
  discardedAt: string | null
  convertedPatient: { id: string; patientId: string } | null
  convertedBy: { id: string; name: string } | null
  discardedBy: { id: string; name: string } | null
  _count: { appointments: number }
}

const STATES = [
  { value: 'open', label: 'To decide' },
  { value: 'converted', label: 'Registered' },
  { value: 'discarded', label: 'Discarded' },
]

export default function WalkInsPage() {
  const trail = useTrail('Walk-ins')
  const { toast } = useToast()
  const sort = useSort({ column: 'createdAt', direction: 'desc' })

  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [state, setState] = useState('open')
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 })

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
        state,
        page: String(pagination.page),
        limit: String(pagination.limit),
      })
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())

      const res = await fetch(`/api/visitors?${params}`)
      if (!res.ok) throw new Error('Walk-ins could not be loaded')
      const data = await res.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setVisitors(data.visitors ?? [])
      setPagination((p) => ({ ...p, total: data.pagination?.total ?? 0 }))
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load walk-ins',
        variant: 'destructive',
      })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [state, debouncedSearch, pagination.page, pagination.limit, toast])

  useEffect(() => {
    // The wait now lives in `useDebouncedValue` above, which `load` depends on.
    // This used to hold a second timer of its own, so a keystroke waited twice.
    load()
  }, [load])

  const rows = [...visitors].sort((a, b) => {
    if (!sort.column) return 0
    const factor = sort.direction === 'asc' ? 1 : -1
    if (sort.column === 'name') return a.name.localeCompare(b.name) * factor
    if (sort.column === 'visits') return (a._count.appointments - b._count.appointments) * factor
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * factor
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Walk-ins</h1>
          <p className="text-muted-foreground">
            Seen but not registered. Register the ones who come back; discard the rest.
          </p>
        </div>
        <Button asChild>
          <Link href={trail.to('/appointments/new?walkIn=1')}>
            <UserPlus className="h-4 w-4 mr-2" />
            New walk-in
          </Link>
        </Button>
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
            placeholder="Search by name or phone…"
            className="pl-9"
            aria-label="Search walk-ins"
          />
        </div>
        <div className="inline-flex rounded-md border p-1">
          {STATES.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={state === option.value ? 'default' : 'ghost'}
              onClick={() => {
                setState(option.value)
                setPagination((p) => ({ ...p, page: 1 }))
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <ActiveFilters
        noun="walk-ins"
        onClearAll={() => {
          setSearch('')
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
        ]}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <SortableHeader column="name" sort={sort}>
                  Name
                </SortableHeader>
                <TableHead>Phone</TableHead>
                <SortableHeader column="visits" sort={sort}>
                  Visits
                </SortableHeader>
                <SortableHeader column="createdAt" sort={sort}>
                  First seen
                </SortableHeader>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    {/* Under a search, "nobody is waiting" is the wrong fact. */}
                    {debouncedSearch
                      ? 'No records found for this search.'
                      : state === 'open'
                        ? 'Nobody is waiting on a decision.'
                        : 'Nothing here yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((visitor) => (
                  <ClickableRow
                    key={visitor.id}
                    href={trail.to(`/walk-ins/${visitor.id}`)}
                    label={`Open ${visitor.name}`}
                  >
                    <TableCell className="font-medium">{visitor.name}</TableCell>
                    <TableCell>{visitor.phone || '—'}</TableCell>
                    <TableCell>{visitor._count.appointments}</TableCell>
                    <TableCell>{displayDate(visitor.createdAt)}</TableCell>
                    <TableCell>
                      {visitor.convertedPatient ? (
                        <Badge variant="outline">
                          Registered · {visitor.convertedPatient.patientId}
                        </Badge>
                      ) : visitor.discardedAt ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Discarded
                        </Badge>
                      ) : (
                        <Badge>To decide</Badge>
                      )}
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
            noun="walk-ins"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
