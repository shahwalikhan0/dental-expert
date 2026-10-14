'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { useListParams } from '@/hooks/use-list-params'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  SortableHeader,
  useSort,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, Trash2, UserPlus } from 'lucide-react'
import { displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
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
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  // Search and page in the address bar, so opening a walk-in and coming back
  // keeps the list as it was.
  const list = useListParams({ defaults: {} })
  const query = (() => {
    const params = list.apiParams()
    params.set('state', STATE)
    return params.toString()
  })()

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const load = async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ visitors?: Visitor[]; pagination?: { total: number } }>(
        await fetch(`/api/visitors?${query}`)
      )
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setVisitors(data.visitors ?? [])
      setTotal(data.pagination?.total ?? 0)
    } catch (err) {
      console.error('Error fetching walk-ins:', err)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    // The search is debounced by `useListParams`; the query string is the
    // whole question.
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

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
      confirmLabel: 'Discard walk-in',
    })
    if (!ok) return

    setBusyId(visitor.id)
    try {
      await readJson(await fetch(`/api/visitors/${visitor.id}`, { method: 'DELETE' }))

      toast(toastSuccess('Walk-in discarded', `${visitor.name} is off the list.`))
      // Re-read rather than dropping the row locally: the count in the pager
      // and the badge in the menu are both now one lower.
      load()
    } catch (err) {
      toast(toastError(`discard ${visitor.name}`, err))
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
      <PageHeader
        title="Walk-ins"
        description="Seen but not registered. Register the ones who come back; discard the rest."
        actions={
          <Button asChild>
            <Link href={trail.to('/appointments/new?walkIn=1')}>
              <Plus className="h-4 w-4 mr-2" />
              New walk-in
            </Link>
          </Button>
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search walk-ins"
            placeholder="Search by name or phone…"
          />
        }
        active={{
          noun: 'walk-ins',
          onClearAll: list.clear,
          filters: [{ label: 'Search', value: list.query, onClear: () => list.setSearch('') }],
        }}
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
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={6}
              loading={loading}
              failed={failed}
              onRetry={load}
              empty={rows.length === 0}
              emptyIcon={UserPlus}
              emptyTitle={list.isFiltered ? 'No walk-ins found' : 'Nobody is waiting on a decision'}
              emptyDescription={
                list.isFiltered
                  ? 'No walk-in matches that search.'
                  : 'Walk-ins stay here until they are registered as a patient or discarded.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : 'New walk-in'}
              emptyActionHref={list.isFiltered ? undefined : trail.to('/appointments/new?walkIn=1')}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {rows.map((visitor) => (
                <ClickableRow
                  key={visitor.id}
                  href={trail.to(`/walk-ins/${visitor.id}`)}
                  label={`Open ${visitor.name}`}
                >
                  <TableCell className="font-medium">{visitor.name}</TableCell>
                  <TableCell>{formatPhone(visitor.phone) || '—'}</TableCell>
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
                  <GridActionsCell>
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
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="walk-ins"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>

      {ConfirmDialogComponent}
    </div>
  )
}
