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
import { PageHeader } from '@/components/ui/page-header'
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
import { ArrowLeftRight, Package, Pencil, TriangleAlert } from 'lucide-react'
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.name}
        badges={
          <>
            <StatusBadge kind="inventory" status={item.stockStatus} />
            {!item.isActive && <StatusBadge kind="inventory" status={false} />}
          </>
        }
        description={
          <>
            {item.sku}
            {item.categoryName && ` · ${item.categoryName}`}
            {item.manufacturer && ` · ${item.manufacturer}`}
          </>
        }
        back={back}
        actions={
          canWrite && (
            <>
              <Button variant="outline" asChild>
                <Link href={trail.to(`/inventory/transactions?item=${item.id}&record=1`)}>
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Record movement
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={trail.to(`/inventory/${item.id}/edit`)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Link>
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'In stock',
            value: `${item.currentStock} ${item.unit}`,
            note: `minimum ${item.minimumStock} · reorder at ${item.reorderLevel}`,
          },
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
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="batches">
        <TabsList>
          <TabsTrigger value="batches">Batches ({item.batchCount})</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="batches">
          <Card>
            <CardContent className="p-0">
              {item.batches.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  {/* Batches arrive with a delivery. An item with none has
                      either never been received against a purchase order, or
                      is not tracked by batch. */}
                  {item.batchTracking
                    ? 'No batches yet. They are recorded when a delivery is received against a purchase order.'
                    : 'This item is not tracked by batch.'}
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
                      const expired = batch.expiryDate && new Date(batch.expiryDate) <= new Date()
                      return (
                        <TableRow key={batch.id}>
                          <TableCell className="font-medium">{batch.batchNumber}</TableCell>
                          <TableCell className="text-right">{batch.quantity}</TableCell>
                          <TableCell className="text-right">{batch.remainingQty}</TableCell>
                          <TableCell className="text-sm">
                            {batch.expiryDate ? (
                              <span
                                className={expired ? `font-medium ${TONE_TEXT_CLASS.danger}` : ''}
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
                          <TableCell className="text-sm">{batch.supplierName ?? BLANK}</TableCell>
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
            <CardContent className="p-0">
              {item.recentTransactions.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Nothing has moved in or out yet.
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

        <TabsContent value="details">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Item
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ['Type', humanise(item.itemType)],
                  ['Unit', item.unit],
                  ['Manufacturer', item.manufacturer],
                  ['Description', item.description],
                  ['Selling price', item.sellingPrice ? formatCurrency(item.sellingPrice) : null],
                  ['Maximum stock', item.maximumStock?.toString()],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-right">{value || BLANK}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TriangleAlert className="h-4 w-4" />
                  Storage and tracking
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ['Location', item.storageLocation],
                  ['Conditions', item.storageConditions],
                  ['Batch tracked', item.batchTracking ? 'Yes' : 'No'],
                  ['Expiry tracked', item.expiryTracking ? 'Yes' : 'No'],
                  ['Supplier', item.supplierName],
                  ['Supplier phone', formatPhone(item.supplierPhone)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-right">{value || BLANK}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
