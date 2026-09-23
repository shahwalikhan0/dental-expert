'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency, formatDate } from '@/lib/i18n/format'
import { ArrowLeft, Package, TriangleAlert } from 'lucide-react'
import { BackLink, useTrail } from '@/components/ui/trail'

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

const STOCK_STYLE: Record<string, { label: string; className: string }> = {
  out_of_stock: {
    label: 'Out of stock',
    className: 'bg-red-100 text-red-800 border-0 dark:bg-red-950/40 dark:text-red-300',
  },
  low_stock: {
    label: 'Low stock',
    className: 'bg-amber-100 text-amber-800 border-0 dark:bg-amber-950/40 dark:text-amber-300',
  },
  reorder: {
    label: 'At reorder level',
    className: 'bg-amber-100 text-amber-800 border-0 dark:bg-amber-950/40 dark:text-amber-300',
  },
  sufficient: {
    label: 'In stock',
    className: 'bg-green-100 text-green-800 border-0 dark:bg-green-950/40 dark:text-green-300',
  },
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

  const fetchItem = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/inventory/items/${id}`)
      const data = await response.json()
      if (data.success) setItem(data.data)
    } catch (err) {
      console.error('Error loading item:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchItem()
  }, [fetchItem])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <h1 className="page-title">Item not found</h1>
        <Button variant="outline" asChild>
          <Link href="/inventory">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Inventory
          </Link>
        </Button>
      </div>
    )
  }

  const stock = STOCK_STYLE[item.stockStatus] ?? STOCK_STYLE.sufficient

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="page-title">{item.name}</h1>
            <Badge className={stock.className}>{stock.label}</Badge>
            {!item.isActive && <Badge variant="outline">Inactive</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {item.sku}
            {item.categoryName && ` · ${item.categoryName}`}
            {item.manufacturer && ` · ${item.manufacturer}`}
          </p>
        </div>
        <div className="flex gap-2">
          <BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />
          <Button variant="outline" asChild>
            <Link href={trail.to(`/inventory/transactions?item=${item.id}&record=1`)}>
              Record movement
            </Link>
          </Button>
        </div>
      </div>

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
                                className={
                                  expired ? 'text-red-700 font-medium dark:text-red-300' : ''
                                }
                              >
                                {formatDate(batch.expiryDate)}
                                <span className="block text-xs text-muted-foreground">
                                  {daysUntil(batch.expiryDate)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{batch.supplierName ?? '—'}</TableCell>
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
                            {formatDate(move.transactionDate)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {move.type.charAt(0) +
                              move.type.slice(1).toLowerCase().replace(/_/g, ' ')}
                            {move.supplierName && (
                              <span className="block text-xs text-muted-foreground">
                                {move.supplierName}
                              </span>
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium ${inbound ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}
                          >
                            {inbound ? '+' : '−'}
                            {move.quantity}
                          </TableCell>
                          <TableCell className="text-right">{move.newStock}</TableCell>
                          <TableCell className="text-sm">{move.batchNumber ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {move.performedByName ?? '—'}
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
                  ['Type', item.itemType.replace(/_/g, ' ').toLowerCase()],
                  ['Unit', item.unit],
                  ['Manufacturer', item.manufacturer],
                  ['Description', item.description],
                  ['Selling price', item.sellingPrice ? formatCurrency(item.sellingPrice) : null],
                  ['Maximum stock', item.maximumStock?.toString()],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-right">{value || '—'}</span>
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
                  ['Supplier phone', item.supplierPhone],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-right">{value || '—'}</span>
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
