'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useListParams } from '@/hooks/use-list-params'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  FlaskConical,
  Clock,
  CheckCircle,
  XCircle,
  Package,
  Truck,
  Users,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { ExportMenu } from '@/components/ui/export-menu'
import { WORK_TYPES, workTypeLabel } from '@/lib/lab-orders'
import { statusLabel, statusOptions } from '@/lib/status'
import { displayDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/i18n/format'
import { formatPhone } from '@/lib/utils'

interface LabOrder {
  id: string
  orderNumber: string
  patientId: string
  patientName: string
  patientPhone: string
  labVendorId: string
  vendorName: string
  vendorPhone: string
  workType: string
  description: string
  toothNumbers: string
  shadeGuide: string
  orderDate: string
  expectedDate: string
  sentDate: string | null
  receivedDate: string | null
  deliveredDate: string | null
  estimatedCost: number
  actualCost: number | null
  status: string
  qualityCheck: string
  qualityNotes: string | null
  priority: string
  notes: string
  createdByName: string
  createdAt: string
}

interface LabVendor {
  id: string
  name: string
  code: string
}

/** What the status filter offers: every lab order status, as the badge names it. */
const STATUS_OPTIONS = statusOptions('labOrder')

/**
 * `LabOrderPriority` has two values. The filter offered lower-case
 * normal/urgent/rush, which the route passed straight to an enum column.
 */
const PRIORITY_OPTIONS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'URGENT', label: 'Urgent' },
]

const WORK_TYPE_OPTIONS = WORK_TYPES.map((type) => ({ value: type.value, label: type.label }))

export default function LabWorkPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Lab orders')
  const router = useRouter()
  const [orders, setOrders] = useState<LabOrder[]>([])
  const [vendors, setVendors] = useState<LabVendor[]>([])
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  /**
   * Search, filters and page, kept in the address bar, so opening a lab order
   * and coming back — or refreshing, or sharing the link — keeps the view.
   */
  const list = useListParams({
    defaults: { status: 'all', vendor: 'all', workType: 'all', priority: 'all' },
  })
  // What the route is asked, as a string, so the fetch runs once per question.
  // The route reads `vendorId`; a filter left on "all" is not sent.
  const query = list.apiParams({ rename: { vendor: 'vendorId' } }).toString()

  useEffect(() => {
    const fetchVendors = async () => {
      try {
        const response = await fetch('/api/lab-vendors?status=active&sort=name')
        if (!response.ok) throw new Error('Failed to fetch vendors')
        const data = await response.json()
        setVendors(data.data ?? [])
      } catch (error) {
        console.error('Error fetching vendors:', error)
      }
    }
    fetchVendors()
  }, [])

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchOrders = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/lab-orders?${query}`)
      if (!response.ok) throw new Error('Failed to fetch lab orders')
      const data = await response.json()

      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setOrders(data.data ?? [])
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching lab orders:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    // Loading is shown while the fetch is out; that render is the point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrders()
    // The query string is the whole question; `fetchOrders` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Counted from the page on screen, as they always have been.
  const stats = useMemo(
    () => ({
      total: orders.length,
      created: orders.filter((o) => o.status === 'CREATED').length,
      sentToLab: orders.filter((o) => o.status === 'SENT_TO_LAB').length,
      inProgress: orders.filter((o) => o.status === 'IN_PROGRESS').length,
      ready: orders.filter((o) => o.status === 'READY').length,
      delivered: orders.filter((o) => o.status === 'DELIVERED').length,
      cancelled: orders.filter((o) => o.status === 'CANCELLED').length,
    }),
    [orders]
  )

  const vendorOptions = useMemo(
    () => vendors.map((vendor) => ({ value: vendor.id, label: vendor.name })),
    [vendors]
  )

  const priorityLabel = (priority: string) =>
    PRIORITY_OPTIONS.find((p) => p.value === priority)?.label ?? priority

  const statCards = [
    { title: 'Total orders', value: stats.total, icon: Package, tone: 'text-muted-foreground' },
    {
      title: 'Sent to lab',
      value: stats.sentToLab,
      icon: Truck,
      tone: 'text-blue-600 dark:text-blue-400',
    },
    {
      title: 'In progress',
      value: stats.inProgress,
      icon: Clock,
      tone: 'text-yellow-600 dark:text-yellow-400',
    },
    {
      title: 'Ready',
      value: stats.ready,
      icon: CheckCircle,
      tone: 'text-green-600 dark:text-green-400',
    },
    {
      title: 'Delivered',
      value: stats.delivered,
      icon: CheckCircle,
      tone: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      title: 'Cancelled',
      value: stats.cancelled,
      icon: XCircle,
      tone: 'text-red-600 dark:text-red-400',
    },
    { title: 'Created', value: stats.created, icon: Package, tone: 'text-muted-foreground' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lab orders"
        description="Manage lab orders and vendors, and track work in progress"
        actions={
          <>
            <ExportMenu
              filename="lab-orders"
              getData={() =>
                orders.map((o) => ({
                  'Order no': o.orderNumber,
                  Patient: o.patientName,
                  'Patient phone': formatPhone(o.patientPhone),
                  Vendor: o.vendorName,
                  'Work type': workTypeLabel(o.workType),
                  Description: o.description || '',
                  'Tooth numbers': o.toothNumbers || '',
                  'Shade guide': o.shadeGuide || '',
                  'Order date': displayDate(o.orderDate),
                  'Expected date': displayDate(o.expectedDate),
                  'Sent date': displayDate(o.sentDate),
                  'Received date': displayDate(o.receivedDate),
                  'Delivered date': displayDate(o.deliveredDate),
                  'Estimated cost': o.estimatedCost,
                  'Actual cost': o.actualCost ?? '',
                  Status: statusLabel('labOrder', o.status),
                  Priority: priorityLabel(o.priority),
                  'Quality check': o.qualityCheck,
                  Notes: o.notes || '',
                }))
              }
            />
            <Button variant="outline" asChild>
              <Link href="/lab/vendors">
                <Users className="mr-2 h-4 w-4" />
                Manage vendors
              </Link>
            </Button>
            <Button asChild>
              <Link href="/lab/orders/new">
                <Plus className="mr-2 h-4 w-4" />
                New lab order
              </Link>
            </Button>
          </>
        }
      />

      {/* Stats cards — counts of the page on screen. */}
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
        {statCards.map(({ title, value, icon: Icon, tone }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
              <Icon className={`h-4 w-4 ${tone}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search lab orders"
            placeholder="Search by order number, patient or vendor…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Status"
              plural="statuses"
              value={list.filters.status}
              onValueChange={(status) => list.setFilter('status', status)}
              options={STATUS_OPTIONS}
            />
            <FilterSelect
              label="Vendor"
              plural="vendors"
              value={list.filters.vendor}
              onValueChange={(vendor) => list.setFilter('vendor', vendor)}
              options={vendorOptions}
            />
            <FilterSelect
              label="Work type"
              plural="work types"
              value={list.filters.workType}
              onValueChange={(workType) => list.setFilter('workType', workType)}
              options={WORK_TYPE_OPTIONS}
            />
            <FilterSelect
              label="Priority"
              plural="priorities"
              value={list.filters.priority}
              onValueChange={(priority) => list.setFilter('priority', priority)}
              options={PRIORITY_OPTIONS}
            />
          </>
        }
        active={{
          noun: 'lab orders',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Status',
              value:
                list.filters.status === 'all' ? null : statusLabel('labOrder', list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
            {
              label: 'Vendor',
              value:
                list.filters.vendor === 'all'
                  ? null
                  : (vendors.find((v) => v.id === list.filters.vendor)?.name ?? 'Unknown'),
              onClear: () => list.setFilter('vendor', 'all'),
            },
            {
              label: 'Work type',
              value: list.filters.workType === 'all' ? null : workTypeLabel(list.filters.workType),
              onClear: () => list.setFilter('workType', 'all'),
            },
            {
              label: 'Priority',
              value: filterValueLabel(PRIORITY_OPTIONS, list.filters.priority),
              onClear: () => list.setFilter('priority', 'all'),
            },
          ],
        }}
      />

      {/* Orders table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead>Order no.</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Work type</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Order date</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={10}
              loading={loading}
              failed={failed}
              onRetry={fetchOrders}
              empty={orders.length === 0}
              emptyIcon={FlaskConical}
              emptyTitle="No lab orders found"
              emptyDescription={
                list.isFiltered
                  ? 'Nothing is out with a laboratory under these filters.'
                  : 'No lab order has been raised yet.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : 'New lab order'}
              emptyActionHref={list.isFiltered ? undefined : '/lab/orders/new'}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {orders.map((order) => (
                <ClickableRow
                  key={order.id}
                  href={trail.to(`/lab/orders/${order.id}`)}
                  label={`Open lab order ${order.orderNumber}`}
                >
                  <TableCell className="font-medium">{order.orderNumber}</TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{order.patientName}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatPhone(order.patientPhone)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{workTypeLabel(order.workType)}</TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{order.vendorName}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatPhone(order.vendorPhone)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{displayDate(order.orderDate)}</TableCell>
                  <TableCell>{displayDate(order.expectedDate)}</TableCell>
                  <TableCell>
                    <StatusBadge kind="labOrder" status={order.status} />
                  </TableCell>
                  <TableCell>
                    {/* Priority is not a status; urgent is the one worth colouring. */}
                    <Badge variant={order.priority === 'URGENT' ? 'danger' : 'secondary'}>
                      {priorityLabel(order.priority)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(order.estimatedCost)}
                  </TableCell>
                  {/* GridActionsCell carries the `row-actions` class. */}
                  <GridActionsCell>
                    <DropdownMenu>
                      <IconTooltip label="More actions">
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </IconTooltip>
                      <DropdownMenuContent align="end">
                        {/* No "View details": the row itself opens the lab order. */}
                        <DropdownMenuItem
                          onClick={() => router.push(`/lab/orders/${order.id}/edit`)}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit order
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="lab orders"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  )
}
