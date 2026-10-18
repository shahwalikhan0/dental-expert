'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { GridBody, GridPagination } from '@/components/ui/data-grid'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { DateRangeFilter, dateRangeLabel } from '@/components/ui/date-range-filter'
import { BackLink, useTrail } from '@/components/ui/trail'
import { InventoryItemPicker } from '@/components/inventory/inventory-item-picker'
import {
  RECORDABLE_TYPES,
  StockMovementDialog,
  type MovementItem,
} from '@/components/inventory/stock-movement-dialog'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { useListParams } from '@/hooks/use-list-params'
import { useCan } from '@/hooks/use-can'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { statusOptions } from '@/lib/status'
import { readJson } from '@/lib/toast-utils'

/** Every type, for the filter: movements of all kinds appear in the history. */
const ALL_TYPES = statusOptions('stockTransaction')

interface Transaction {
  id: number
  type: string
  itemName: string
  sku: string
  quantity: number
  unitPrice: number
  totalPrice: number
  transactionDate: string
  performedByName: string
  supplierName: string
  batchNumber: string
  notes: string
}

export default function TransactionsPage() {
  const trail = useTrail('Stock transactions')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)
  // Recording a movement is `inventory:write` on the server — held by the
  // assistant, who records chair-side consumption, but not by the dentist or
  // the manager, who read the history only.
  const canWrite = useCan('inventory:write') === true

  /**
   * The item this screen was opened about is the `item` filter.
   *
   * Both ways in carry it — "Stock history" on an inventory row and "Record
   * movement" on an item's own page — and `record=1` says the caller wanted the
   * form rather than the history.
   */
  const list = useListParams({ defaults: { item: '', type: 'all', from: '', to: '' } })
  const range = { from: list.filters.from, to: list.filters.to }
  const query = list
    .apiParams({ rename: { item: 'itemId', from: 'startDate', to: 'endDate' } })
    .toString()

  const [showAddModal, setShowAddModal] = useState(searchParams.get('record') === '1')
  // The filtered item, named for the picker and the chip; and handed to the
  // form when it is still stocked.
  const [handedItem, setHandedItem] = useState<MovementItem | null>(null)
  const itemId = list.filters.item

  useEffect(() => {
    if (!itemId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHandedItem(null)
      return
    }
    if (handedItem?.id === itemId) return
    let cancelled = false
    fetch(`/api/inventory/items/${itemId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.success) setHandedItem(data.data)
      })
      .catch((err) => console.error('Error loading the item:', err))
    return () => {
      cancelled = true
    }
  }, [itemId, handedItem?.id])

  const latestRequest = useRef(0)

  const fetchTransactions = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ data: Transaction[]; pagination: { total: number } }>(
        await fetch(`/api/inventory/transactions?${query}`)
      )
      if (requestId !== latestRequest.current) return
      setTransactions(data.data)
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching transactions:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchTransactions()
  }, [fetchTransactions])

  const setDialogOpen = (open: boolean) => {
    setShowAddModal(open)
    // Closing the form forgets `record=1`, so a refresh shows the history.
    if (!open && searchParams.get('record')) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('record')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }
  }

  const itemLabel = itemId ? (handedItem?.id === itemId ? handedItem.name : 'Selected item') : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock transactions"
        description="Every receipt, issue, adjustment and write-off."
        back={<BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />}
        actions={
          canWrite && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New transaction
            </Button>
          )
        }
      />

      <ListToolbar
        search={
          // The route has no text search; the item is what people look for.
          <InventoryItemPicker
            className="w-full"
            aria-label="Filter by item"
            value={itemId || null}
            selectedLabel={itemLabel}
            onSelect={(item) => list.setFilter('item', item.id)}
            onClear={() => list.setFilter('item', '')}
            // Movements of an item no longer stocked are still history.
            params={{}}
          />
        }
        filters={
          <FilterSelect
            label="Type"
            plural="types"
            value={list.filters.type}
            onValueChange={(type) => list.setFilter('type', type)}
            options={ALL_TYPES}
          />
        }
        date={
          <DateRangeFilter
            label="Transaction"
            value={range}
            onChange={(next) => list.setFilters(next)}
          />
        }
        active={{
          noun: 'transactions',
          onClearAll: list.clear,
          filters: [
            {
              // The item arrives from another screen, so it is the filter
              // most worth naming: a list scoped to one item looks exactly
              // like a clinic with very few movements.
              label: 'Item',
              value: itemLabel,
              onClear: () => list.setFilter('item', ''),
            },
            {
              label: 'Type',
              value: filterValueLabel(ALL_TYPES, list.filters.type),
              onClear: () => list.setFilter('type', 'all'),
            },
            {
              label: 'Date',
              value: dateRangeLabel(range),
              onClear: () => list.setFilters({ from: '', to: '' }),
            },
          ],
        }}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Total amount</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Performed by</TableHead>
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              failed={failed}
              onRetry={fetchTransactions}
              empty={transactions.length === 0}
              emptyIcon={ArrowLeftRight}
              emptyTitle="No stock movements found"
              emptyDescription={
                list.isFiltered
                  ? 'No movement matches these filters.'
                  : 'Every receipt, issue, adjustment and write-off is recorded here. Nothing has moved yet.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'New transaction' : undefined
              }
              onEmptyAction={
                list.isFiltered ? list.clear : canWrite ? () => setDialogOpen(true) : undefined
              }
            >
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>{displayDate(transaction.transactionDate)}</TableCell>
                  <TableCell>
                    <StatusBadge kind="stockTransaction" status={transaction.type} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{transaction.itemName}</div>
                    <div className="text-xs text-muted-foreground">{transaction.sku}</div>
                  </TableCell>
                  <TableCell>{transaction.quantity}</TableCell>
                  <TableCell>{formatCurrency(transaction.unitPrice)}</TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(transaction.totalPrice)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {transaction.supplierName || BLANK}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {transaction.performedByName || BLANK}
                  </TableCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="transactions"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>

      <StockMovementDialog
        // `record=1` in the address does not open the form for a reader.
        open={showAddModal && canWrite}
        onOpenChange={setDialogOpen}
        // Only a stocked item is offered for a new movement.
        initialItem={handedItem && handedItem.isActive !== false ? handedItem : null}
        onRecorded={fetchTransactions}
      />
    </div>
  )
}
