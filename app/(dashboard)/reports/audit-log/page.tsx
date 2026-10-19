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
import { Activity, UserCog, FileText, CreditCard, Calendar } from 'lucide-react'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AUDIT_GROUPS, auditEntityLabel, auditLabel, auditTone } from '@/lib/audit-labels'
import { BLANK, displayDateTime, isoDay } from '@/lib/dates'

interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  /** What the record was, and what it became — either may be missing. */
  oldValues: Record<string, unknown> | string | null
  newValues: Record<string, unknown> | string | null
  /** The patient the record belongs to, where it belongs to one. */
  patient: { id: string; patientNo: string; name: string } | null
  ipAddress: string | null
  createdAt: string
  user: { name: string; email: string; role: string } | null
}

type Values = AuditEntry['oldValues']

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return BLANK
  if (Array.isArray(value)) return value.map(showValue).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * One line per field: `field: before → after` for what changed, `field: value`
 * for what the entry only states (16 Oct, finding 13 — the screen showed the
 * old value alone, so an update read as the record it used to be).
 *
 * An entry with only one side is a creation or a removal, and lists that side
 * as it is rather than a column of arrows to nothing.
 */
function changeLines(before: Values, after: Values): string[] {
  if (typeof before === 'string' || typeof after === 'string') {
    return [before, after].filter((v): v is string => typeof v === 'string' && !!v)
  }
  if (!before && !after) return []
  if (!before) return Object.entries(after!).map(([k, v]) => `${k}: ${showValue(v)}`)
  if (!after) return Object.entries(before).map(([k, v]) => `${k}: was ${showValue(v)}`)

  const lines: string[] = []
  for (const [key, was] of Object.entries(before)) {
    const now = key in after ? showValue(after[key]) : BLANK
    lines.push(`${key}: ${showValue(was)} → ${now}`)
  }
  for (const [key, value] of Object.entries(after)) {
    if (!(key in before)) lines.push(`${key}: ${showValue(value)}`)
  }
  return lines
}

/** The cell shows the first few; all of them are in the tooltip and the export. */
const SHOWN_LINES = 4

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

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  /**
   * The entity filter offers the kinds of record this clinic's log holds, as
   * the route reports them — it used to offer five, typed in here, while the
   * log held twenty-odd.
   */
  const [entityTypes, setEntityTypes] = useState<string[]>([])
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
      setEntityTypes(data.entityTypes ?? [])
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

  const entityOptions = [
    ...new Set([
      ...entityTypes,
      // A filter arriving in the address bar stays nameable before the list loads.
      ...(list.filters.entity !== 'all' ? [list.filters.entity] : []),
    ]),
  ]
    .map((entity) => ({ value: entity, label: auditEntityLabel(entity) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  // The file keeps a sortable timestamp to the second; the screen shows the
  // ordinary date and time.
  const exportRows = () =>
    logs.map((l) => ({
      Date: format(new Date(l.createdAt), 'yyyy-MM-dd HH:mm:ss'),
      User: l.user?.name || 'System',
      Role: l.user?.role || BLANK,
      Action: auditLabel(l.action),
      Entity: auditEntityLabel(l.entityType),
      'Entity ID': l.entityId || BLANK,
      Patient: l.patient ? `${l.patient.name} (${l.patient.patientNo})` : BLANK,
      Changes: changeLines(l.oldValues, l.newValues).join('; ') || BLANK,
      Before: l.oldValues ? showValue(l.oldValues) : BLANK,
      After: l.newValues ? showValue(l.newValues) : BLANK,
      IP: l.ipAddress || BLANK,
    }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description={`${total.toLocaleString()} total events`}
        actions={<ExportMenu filename={`audit-log-${isoDay(new Date())}`} getData={exportRows} />}
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search the audit log"
            placeholder="Search by action, entity or details, before or after…"
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
              options={entityOptions}
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
              value: filterValueLabel(entityOptions, list.filters.entity),
              onClear: () => list.setFilter('entity', 'all'),
            },
          ],
        }}
      />

      {/* Log entries — read-only, so the rows open nothing and carry no actions. */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Change</TableHead>
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
                const lines = changeLines(log.oldValues, log.newValues)
                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {displayDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary"
                        >
                          {(log.user?.name || 'System')
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part.charAt(0))
                            .join('')
                            .toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold">{log.user?.name || 'System'}</div>
                          {log.user?.role && (
                            <div className="text-xs text-muted-foreground">{log.user.role}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={auditTone(log.action)}>
                        {auditLabel(log.action)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {auditEntityLabel(log.entityType)}
                          </div>
                          {log.patient && (
                            <div className="text-xs text-muted-foreground">
                              {log.patient.name} · {log.patient.patientNo}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell
                      className="max-w-[28rem] text-sm text-muted-foreground"
                      title={lines.length ? lines.join('\n') : undefined}
                    >
                      {lines.length === 0
                        ? BLANK
                        : lines.slice(0, SHOWN_LINES).map((line, i) => (
                            <span key={i} className="block truncate">
                              {line}
                            </span>
                          ))}
                      {lines.length > SHOWN_LINES && (
                        <span className="block text-xs">+{lines.length - SHOWN_LINES} more</span>
                      )}
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
