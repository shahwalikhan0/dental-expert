'use client'

import { useEffect, useState, useRef } from 'react'
import { format } from 'date-fns'
import { useListParams } from '@/hooks/use-list-params'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { GridBody, GridPagination } from '@/components/ui/data-grid'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { ExportMenu } from '@/components/ui/export-menu'
import { Activity, Shield, UserCog, FileText, CreditCard, Calendar } from 'lucide-react'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AUDIT_GROUPS, auditLabel, auditTone } from '@/lib/audit-labels'
import { BLANK, displayDateTime, isoDay } from '@/lib/dates'

interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  details: string | null
  ipAddress: string | null
  createdAt: string
  user: { name: string; email: string; role: string } | null
}

/**
 * The badge colour and wording come from lib/audit-labels.ts.
 *
 * They used to be a map of CREATE / UPDATE / DELETE / LOGIN — four values this
 * application has never written — so every badge fell through to the default
 * and the filter beside them returned nothing at all.
 */

const ENTITY_ICONS: Record<string, typeof Activity> = {
  User: UserCog,
  Patient: FileText,
  Appointment: Calendar,
  Invoice: CreditCard,
  default: Activity,
}

/**
 * The action filter offers groups ("Signing in", "Records read"); each group's
 * value is its actions joined by commas, which the route splits.
 */
const ACTION_OPTIONS = AUDIT_GROUPS.map((group) => ({
  value: group.actions.join(','),
  label: group.label,
}))

const ENTITY_OPTIONS = ['Patient', 'Appointment', 'Invoice', 'User', 'Treatment'].map((entity) => ({
  value: entity,
  label: entity,
}))

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  /**
   * Search, filters and page in the address bar. The audit route reads its
   * search as `q`, the one list that does not call it `search`.
   */
  const list = useListParams({
    defaults: { action: 'all', entity: 'all' },
    searchKey: 'q',
  })
  // What the route is asked, as a string, so the fetch runs once per question.
  const query = list.apiParams({ searchParam: 'q' }).toString()

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchLogs = async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/audit-log?${query}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setLogs(data.data)
      setTotal(data.pagination.total)
    } catch {
      // Said in the grid, with a retry, rather than as an empty list.
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
    // The query string is the whole question; `fetchLogs` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // The file keeps a sortable timestamp to the second; the screen shows the
  // ordinary date and time.
  const exportRows = () =>
    logs.map((l) => ({
      Date: format(new Date(l.createdAt), 'yyyy-MM-dd HH:mm:ss'),
      User: l.user?.name || 'System',
      Role: l.user?.role || BLANK,
      Action: auditLabel(l.action),
      Entity: l.entityType,
      'Entity ID': l.entityId || BLANK,
      Details: l.details || BLANK,
      IP: l.ipAddress || BLANK,
    }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Shield className="h-6 w-6" aria-hidden="true" /> Audit log
          </span>
        }
        description={`${total.toLocaleString()} total events`}
        actions={<ExportMenu filename={`audit-log-${isoDay(new Date())}`} getData={exportRows} />}
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search the audit log"
            placeholder="Search by action, entity or details…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Action"
              plural="actions"
              value={list.filters.action}
              onValueChange={(action) => list.setFilter('action', action)}
              options={ACTION_OPTIONS}
            />
            <FilterSelect
              label="Entity"
              plural="entities"
              value={list.filters.entity}
              onValueChange={(entity) => list.setFilter('entity', entity)}
              options={ENTITY_OPTIONS}
            />
          </>
        }
        active={{
          noun: 'log entries',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Action',
              value:
                list.filters.action === 'all'
                  ? null
                  : (filterValueLabel(ACTION_OPTIONS, list.filters.action) ?? 'Selected actions'),
              onClear: () => list.setFilter('action', 'all'),
            },
            {
              label: 'Entity',
              value: filterValueLabel(ENTITY_OPTIONS, list.filters.entity),
              onClear: () => list.setFilter('entity', 'all'),
            },
          ],
        }}
      />

      {/* Log entries — read-only, so the rows open nothing and carry no actions. */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <GridBody
              columns={6}
              loading={loading}
              skeletonRows={8}
              failed={failed}
              onRetry={fetchLogs}
              empty={logs.length === 0}
              emptyIcon={Activity}
              emptyTitle="No audit logs found"
              emptyDescription={
                list.isFiltered
                  ? 'No activity matches these filters.'
                  : 'Nothing has been recorded yet.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : undefined}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {logs.map((log) => {
                const Icon = ENTITY_ICONS[log.entityType] || ENTITY_ICONS.default
                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {displayDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{log.user?.name || 'System'}</div>
                      {log.user?.role && (
                        <div className="text-xs text-muted-foreground">{log.user.role}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={auditTone(log.action)}>
                        {auditLabel(log.action)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm">{log.entityType}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[28rem] text-sm text-muted-foreground">
                      <span className="block truncate">{log.details || BLANK}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.ipAddress || BLANK}
                    </TableCell>
                  </TableRow>
                )
              })}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="entries"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  )
}
