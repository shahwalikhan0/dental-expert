'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/i18n/format'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'

interface OrderLine {
  id: string
  itemId: string
  quantity: number
  receivedQty: number
  outstanding: number
  unitPrice: string
  amount: string
  item: {
    id: string
    sku: string
    name: string
    unit: string
    currentStock: number
    batchTracking: boolean
    expiryTracking: boolean
  }
}

interface Receipt {
  id: string
  itemId: string
  quantity: number
  transactionDate: string
  batchNumber: string | null
  batch: { batchNumber: string; expiryDate: string | null } | null
}

interface Order {
  id: string
  orderNumber: string
  orderDate: string
  expectedDate: string | null
  receivedDate: string | null
  subtotal: string
  taxAmount: string
  totalAmount: string
  status: string
  notes: string | null
  supplier: { id: string; name: string; code: string; phone: string | null }
  items: OrderLine[]
  receipts: Receipt[]
}

/** What the clerk is typing in against each line of the delivery note. */
interface ReceiptDraft {
  quantity: string
  batchNumber: string
  expiryDate: string
}

const EMPTY_DRAFT: ReceiptDraft = { quantity: '', batchNumber: '', expiryDate: '' }

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-muted text-foreground',
  ORDERED: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  RECEIVED: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
}

export default function PurchaseOrderPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [order, setOrder] = useState<Order | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(order?.orderNumber ?? null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>({})
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const fetchOrder = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/inventory/purchase-orders/${params.id}`)
      const data = await response.json()
      if (data.success) {
        setOrder(data.data)
        setDrafts({})
      }
    } catch (err) {
      console.error('Error loading purchase order:', err)
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    fetchOrder()
  }, [fetchOrder])

  const setDraft = (lineId: string, changes: Partial<ReceiptDraft>) =>
    setDrafts((current) => ({
      ...current,
      [lineId]: { ...EMPTY_DRAFT, ...current[lineId], ...changes },
    }))

  const patch = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/inventory/purchase-orders/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'That did not work')
        return
      }
      setMessage(done)
      await fetchOrder()
    } finally {
      setBusy(false)
    }
  }

  const receive = async () => {
    setError(null)
    setMessage(null)

    const items = Object.entries(drafts)
      .filter(([, draft]) => Number(draft.quantity) > 0)
      .map(([lineId, draft]) => ({
        lineId,
        quantity: Number(draft.quantity),
        batchNumber: draft.batchNumber || null,
        expiryDate: draft.expiryDate || null,
      }))

    if (items.length === 0) {
      setError('Enter the quantity received against at least one line')
      return
    }

    setBusy(true)
    try {
      const response = await fetch(`/api/inventory/purchase-orders/${params.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, receivedDate }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Could not receive the goods')
        return
      }
      setMessage(data.message)
      await fetchOrder()
    } catch (err) {
      console.error('Error receiving goods:', err)
      setError('Could not receive the goods')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this draft order?',
      description: 'Nothing has been ordered or received against it, so it can be removed.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    const response = await fetch(`/api/inventory/purchase-orders/${params.id}`, {
      method: 'DELETE',
    })
    if (response.ok) router.push('/inventory/purchase-orders')
  }

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>
  if (!order) return <div className="container mx-auto px-4 py-8">Purchase order not found</div>

  const canReceive = order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED'
  const outstanding = order.items.reduce((sum, line) => sum + line.outstanding, 0)

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {ConfirmDialogComponent}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold">{order.orderNumber}</h1>
            <span
              className={`px-2 py-1 text-xs font-semibold rounded-full ${
                STATUS_STYLES[order.status] ?? 'bg-muted text-foreground'
              }`}
            >
              {order.status.charAt(0) + order.status.slice(1).toLowerCase().replace('_', ' ')}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {order.supplier.name} ({order.supplier.code})
            {order.supplier.phone ? ` · ${order.supplier.phone}` : ''}
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/inventory/purchase-orders"
            className="px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/80"
          >
            Back
          </Link>
          {order.status === 'DRAFT' && (
            <>
              <button
                onClick={remove}
                className="px-4 py-2 border border-border rounded-lg hover:bg-muted"
              >
                Delete
              </button>
              <button
                disabled={busy}
                onClick={() => patch({ status: 'ORDERED' }, 'Order placed')}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                Place order
              </button>
            </>
          )}
          {(order.status === 'DRAFT' || order.status === 'ORDERED') && (
            <button
              disabled={busy}
              onClick={() => patch({ status: 'CANCELLED' }, 'Order cancelled')}
              className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 dark:border-red-800/70 dark:text-red-300"
            >
              Cancel order
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-800 text-sm dark:bg-green-950/30 dark:text-green-300">
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Ordered', value: formatDate(order.orderDate) },
          { label: 'Expected', value: order.expectedDate ? formatDate(order.expectedDate) : '—' },
          {
            label: 'Received',
            value: order.receivedDate ? formatDate(order.receivedDate) : '—',
          },
          { label: 'Total', value: formatCurrency(order.totalAmount) },
        ].map((stat) => (
          <div key={stat.label} className="bg-background rounded-lg shadow p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{stat.label}</p>
            <p className="text-lg font-semibold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-background rounded-lg shadow overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-lg font-semibold">Items</h2>
          {outstanding > 0 && (
            <span className="text-sm text-amber-700 dark:text-amber-300">
              {outstanding} still outstanding
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                {['Item', 'Ordered', 'Received', 'Outstanding', 'Unit price', 'Amount'].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
                {canReceive && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Receiving now
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {order.items.map((line) => (
                <tr key={line.id}>
                  <td className="px-6 py-4 text-sm">
                    <div className="font-medium">{line.item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {line.item.sku} · {line.item.currentStock} {line.item.unit} in stock
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm">{line.quantity}</td>
                  <td className="px-6 py-4 text-sm">{line.receivedQty}</td>
                  <td className="px-6 py-4 text-sm">
                    {line.outstanding > 0 ? (
                      <span className="text-amber-700 font-medium dark:text-amber-300">
                        {line.outstanding}
                      </span>
                    ) : (
                      <span className="text-green-700 dark:text-green-300">Complete</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm">{formatCurrency(line.unitPrice)}</td>
                  <td className="px-6 py-4 text-sm">{formatCurrency(line.amount)}</td>

                  {canReceive && (
                    <td className="px-6 py-4">
                      {line.outstanding === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-2 min-w-[14rem]">
                          <input
                            type="number"
                            min={0}
                            max={line.outstanding}
                            placeholder={`up to ${line.outstanding}`}
                            value={drafts[line.id]?.quantity ?? ''}
                            onChange={(e) => setDraft(line.id, { quantity: e.target.value })}
                            className="w-full px-3 py-1.5 border border-border rounded text-sm"
                          />
                          {/* Shown when the item asks for them. An expiry date
                              is the only thing that makes a near-expiry alert
                              possible, and the delivery is the one moment it
                              is knowable. */}
                          {(line.item.batchTracking || line.item.expiryTracking) && (
                            <>
                              <input
                                type="text"
                                placeholder="Batch number"
                                value={drafts[line.id]?.batchNumber ?? ''}
                                onChange={(e) => setDraft(line.id, { batchNumber: e.target.value })}
                                className="w-full px-3 py-1.5 border border-border rounded text-sm"
                              />
                              {line.item.expiryTracking && (
                                <input
                                  type="date"
                                  aria-label={`Expiry date for ${line.item.name}`}
                                  value={drafts[line.id]?.expiryDate ?? ''}
                                  onChange={(e) =>
                                    setDraft(line.id, { expiryDate: e.target.value })
                                  }
                                  className="w-full px-3 py-1.5 border border-border rounded text-sm"
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canReceive && (
          <div className="px-6 py-4 border-t border-border flex items-end justify-between gap-4">
            <div>
              <label htmlFor="receivedDate" className="block text-xs text-muted-foreground mb-1">
                Delivery date
              </label>
              <input
                id="receivedDate"
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                className="px-3 py-2 border border-border rounded-lg text-sm"
              />
            </div>
            <button
              disabled={busy}
              onClick={receive}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              Receive goods
            </button>
          </div>
        )}
      </div>

      {order.receipts.length > 0 && (
        <div className="bg-background rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-lg font-semibold">Deliveries</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Every stock movement booked in against this order.
            </p>
          </div>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                {['Date', 'Item', 'Quantity', 'Batch', 'Expires'].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {order.receipts.map((receipt) => {
                const line = order.items.find((l) => l.itemId === receipt.itemId)
                return (
                  <tr key={receipt.id}>
                    <td className="px-6 py-3 text-sm">{formatDate(receipt.transactionDate)}</td>
                    <td className="px-6 py-3 text-sm">{line?.item.name ?? '—'}</td>
                    <td className="px-6 py-3 text-sm">{receipt.quantity}</td>
                    <td className="px-6 py-3 text-sm">
                      {receipt.batch?.batchNumber ?? receipt.batchNumber ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-sm">
                      {receipt.batch?.expiryDate ? formatDate(receipt.batch.expiryDate) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
