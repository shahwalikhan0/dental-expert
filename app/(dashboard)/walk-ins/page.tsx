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
import { Loader2, Search, Trash2, UserPlus } from 'lucide-react'
import { displayDate } from '@/lib/dates'
import { ActiveFilters } from '@/components/ui/active-filters'
import { IconTooltip } from '@/components/ui/icon-action'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'

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

/**
 * The list is the decision queue and nothing else.
 *
 * It had three tabs — to decide, registered, discarded — and two of them were
 * archives nobody works. A walk-in has exactly one thing that needs doing to
 * it, so the screen is that one thing, and a row leaves the list once it has
 * been done. What became of somebody is still on their own page, and their
 * visits are still in the appointments list either way.
 */
const STATE = 'open'

export default function WalkInsPage() {
  const trail = useTrail('Walk-ins')
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const sort = useSort({ column: 'createdAt', direction: 'desc' })

  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
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
        state: STATE,
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
  }, [debouncedSearch, pagination.page, pagination.limit, toast])

  useEffect(() => {
    // The wait now lives in `useDebouncedValue` above, which `load` depends on.
    // This used to hold a second timer of its own, so a keystroke waited twice.
    load()
  }, [load])

  /**
   * Discard, from the row.
   *
   * Registering is not here: a patient record needs a first name, a last name
   * and a phone, and the split of a one-box name is a guess — "Muhammad Ali
   * Khan" gets it wrong often enough that committing it silently would put the
   * wrong thing in the surname column of a permanent record. That decision has
   * a screen, and Register goes to it. Discarding needs nothing else, so it
   * happens here.
   */
  const discard = async (visitor: Visitor) => {
    const ok = await confirm({
      title: `Discard ${visitor.name}?`,
      description:
        'Their visits stay on the record. They will leave the list of walk-ins to decide on.',
      confirmLabel: 'Discard',
      variant: 'destructive',
    })
    if (!ok) return

    setBusyId(visitor.id)
    try {
      const res = await fetch(`/api/visitors/${visitor.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not discard this walk-in')

      toast({ title: 'Discarded', description: `${visitor.name} is off the list.` })
      // Re-read rather than dropping the row locally: the count in the pager
      // and the badge in the menu are both now one lower.
      load()
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Could not discard this walk-in',
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

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
          <h1 className="page-title">Walk-ins</h1>
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    {/* Under a search, "nobody is waiting" is the wrong fact. */}
                    {debouncedSearch
                      ? 'No records found for this search.'
                      : 'Nobody is waiting on a decision.'}
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
                    <TableCell className="text-right row-actions">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" asChild>
                          <Link href={trail.to(`/walk-ins/${visitor.id}`)} data-no-row-click>
                            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                            Register
                          </Link>
                        </Button>
                        <IconTooltip label={`Discard ${visitor.name}`}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={busyId === visitor.id}
                            onClick={() => discard(visitor)}
                            aria-label={`Discard ${visitor.name}`}
                          >
                            {busyId === visitor.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </IconTooltip>
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
            noun="walk-ins"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>

      {ConfirmDialogComponent}
    </div>
  )
}
