'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { GridBody, GridPagination } from '@/components/ui/data-grid'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeftRight } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { isoDay } from '@/lib/dates'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'

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
  const { toast } = useToast()
  const searchParams = useSearchParams()
  /**
   * The item this screen was opened about.
   *
   * Both ways in carry it — "Stock History" on an inventory row and "Record
   * movement" on an item's own page — and neither was read, so both landed on
   * every movement the clinic has ever recorded. `record=1` says the caller
   * wanted the form rather than the history.
   */
  const handedItemId = searchParams.get('item') ?? ''
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(searchParams.get('record') === '1')
  const [items, setItems] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [itemFilter, setItemFilter] = useState(handedItemId)
  const [transactionType, setTransactionType] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    pages: 0,
  })

  const [formData, setFormData] = useState({
    type: 'purchase',
    itemId: handedItemId,
    quantity: 0,
    unitPrice: 0,
    transactionDate: isoDay(new Date()),
    supplierId: '',
    notes: '',
  })

  useEffect(() => {
    fetchTransactions()
    fetchItems()
    fetchSuppliers()
  }, [itemFilter, transactionType, startDate, endDate, pagination.page])

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(itemFilter && { itemId: itemFilter }),
        ...(transactionType && { type: transactionType }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })

      const response = await fetch(`/api/inventory/transactions?${params}`)
      const data = await response.json()

      if (data.success) {
        setTransactions(data.data)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchItems = async () => {
    try {
      const response = await fetch('/api/inventory/items?status=active&limit=1000')
      const data = await response.json()
      if (data.success) {
        setItems(data.data)
      }
    } catch (error) {
      console.error('Error fetching items:', error)
    }
  }

  const fetchSuppliers = async () => {
    try {
      const response = await fetch('/api/inventory/suppliers?status=active&sort=name')
      const data = await response.json()
      if (data.success) {
        setSuppliers(data.data)
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target

    if (type === 'number') {
      setFormData({ ...formData, [name]: parseFloat(value) || 0 })
    } else {
      setFormData({ ...formData, [name]: value })
    }

    // Auto-fill unit price when item is selected
    if (name === 'itemId' && value) {
      const selectedItem = items.find((item) => item.id === parseInt(value))
      if (selectedItem) {
        setFormData((prev) => ({ ...prev, unitPrice: selectedItem.unitPrice }))
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const response = await fetch('/api/inventory/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (data.success) {
        toast({ title: 'Recorded', description: 'The stock movement has been saved.' })
        setShowAddModal(false)
        fetchTransactions()
        // Reset form
        setFormData({
          type: 'purchase',
          itemId: '',
          quantity: 0,
          unitPrice: 0,
          transactionDate: isoDay(new Date()),
          supplierId: '',
          notes: '',
        })
      } else {
        toast({
          title: 'Error',
          description: data.error || 'The stock movement could not be recorded',
          variant: 'destructive',
        })
      }
    } catch (error) {
      console.error('Error recording transaction:', error)
      toast({
        title: 'Error',
        description: 'The stock movement could not be recorded',
        variant: 'destructive',
      })
    }
  }

  const getTransactionTypeBadge = (type: string) => {
    const badges: any = {
      purchase: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
      sale: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
      adjustment: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300',
      return: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
      usage: 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300',
      wastage: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
      previousStock: 'bg-muted text-foreground',
    }

    return (
      <Badge className={`border-0 ${badges[type] || 'bg-muted text-foreground'}`}>
        {humanise(type)}
      </Badge>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="page-title">Stock Transactions</h1>
        <div className="flex gap-2">
          <Link
            href="/inventory"
            className="px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/80"
          >
            Back to Inventory
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + New Transaction
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-background rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <select
            value={transactionType}
            onChange={(e) => {
              setTransactionType(e.target.value)
              // A new filter is a new list; page three of the old one means nothing.
              setPagination((p) => ({ ...p, page: 1 }))
            }}
            className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            <option value="purchase">Purchase</option>
            <option value="sale">Sale</option>
            <option value="adjustment">Adjustment</option>
            <option value="return">Return</option>
            <option value="usage">Usage</option>
            <option value="wastage">Wastage</option>
          </select>

          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value)
              // A new filter is a new list; page three of the old one means nothing.
              setPagination((p) => ({ ...p, page: 1 }))
            }}
            className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Start Date"
          />

          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value)
              // A new filter is a new list; page three of the old one means nothing.
              setPagination((p) => ({ ...p, page: 1 }))
            }}
            className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="End Date"
          />
        </div>

        <ActiveFilters
          className="mt-4"
          noun="transactions"
          onClearAll={() => {
            setItemFilter('')
            setTransactionType('')
            setStartDate('')
            setEndDate('')
            setPagination((p) => ({ ...p, page: 1 }))
          }}
          filters={[
            {
              // The item arrives from another screen, so it is the filter
              // most worth naming: a list scoped to one item looks exactly
              // like a clinic with very few movements.
              label: 'Item',
              value: itemFilter
                ? (items.find((i) => i.id === itemFilter)?.name ?? 'Selected item')
                : null,
              onClear: () => {
                setItemFilter('')
                setPagination((p) => ({ ...p, page: 1 }))
              },
            },
            {
              label: 'Type',
              value: transactionType ? humanise(transactionType) : null,
              onClear: () => {
                setTransactionType('')
                setPagination((p) => ({ ...p, page: 1 }))
              },
            },
            {
              label: 'From',
              value: startDate,
              onClear: () => {
                setStartDate('')
                setPagination((p) => ({ ...p, page: 1 }))
              },
            },
            {
              label: 'To',
              value: endDate,
              onClear: () => {
                setEndDate('')
                setPagination((p) => ({ ...p, page: 1 }))
              },
            },
          ]}
        />
      </div>

      {/* Transactions Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Performed By</TableHead>
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              empty={transactions.length === 0}
              emptyIcon={ArrowLeftRight}
              emptyTitle="No stock movements found"
              emptyDescription="Every receipt, issue, adjustment and write-off is recorded here. Nothing has moved yet, or nothing matches the filters above."
            >
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    {new Date(transaction.transactionDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{getTransactionTypeBadge(transaction.type)}</TableCell>
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
                    {transaction.supplierName || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {transaction.performedByName}
                  </TableCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="movements"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>

      {/* Add Transaction Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">New Stock Transaction</h2>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Transaction Type <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="purchase">Purchase</option>
                    <option value="adjustment">Adjustment</option>
                    <option value="usage">Usage</option>
                    <option value="wastage">Wastage</option>
                    <option value="return">Return</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Item <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <select
                    name="itemId"
                    value={formData.itemId}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Item</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.sku})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Quantity <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    name="quantity"
                    value={formData.quantity}
                    onChange={handleChange}
                    required
                    step="0.01"
                    className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Unit Price (Rs)
                  </label>
                  <input
                    type="number"
                    name="unitPrice"
                    value={formData.unitPrice}
                    onChange={handleChange}
                    step="0.01"
                    className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Transaction Date <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    name="transactionDate"
                    value={formData.transactionDate}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {formData.type === 'purchase' && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Supplier
                    </label>
                    <select
                      name="supplierId"
                      value={formData.supplierId}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Supplier</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-foreground mb-2">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="mt-6 flex justify-end gap-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-6 py-2 border border-border rounded-lg hover:bg-muted/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Record Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
