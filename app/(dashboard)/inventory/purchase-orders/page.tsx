'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useListParams } from '@/hooks/use-list-params'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { ClickableRow, GridBody, GridPagination } from '@/components/ui/data-grid'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect } from '@/components/ui/filter-select'
import { ClipboardList, Plus } from 'lucide-react'
import { BackLink, useTrail } from '@/components/ui/trail'
import { readJson } from '@/lib/toast-utils'
import { statusLabel, statusOptions, TONE_TEXT_CLASS } from '@/lib/status'

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

/** Every purchase-order status, as the badge names it. */
const STATUS_OPTIONS = statusOptions('purchaseOrder')

export default function PurchaseOrdersPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Purchase orders')
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  const list = useListParams({ defaults: { status: 'all' } })
  const query = list.apiParams().toString()

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchOrders = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ data: PurchaseOrderRow[]; pagination: { total: number } }>(
        await fetch(`/api/inventory/purchase-orders?${query}`)
      )
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setOrders(data.data)
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching purchase orders:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchOrders()
  }, [fetchOrders])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase orders"
        description="What has been ordered from suppliers, and what is still to arrive."
        back={<BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />}
        actions={
          <Button asChild>
            <Link href="/inventory/purchase-orders/new">
              <Plus className="h-4 w-4 mr-2" />
              New purchase order
            </Link>
          </Button>
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search purchase orders"
            placeholder="Search by order number or supplier…"
          />
        }
        filters={
          <FilterSelect
            label="Status"
            plural="statuses"
            value={list.filters.status}
            onValueChange={(status) => list.setFilter('status', status)}
            options={STATUS_OPTIONS}
          />
        }
        active={{
          noun: 'purchase orders',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Status',
              value:
                list.filters.status === 'all'
                  ? null
                  : statusLabel('purchaseOrder', list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
          ],
        }}
      />

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
              failed={failed}
              onRetry={fetchOrders}
              empty={orders.length === 0}
              emptyIcon={ClipboardList}
              emptyTitle={list.isFiltered ? 'No purchase orders found' : 'No purchase orders yet'}
              emptyDescription={
                list.isFiltered
                  ? 'No order matches these filters.'
                  : 'Raise one when you next order from a supplier — receiving against it is what records the batch and expiry date on the stock.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : 'New purchase order'}
              emptyActionHref={list.isFiltered ? undefined : '/inventory/purchase-orders/new'}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
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
                    {displayDate(order.orderDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {displayDate(order.expectedDate)}
                  </TableCell>
                  <TableCell>{order.lineCount}</TableCell>
                  <TableCell>
                    {order.outstanding > 0 ? (
                      <span className={`font-medium ${TONE_TEXT_CLASS.progress}`}>
                        {order.outstanding}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{BLANK}</span>
                    )}
                  </TableCell>
                  <TableCell>{formatCurrency(order.totalAmount)}</TableCell>
                  <TableCell>
                    <StatusBadge kind="purchaseOrder" status={order.status} />
                  </TableCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="purchase orders"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  )
}
