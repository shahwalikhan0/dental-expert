'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ClipboardList, PackageCheck, Send, Trash2, XCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { TONE_TEXT_CLASS } from '@/lib/status'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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

type Busy = 'place' | 'cancel' | 'receive' | null

export default function PurchaseOrderPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [order, setOrder] = useState<Order | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(order?.orderNumber ?? null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>({})
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState<Busy>(null)
  const { toast } = useToast()
  // Placing, cancelling, deleting and receiving are all `inventory:write` on
  // the server. A reader (the dentist, the manager) sees the order and its
  // deliveries, without the buttons or the receiving column.
  const canWrite = useCan('inventory:write') === true

  const fetchOrder = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    setNotFound(false)
    try {
      const response = await fetch(`/api/inventory/purchase-orders/${params.id}`)
      if (response.status === 404) {
        setNotFound(true)
        return
      }
      const data = await readJson<{ data: Order }>(response)
      setOrder(data.data)
      setDrafts({})
    } catch (err) {
      console.error('Error loading purchase order:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchOrder()
  }, [fetchOrder])

  const setDraft = (lineId: string, changes: Partial<ReceiptDraft>) =>
    setDrafts((current) => ({
      ...current,
      [lineId]: { ...EMPTY_DRAFT, ...current[lineId], ...changes },
    }))

  const patch = async (
    action: Exclude<Busy, 'receive' | null>,
    body: Record<string, unknown>,
    done: string,
    failure: string
  ) => {
    setBusy(action)
    try {
      await readJson(
        await fetch(`/api/inventory/purchase-orders/${params.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      )
      toast(toastSuccess(done))
      await fetchOrder()
    } catch (err) {
      console.error('Error updating purchase order:', err)
      toast(toastError(failure, err))
    } finally {
      setBusy(null)
    }
  }

  const receive = async () => {
    const items = Object.entries(drafts)
      .filter(([, draft]) => Number(draft.quantity) > 0)
      .map(([lineId, draft]) => ({
        lineId,
        quantity: Number(draft.quantity),
        batchNumber: draft.batchNumber || null,
        expiryDate: draft.expiryDate || null,
      }))

    if (items.length === 0) {
      toast(
        toastError('receive the goods', 'Enter the quantity received against at least one line.')
      )
      return
    }

    setBusy('receive')
    try {
      const data = await readJson<{ message?: string }>(
        await fetch(`/api/inventory/purchase-orders/${params.id}/receive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, receivedDate }),
        })
      )
      toast(toastSuccess('Goods received', data.message))
      await fetchOrder()
    } catch (err) {
      console.error('Error receiving goods:', err)
      toast(toastError('receive the goods', err))
    } finally {
      setBusy(null)
    }
  }

  const cancelOrder = async (current: Order) => {
    const ok = await confirm({
      title: `Cancel purchase order ${current.orderNumber}?`,
      description: 'It is kept, marked cancelled, and nothing more can be received against it.',
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
    })
    if (!ok) return
    await patch(
      'cancel',
      { status: 'CANCELLED' },
      'Order cancelled',
      `cancel order ${current.orderNumber}`
    )
  }

  const remove = async (current: Order) => {
    const ok = await confirm({
      title: `Delete draft order ${current.orderNumber}?`,
      description: 'Nothing has been ordered or received against it, so it can be removed.',
      confirmLabel: 'Delete order',
    })
    if (!ok) return
    try {
      await readJson(
        await fetch(`/api/inventory/purchase-orders/${params.id}`, { method: 'DELETE' })
      )
      toast(toastSuccess('Draft order deleted', current.orderNumber))
      router.push('/inventory/purchase-orders')
    } catch (err) {
      toast(toastError(`delete order ${current.orderNumber}`, err))
    }
  }

  const back = (
    <BackLink trail={trail} fallback="/inventory/purchase-orders" fallbackLabel="Purchase orders" />
  )

  if (loading && !order) return <PageSkeleton variant="detail" />
  if (notFound)
    return (
      <EmptyState
        icon={ClipboardList}
        title="Purchase order not found"
        description="It may have been deleted, or the link is wrong."
        actionLabel="Back to purchase orders"
        actionHref="/inventory/purchase-orders"
      />
    )
  if (failed || !order)
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this purchase order" onRetry={fetchOrder} />
      </div>
    )

  const canReceive =
    canWrite && (order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED')
  const outstanding = order.items.reduce((sum, line) => sum + line.outstanding, 0)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {ConfirmDialogComponent}
      <PageHeader
        title={order.orderNumber}
        badges={<StatusBadge kind="purchaseOrder" status={order.status} />}
        description={
          <>
            {order.supplier.name} ({order.supplier.code})
            {order.supplier.phone ? ` · ${formatPhone(order.supplier.phone)}` : ''}
          </>
        }
        back={back}
        actions={
          canWrite && (
            <>
              {order.status === 'DRAFT' && (
                <>
                  <Button variant="outline" onClick={() => remove(order)} disabled={busy !== null}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                  <SubmitButton
                    type="button"
                    icon={Send}
                    busy={busy === 'place'}
                    busyLabel="Placing order…"
                    disabled={busy !== null}
                    onClick={() =>
                      patch(
                        'place',
                        { status: 'ORDERED' },
                        'Order placed',
                        `place order ${order.orderNumber}`
                      )
                    }
                  >
                    Place order
                  </SubmitButton>
                </>
              )}
              {(order.status === 'DRAFT' || order.status === 'ORDERED') && (
                <SubmitButton
                  type="button"
                  variant="outline"
                  icon={XCircle}
                  className="text-destructive"
                  busy={busy === 'cancel'}
                  busyLabel="Cancelling…"
                  disabled={busy !== null}
                  onClick={() => cancelOrder(order)}
                >
                  Cancel order
                </SubmitButton>
              )}
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Ordered', value: displayDate(order.orderDate) },
          { label: 'Expected', value: displayDate(order.expectedDate) },
          { label: 'Received', value: displayDate(order.receivedDate) },
          { label: 'Total', value: formatCurrency(order.totalAmount) },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-lg font-semibold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b">
          <CardTitle className="text-lg">Items</CardTitle>
          {outstanding > 0 && (
            <span className={`text-sm ${TONE_TEXT_CLASS.progress}`}>
              {outstanding} still outstanding
            </span>
          )}
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                {['Item', 'Ordered', 'Received', 'Outstanding', 'Unit price', 'Amount'].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
                {canReceive && <TableHead>Receiving now</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div className="font-medium">{line.item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {line.item.sku} · {line.item.currentStock} {line.item.unit} in stock
                    </div>
                  </TableCell>
                  <TableCell>{line.quantity}</TableCell>
                  <TableCell>{line.receivedQty}</TableCell>
                  <TableCell>
                    {line.outstanding > 0 ? (
                      <span className={`font-medium ${TONE_TEXT_CLASS.progress}`}>
                        {line.outstanding}
                      </span>
                    ) : (
                      <span className={TONE_TEXT_CLASS.success}>Complete</span>
                    )}
                  </TableCell>
                  <TableCell>{formatCurrency(line.unitPrice)}</TableCell>
                  <TableCell>{formatCurrency(line.amount)}</TableCell>

                  {canReceive && (
                    <TableCell>
                      {line.outstanding === 0 ? (
                        <span className="text-xs text-muted-foreground">{BLANK}</span>
                      ) : (
                        <div className="min-w-[14rem] space-y-2">
                          <Input
                            type="number"
                            min={0}
                            max={line.outstanding}
                            aria-label={`Quantity received of ${line.item.name}`}
                            placeholder={`Up to ${line.outstanding}`}
                            value={drafts[line.id]?.quantity ?? ''}
                            onChange={(e) => setDraft(line.id, { quantity: e.target.value })}
                            className="h-9"
                          />
                          {/* Shown when the item asks for them. An expiry date
                              is the only thing that makes a near-expiry alert
                              possible, and the delivery is the one moment it
                              is knowable. */}
                          {(line.item.batchTracking || line.item.expiryTracking) && (
                            <>
                              <Input
                                type="text"
                                aria-label={`Batch number for ${line.item.name}`}
                                placeholder="Batch number"
                                value={drafts[line.id]?.batchNumber ?? ''}
                                onChange={(e) => setDraft(line.id, { batchNumber: e.target.value })}
                                className="h-9"
                              />
                              {line.item.expiryTracking && (
                                <Input
                                  type="date"
                                  aria-label={`Expiry date for ${line.item.name}`}
                                  value={drafts[line.id]?.expiryDate ?? ''}
                                  onChange={(e) =>
                                    setDraft(line.id, { expiryDate: e.target.value })
                                  }
                                  className="h-9"
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>

        {canReceive && (
          <div className="flex flex-col gap-4 border-t px-6 py-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <Label htmlFor="receivedDate">Delivery date</Label>
              <Input
                id="receivedDate"
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                className="w-auto"
              />
            </div>
            <SubmitButton
              type="button"
              icon={PackageCheck}
              busy={busy === 'receive'}
              busyLabel="Receiving…"
              disabled={busy !== null}
              onClick={receive}
            >
              Receive goods
            </SubmitButton>
          </div>
        )}
      </Card>

      {order.receipts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle className="text-lg">Deliveries</CardTitle>
            <CardDescription>Every stock movement booked in against this order.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  {['Date', 'Item', 'Quantity', 'Batch', 'Expires'].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.receipts.map((receipt) => {
                  const line = order.items.find((l) => l.itemId === receipt.itemId)
                  return (
                    <TableRow key={receipt.id}>
                      <TableCell>{displayDate(receipt.transactionDate)}</TableCell>
                      <TableCell>{line?.item.name ?? BLANK}</TableCell>
                      <TableCell>{receipt.quantity}</TableCell>
                      <TableCell>
                        {receipt.batch?.batchNumber ?? receipt.batchNumber ?? BLANK}
                      </TableCell>
                      <TableCell>{displayDate(receipt.batch?.expiryDate)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
