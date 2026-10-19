'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { humanise } from '@/lib/labels'
import { TONE_TEXT_CLASS } from '@/lib/status'
import { formatPhone } from '@/lib/utils'
import {
  ArrowLeftRight,
  Boxes,
  Factory,
  History,
  Layers,
  MapPin,
  Package,
  Pencil,
  Phone,
  Tag,
  TriangleAlert,
} from 'lucide-react'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useCan } from '@/hooks/use-can'

interface Batch {
  id: string
  batchNumber: string
  quantity: number
  remainingQty: number
  expiryDate: string | null
  receivedDate: string
  purchasePrice: string
  supplierName: string | null
}

interface Movement {
  id: string
  type: string
  quantity: number
  previousStock: number
  newStock: number
  batchNumber: string | null
  notes: string | null
  transactionDate: string
  supplierName: string | null
  performedByName: string | null
}

interface Item {
  id: string
  sku: string
  name: string
  description: string | null
  itemType: string
  categoryName: string | null
  unit: string
  currentStock: number
  minimumStock: number
  reorderLevel: number
  maximumStock: number | null
  purchasePrice: string
  sellingPrice: string | null
  manufacturer: string | null
  storageLocation: string | null
  storageConditions: string | null
  batchTracking: boolean
  expiryTracking: boolean
  isActive: boolean
  stockStatus: string
  batchCount: number
  purchasesLast30Days: number
  usageLast30Days: number
  supplierName: string | null
  supplierPhone: string | null
  batches: Batch[]
  recentTransactions: Movement[]
}

/** Incoming movements read as a gain, outgoing as a loss. */
const INBOUND = ['PURCHASE', 'ADJUSTMENT_IN', 'RETURNED']

function daysUntil(date: string) {
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return `expired ${Math.abs(days)} days ago`
  if (days === 0) return 'expires today'
  return `in ${days} days`
}

export default function InventoryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [item, setItem] = useState<Item | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(item?.name ?? null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)
  // Recording a movement and editing are `inventory:write` on the server; a
  // reader (the dentist, the manager) is not offered either.
  const canWrite = useCan('inventory:write') === true

  const fetchItem = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    setNotFound(false)
    try {
      const response = await fetch(`/api/inventory/items/${id}`)
      if (response.status === 404) {
        setNotFound(true)
        return
      }
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load the item')
      setItem(data.data)
    } catch (err) {
      console.error('Error loading item:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchItem()
  }, [fetchItem])

  const back = <BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />

  if (loading && !item) return <PageSkeleton variant="detail" />

  if (notFound) {
    return (
      <EmptyState
        icon={Package}
        title="Item not found"
        description="It may have been deleted, or the link is wrong."
        actionLabel="Back to inventory"
        actionHref="/inventory"
      />
    )
  }

  if (failed || !item) {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this item" onRetry={fetchItem} />
      </div>
    )
  }

  // Where the level sits between empty and full, for the bar on the first
  // tile. Full is the maximum when one is set; otherwise twice the reorder
  // point, so a healthy shelf reads as half-full rather than off the scale.
  const scale = Math.max(item.maximumStock ?? item.reorderLevel * 2, item.currentStock, 1)
  const fill = Math.min(100, Math.round((item.currentStock / scale) * 100))
  const low = item.stockStatus !== 'sufficient'

  const stats = [
    {
      label: 'Received, last 30 days',
      value: `${item.purchasesLast30Days} ${item.unit}`,
      note: item.supplierName ? `from ${item.supplierName}` : 'no preferred supplier',
    },
    {
      label: 'Used, last 30 days',
      value: `${item.usageLast30Days} ${item.unit}`,
      note:
        item.usageLast30Days > 0
          ? `about ${Math.round(item.currentStock / (item.usageLast30Days / 30))} days left at this rate`
          : 'nothing used',
    },
    {
      label: 'Purchase price',
      value: formatCurrency(item.purchasePrice),
      note: `per ${item.unit}`,
    },
  ]

  return (
    <div className="space-y-6">
      <ProfileHeader
        eyebrow={item.sku}
        name={item.name}
        avatarIcon={Package}
        badges={
          <>
            <StatusBadge kind="inventory" status={item.stockStatus} />
            {!item.isActive && <StatusBadge kind="inventory" status={false} />}
          </>
        }
        facts={[
          { icon: Tag, label: humanise(item.itemType) },
          ...(item.categoryName ? [{ icon: Boxes, label: item.categoryName }] : []),
          ...(item.manufacturer ? [{ icon: Factory, label: item.manufacturer }] : []),
          ...(item.storageLocation ? [{ icon: MapPin, label: item.storageLocation }] : []),
        ]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={trail.to(`/inventory/transactions?item=${item.id}`)}>
                <History className="h-4 w-4" />
                Stock history
              </Link>
            </Button>
            {canWrite && (
              <>
                <Button variant="outline" asChild>
                  <Link href={trail.to(`/inventory/${item.id}/edit`)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={trail.to(`/inventory/transactions?item=${item.id}&record=1`)}>
                    <ArrowLeftRight className="h-4 w-4" />
                    Record movement
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />

      {/* At or under the reorder point: said once, in words, above the numbers. */}
      {low && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600/10">
            <TriangleAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              {item.currentStock <= 0
                ? 'Out of stock'
                : `${item.currentStock} ${item.unit} left — at or below the reorder point`}
            </p>
            <p className="mt-0.5">
              Reorder at {item.reorderLevel}, minimum {item.minimumStock}
              {item.supplierName && `. Preferred supplier: ${item.supplierName}`}.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            In stock
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight">
            {item.currentStock} <span className="text-base font-semibold">{item.unit}</span>
          </p>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
            role="presentation"
            aria-hidden="true"
          >
            <div
              className={`h-full rounded-full ${low ? 'bg-amber-500 dark:bg-amber-400' : 'bg-primary'}`}
              style={{ width: `${fill}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            minimum {item.minimumStock} · reorder at {item.reorderLevel}
            {item.maximumStock != null && ` · max ${item.maximumStock}`}
          </p>
        </div>
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{stat.value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{stat.note}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Tabs defaultValue="batches">
            <TabsList>
              <TabsTrigger value="batches">
                <Layers className="h-4 w-4" />
                Batches ({item.batchCount})
              </TabsTrigger>
              <TabsTrigger value="movements">
                <ArrowLeftRight className="h-4 w-4" />
                Movements
              </TabsTrigger>
            </TabsList>

            <TabsContent value="batches">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  {item.batches.length === 0 ? (
                    <div className="p-6">
                      <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                        {/* Batches arrive with a delivery. An item with none has
                            either never been received against a purchase order, or
                            is not tracked by batch. */}
                        {item.batchTracking
                          ? 'No batches yet. They are recorded when a delivery is received against a purchase order.'
                          : 'This item is not tracked by batch.'}
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Batch</TableHead>
                          <TableHead className="text-right">Received</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.batches.map((batch) => {
                          const expired =
                            batch.expiryDate && new Date(batch.expiryDate) <= new Date()
                          return (
                            <TableRow key={batch.id}>
                              <TableCell className="font-medium">{batch.batchNumber}</TableCell>
                              <TableCell className="text-right">{batch.quantity}</TableCell>
                              <TableCell className="text-right">{batch.remainingQty}</TableCell>
                              <TableCell className="text-sm">
                                {batch.expiryDate ? (
                                  <span
                                    className={
                                      expired ? `font-medium ${TONE_TEXT_CLASS.danger}` : ''
                                    }
                                  >
                                    {displayDate(batch.expiryDate)}
                                    <span className="block text-xs text-muted-foreground">
                                      {daysUntil(batch.expiryDate)}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {batch.supplierName ?? BLANK}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(batch.purchasePrice)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="movements">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  {item.recentTransactions.length === 0 ? (
                    <div className="p-6">
                      <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                        Nothing has moved in or out yet.
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Movement</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Stock after</TableHead>
                          <TableHead>Batch</TableHead>
                          <TableHead>By</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.recentTransactions.map((move) => {
                          const inbound = INBOUND.includes(move.type)
                          return (
                            <TableRow key={move.id}>
                              <TableCell className="text-sm text-muted-foreground">
                                {displayDate(move.transactionDate)}
                              </TableCell>
                              <TableCell className="text-sm">
                                {humanise(move.type)}
                                {move.supplierName && (
                                  <span className="block text-xs text-muted-foreground">
                                    {move.supplierName}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell
                                className={`text-right font-medium ${inbound ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger}`}
                              >
                                {inbound ? '+' : '−'}
                                {move.quantity}
                              </TableCell>
                              <TableCell className="text-right">{move.newStock}</TableCell>
                              <TableCell className="text-sm">{move.batchNumber ?? BLANK}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {move.performedByName ?? BLANK}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Supplier</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Preferred supplier">{item.supplierName}</InfoItem>
                <InfoItem label="Phone" icon={Phone}>
                  {formatPhone(item.supplierPhone) || null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Item</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Type">{humanise(item.itemType)}</InfoItem>
                <InfoItem label="Unit">{item.unit}</InfoItem>
                <InfoItem label="Manufacturer">{item.manufacturer}</InfoItem>
                <InfoItem label="Selling price">
                  {item.sellingPrice ? formatCurrency(item.sellingPrice) : null}
                </InfoItem>
                <InfoItem label="Maximum stock">{item.maximumStock?.toString()}</InfoItem>
                <InfoItem label="Description" className="sm:col-span-2">
                  {item.description ? (
                    <span className="whitespace-pre-wrap font-normal">{item.description}</span>
                  ) : null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Storage and tracking</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Location" className="sm:col-span-2">
                  {item.storageLocation}
                </InfoItem>
                <InfoItem label="Conditions" className="sm:col-span-2">
                  {item.storageConditions}
                </InfoItem>
                <InfoItem label="Batch tracked">{item.batchTracking ? 'Yes' : 'No'}</InfoItem>
                <InfoItem label="Expiry tracked">{item.expiryTracking ? 'Yes' : 'No'}</InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
