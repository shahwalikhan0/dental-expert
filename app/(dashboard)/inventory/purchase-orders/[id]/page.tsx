'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Boxes,
  Building2,
  CalendarDays,
  CheckCircle,
  ClipboardList,
  PackageCheck,
  Pencil,
  Phone,
  Send,
  ShoppingCart,
  Trash2,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react'
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
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
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

  // Placing, cancelling and deleting; the last two are rare and cannot be
  // taken back, so they sit behind "More" rather than beside the next step.
  const menu = canWrite
    ? [
        ...(order.status === 'DRAFT' || order.status === 'ORDERED'
          ? [
              {
                label: busy === 'cancel' ? 'Cancelling…' : 'Cancel order',
                icon: XCircle,
                onSelect: () => cancelOrder(order),
                destructive: true,
                disabled: busy !== null,
              },
            ]
          : []),
        ...(order.status === 'DRAFT'
          ? [
              {
                label: 'Delete draft',
                icon: Trash2,
                onSelect: () => remove(order),
                destructive: true,
                disabled: busy !== null,
              },
            ]
          : []),
      ]
    : []

  return (
    <div className="space-y-6">
      {ConfirmDialogComponent}
      <ProfileHeader
        eyebrow={order.orderNumber}
        name={order.supplier.name}
        avatarIcon={ShoppingCart}
        badges={<StatusBadge kind="purchaseOrder" status={order.status} />}
        facts={[
          { icon: CalendarDays, label: `Ordered ${displayDate(order.orderDate)}` },
          ...(order.expectedDate
            ? [{ icon: Truck, label: `Expected ${displayDate(order.expectedDate)}` }]
            : []),
          {
            icon: Boxes,
            label: `${order.items.length} ${order.items.length === 1 ? 'line' : 'lines'}`,
          },
          { icon: Wallet, label: formatCurrency(order.totalAmount) },
        ]}
        menu={menu}
        actions={
          canWrite &&
          order.status === 'DRAFT' && (
            <>
              <Button variant="outline" asChild>
                <Link href={trail.to(`/inventory/purchase-orders/${order.id}/edit`)}>
                  <Pencil className="h-4 w-4" />
                  Edit draft
                </Link>
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
          )
        }
      />

      {/* Where the order has got to; or, for a cancelled one, that it stopped. */}
      {order.status === 'CANCELLED' ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600/10">
            <XCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">This order was cancelled</p>
            <p className="mt-0.5">
              It is kept for the record; nothing more can be received against it.
            </p>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6">
            <OrderProgress order={order} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b">
              <CardTitle>Items</CardTitle>
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
                    {['Item', 'Ordered', 'Received', 'Outstanding', 'Unit price', 'Amount'].map(
                      (h) => (
                        <TableHead key={h}>{h}</TableHead>
                      )
                    )}
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
                                    onChange={(e) =>
                                      setDraft(line.id, { batchNumber: e.target.value })
                                    }
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
                <CardTitle>Deliveries</CardTitle>
                <CardDescription>
                  Every stock movement booked in against this order.
                </CardDescription>
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

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Supplier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <LinkList>
                <LinkRow
                  href={trail.to(`/inventory/suppliers/${order.supplier.id}`)}
                  icon={Building2}
                  title={order.supplier.name}
                  subtitle={order.supplier.code}
                />
              </LinkList>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Phone" icon={Phone}>
                  {order.supplier.phone ? formatPhone(order.supplier.phone) : null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Order</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Ordered">{displayDate(order.orderDate)}</InfoItem>
                <InfoItem label="Expected">
                  {order.expectedDate ? displayDate(order.expectedDate) : null}
                </InfoItem>
                <InfoItem label="Received">
                  {order.receivedDate ? displayDate(order.receivedDate) : null}
                </InfoItem>
                <InfoItem label="Still to arrive">
                  {outstanding > 0 ? (
                    <span className={TONE_TEXT_CLASS.progress}>{outstanding}</span>
                  ) : (
                    'Nothing'
                  )}
                </InfoItem>
              </InfoGrid>
              <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{formatCurrency(order.subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd className="tabular-nums">{formatCurrency(order.taxAmount)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatCurrency(order.totalAmount)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {order.notes && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{order.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

const ORDER_STEPS = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED']

/**
 * The order as a row of steps, drafted to fully received, with the date each
 * was reached where the record keeps one — the same stepper as a visit's on
 * its appointment page, so where an order has got to reads at a glance.
 */
function OrderProgress({ order }: { order: Order }) {
  const reached = ORDER_STEPS.indexOf(order.status)
  const steps = [
    { label: 'Drafted', detail: null },
    { label: 'Ordered', detail: displayDate(order.orderDate) },
    { label: 'Part received', detail: null },
    {
      label: 'Received',
      detail: order.receivedDate ? displayDate(order.receivedDate) : null,
    },
  ]
  return (
    <ol className="flex items-start" aria-label="Order progress">
      {steps.map((step, index) => {
        const done = index <= reached
        const next = index === reached + 1
        return (
          <li key={step.label} className="relative flex flex-1 flex-col items-center text-center">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={`absolute top-[13px] h-0.5 rounded-full ${done ? 'bg-primary' : 'bg-border'}`}
                // From the edge of the previous circle to the edge of this one.
                style={{ left: 'calc(-50% + 18px)', right: 'calc(50% + 18px)' }}
              />
            )}
            <span
              className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : next
                    ? 'border-primary bg-card text-primary ring-4 ring-primary/15'
                    : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {done ? <CheckCircle className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={`mt-2 text-xs font-semibold sm:text-sm ${done || next ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {step.label}
              <span className="sr-only">{done ? ' (done)' : next ? ' (next)' : ''}</span>
            </span>
            {done && step.detail && (
              <span className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
                {step.detail}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
