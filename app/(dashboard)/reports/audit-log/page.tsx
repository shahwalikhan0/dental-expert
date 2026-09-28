'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { GridBody, GridPagination } from '@/components/ui/data-grid'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Activity,
  Search,
  Shield,
  UserCog,
  FileText,
  CreditCard,
  Calendar,
  Download,
} from 'lucide-react'
import { format } from 'date-fns'
import { useToast } from '@/hooks/use-toast'
import { downloadCSV } from '@/lib/export-utils'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AUDIT_GROUPS, auditLabel, auditTone } from '@/lib/audit-labels'
import { ActiveFilters } from '@/components/ui/active-filters'

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

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [entityFilter, setEntityFilter] = useState<string>('all')
  const { toast } = useToast()

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchLogs = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (actionFilter !== 'all') params.set('action', actionFilter)
      if (entityFilter !== 'all') params.set('entity', entityFilter)
      const res = await fetch(`/api/audit-log?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setLogs(data.data)
      setTotal(data.pagination.total)
    } catch {
      toast({ title: 'Error', description: 'Failed to load audit logs', variant: 'destructive' })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [page, limit, debouncedSearch, actionFilter, entityFilter, toast])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const exportLogs = () => {
    downloadCSV(
      logs.map((l) => ({
        Date: format(new Date(l.createdAt), 'yyyy-MM-dd HH:mm:ss'),
        User: l.user?.name || 'System',
        Role: l.user?.role || '-',
        Action: auditLabel(l.action),
        Entity: l.entityType,
        'Entity ID': l.entityId || '-',
        Details: l.details || '-',
        IP: l.ipAddress || '-',
      })),
      `audit-log-${format(new Date(), 'yyyy-MM-dd')}`
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Shield className="h-6 w-6" /> Audit Log
          </h1>
          <p className="text-muted-foreground">{total.toLocaleString()} total events</p>
        </div>
        <Button variant="outline" onClick={exportLogs}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Select
          value={actionFilter}
          onValueChange={(v) => {
            setActionFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything</SelectItem>
            {AUDIT_GROUPS.map((group) => (
              <SelectItem key={group.key} value={group.actions.join(',')}>
                {group.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={entityFilter}
          onValueChange={(v) => {
            setEntityFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Entity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            <SelectItem value="Patient">Patient</SelectItem>
            <SelectItem value="Appointment">Appointment</SelectItem>
            <SelectItem value="Invoice">Invoice</SelectItem>
            <SelectItem value="User">User</SelectItem>
            <SelectItem value="Treatment">Treatment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ActiveFilters
        noun="log entries"
        onClearAll={() => {
          setSearch('')
          setActionFilter('all')
          setEntityFilter('all')
          setPage(1)
        }}
        filters={[
          {
            label: 'Search',
            value: search,
            onClear: () => {
              setSearch('')
              setPage(1)
            },
          },
          {
            label: 'Action',
            value:
              actionFilter === 'all'
                ? null
                : (AUDIT_GROUPS.find((g) => g.actions.join(',') === actionFilter)?.label ??
                  'Selected actions'),
            onClear: () => {
              setActionFilter('all')
              setPage(1)
            },
          },
          {
            label: 'Entity',
            value: entityFilter === 'all' ? null : entityFilter,
            onClear: () => {
              setEntityFilter('all')
              setPage(1)
            },
          },
        ]}
      />

      {/* Log entries */}
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
              empty={logs.length === 0}
              emptyIcon={Activity}
              emptyTitle="No audit logs found"
              emptyDescription="No activity matches your current filters. Try adjusting your search criteria."
            >
              {logs.map((log) => {
                const Icon = ENTITY_ICONS[log.entityType] || ENTITY_ICONS.default
                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(log.createdAt), 'MMM dd, yyyy HH:mm:ss')}
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
                      <span className="block truncate">{log.details || '—'}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.ipAddress || '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </GridBody>
          </Table>

          <GridPagination
            page={page}
            pageSize={limit}
            total={total}
            noun="entries"
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setLimit(size)
              setPage(1)
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
