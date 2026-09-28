'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/i18n/format'
import { ClickableRow, GridBody, GridPagination } from '@/components/ui/data-grid'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClipboardList } from 'lucide-react'
import { useTrail } from '@/components/ui/trail'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'

interface PurchaseOrderRow {
  id: string
  orderNumber: string
  orderDate: string
  expectedDate: string | null
  receivedDate: string | null
  totalAmount: string
  status: string
  supplier: { id: string; name: string }
  lineCount: number
  outstanding: number
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-muted text-foreground',
  ORDERED: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  RECEIVED: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ')
}

export default function PurchaseOrdersPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Purchase Orders')
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [statusFilter, setStatusFilter] = useState('all')
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 })

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchOrders = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
      })
      const response = await fetch(`/api/inventory/purchase-orders?${params}`)
      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      if (data.success) {
        setOrders(data.data)
        setPagination((p) => ({ ...p, total: data.pagination.total }))
      }
    } catch (error) {
      console.error('Error fetching purchase orders:', error)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [debouncedSearch, statusFilter, pagination.page, pagination.limit])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="page-title">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What has been ordered from suppliers, and what is still to arrive.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inventory"
            className="px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/80"
          >
            Back to Inventory
          </Link>
          <Link
            href="/inventory/purchase-orders/new"
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + New Order
          </Link>
        </div>
      </div>

      <div className="bg-background rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Search by order number or supplier..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              // A new filter is a new list; page three of the old one means nothing.
              setPagination((p) => ({ ...p, page: 1 }))
            }}
            className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              // A new filter is a new list; page three of the old one means nothing.
              setPagination((p) => ({ ...p, page: 1 }))
            }}
            className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All orders</option>
            <option value="DRAFT">Draft</option>
            <option value="ORDERED">Placed</option>
            <option value="PARTIALLY_RECEIVED">Part received</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <ActiveFilters
          className="mt-4"
          noun="purchase orders"
          onClearAll={() => {
            setSearch('')
            setStatusFilter('all')
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
              label: 'Status',
              value: statusFilter === 'all' ? null : humanise(statusFilter),
              onClear: () => {
                setStatusFilter('all')
                setPagination((p) => ({ ...p, page: 1 }))
              },
            },
          ]}
        />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                {[
                  'Order',
                  'Supplier',
                  'Ordered',
                  'Expected',
                  'Items',
                  'Outstanding',
                  'Total',
                  'Status',
                ].map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              empty={orders.length === 0}
              emptyIcon={ClipboardList}
              emptyTitle="No purchase orders yet"
              emptyDescription="Raise one when you next order from a supplier — receiving against it is what records the batch and expiry date on the stock."
            >
              {orders.map((order) => (
                <ClickableRow
                  key={order.id}
                  href={trail.to(`/inventory/purchase-orders/${order.id}`)}
                  label={`Open order ${order.orderNumber}`}
                >
                  <TableCell className="font-medium">{order.orderNumber}</TableCell>
                  <TableCell>{order.supplier.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(order.orderDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {order.expectedDate ? formatDate(order.expectedDate) : '—'}
                  </TableCell>
                  <TableCell>{order.lineCount}</TableCell>
                  <TableCell>
                    {order.outstanding > 0 ? (
                      <span className="font-medium text-amber-700 dark:text-amber-300">
                        {order.outstanding}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{formatCurrency(order.totalAmount)}</TableCell>
                  <TableCell>
                    <Badge
                      className={`border-0 ${STATUS_STYLES[order.status] ?? 'bg-muted text-foreground'}`}
                    >
                      {statusLabel(order.status)}
                    </Badge>
                  </TableCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="orders"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
