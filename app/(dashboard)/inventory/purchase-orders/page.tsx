'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/i18n/format'
import { ClickableRow, GridPagination } from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'

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
  ORDERED: 'bg-blue-100 text-blue-800',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-800',
  RECEIVED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
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
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Purchase Orders</h1>
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
      </div>

      <div className="bg-background rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">Loading...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No purchase orders yet. Raise one when you next order from a supplier — receiving
            against it is what records the batch and expiry date on the stock.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
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
                    <th
                      key={heading}
                      className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-background divide-y divide-border">
                {orders.map((order) => (
                  <ClickableRow
                    key={order.id}
                    href={trail.to(`/inventory/purchase-orders/${order.id}`)}
                    label={`Open order ${order.orderNumber}`}
                    className="hover:bg-muted/50"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {order.orderNumber}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{order.supplier.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(order.orderDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {order.expectedDate ? formatDate(order.expectedDate) : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{order.lineCount}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {order.outstanding > 0 ? (
                        <span className="font-medium text-amber-700">{order.outstanding}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {formatCurrency(order.totalAmount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          STATUS_STYLES[order.status] ?? 'bg-muted text-foreground'
                        }`}
                      >
                        {statusLabel(order.status)}
                      </span>
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <GridPagination
          page={pagination.page}
          pageSize={pagination.limit}
          total={pagination.total}
          noun="orders"
          onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
          onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
        />
      </div>
    </div>
  )
}
