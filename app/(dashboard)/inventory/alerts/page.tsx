'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { GridPagination, usePagedRows } from '@/components/ui/data-grid'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/i18n/format'
import { ArrowLeft, BellRing, Check, PackageX } from 'lucide-react'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'

interface Alert {
  id: string
  alertType: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'EXPIRING_SOON' | 'EXPIRED'
  sku: string
  itemName: string
  unit: string
  currentStock: number
  minimumStock: number
  batchNumber: string | null
  expiryDate: string | null
  remainingQty: number | null
  isAcknowledged: boolean
  acknowledgedByName: string | null
  acknowledgedAt: string | null
  notes: string | null
  createdAt: string
}

interface Summary {
  totalAlerts: number
  outOfStock: number
  lowStock: number
  expiringSoon: number
  expired: number
}

/**
 * Severity, not category. An expired batch on the shelf is the one a nurse
 * must act on before opening a surgery; "low stock" can wait for the order.
 */
const ALERT_STYLE: Record<Alert['alertType'], { label: string; className: string }> = {
  EXPIRED: {
    label: 'Expired',
    className: 'bg-red-100 text-red-800 border-0 dark:bg-red-950/40 dark:text-red-300',
  },
  OUT_OF_STOCK: {
    label: 'Out of stock',
    className: 'bg-red-100 text-red-800 border-0 dark:bg-red-950/40 dark:text-red-300',
  },
  EXPIRING_SOON: {
    label: 'Expiring soon',
    className: 'bg-amber-100 text-amber-800 border-0 dark:bg-amber-950/40 dark:text-amber-300',
  },
  LOW_STOCK: {
    label: 'Low stock',
    className: 'bg-amber-100 text-amber-800 border-0 dark:bg-amber-950/40 dark:text-amber-300',
  },
}

const FILTERS = [
  { id: '', label: 'Everything' },
  { id: 'EXPIRED', label: 'Expired' },
  { id: 'EXPIRING_SOON', label: 'Expiring soon' },
  { id: 'OUT_OF_STOCK', label: 'Out of stock' },
  { id: 'LOW_STOCK', label: 'Low stock' },
] as const

function daysUntil(date: string) {
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days === 0) return 'today'
  return `in ${days} days`
}

export default function StockAlertsPage() {
  const { toast } = useToast()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('')
  const [showAcknowledged, setShowAcknowledged] = useState(false)
  const paged = usePagedRows(alerts)

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        acknowledged: showAcknowledged ? 'true' : 'false',
        ...(type && { type }),
      })
      const response = await fetch(`/api/inventory/alerts?${params}`)
      const data = await response.json()
      if (data.success) {
        setAlerts(data.data)
        setSummary(data.summary)
      }
    } catch (err) {
      console.error('Error loading stock alerts:', err)
    } finally {
      setLoading(false)
    }
  }, [type, showAcknowledged])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const acknowledge = async (alert: Alert) => {
    const response = await fetch('/api/inventory/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertId: alert.id }),
    })

    if (response.ok) {
      toast({ title: 'Acknowledged', description: `${alert.itemName} — noted as dealt with.` })
      await fetchAlerts()
    } else {
      const data = await response.json()
      toast({ variant: 'destructive', title: 'Could not acknowledge', description: data.error })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Stock Alerts</h1>
          <p className="text-muted-foreground">
            What has run out, what is running out, and what is about to go out of date.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/inventory">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Inventory
          </Link>
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: 'Expired', value: summary.expired, tone: 'text-red-700 dark:text-red-300' },
            {
              label: 'Out of stock',
              value: summary.outOfStock,
              tone: 'text-red-700 dark:text-red-300',
            },
            {
              label: 'Expiring soon',
              value: summary.expiringSoon,
              tone: 'text-amber-700 dark:text-amber-300',
            },
            {
              label: 'Low stock',
              value: summary.lowStock,
              tone: 'text-amber-700 dark:text-amber-300',
            },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className={`text-3xl font-bold mt-1 ${stat.value > 0 ? stat.tone : ''}`}>
                  {stat.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.id || 'all'}
            variant={type === f.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setType(f.id)}
          >
            {f.label}
          </Button>
        ))}
        <div className="ml-auto">
          <Button
            variant={showAcknowledged ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowAcknowledged((v) => !v)}
          >
            <Check className="h-4 w-4 mr-2" />
            {showAcknowledged ? 'Showing acknowledged' : 'Show acknowledged'}
          </Button>
        </div>
      </div>

      <ActiveFilters
        noun="alerts"
        onClearAll={() => {
          setType('')
          setShowAcknowledged(false)
        }}
        filters={[
          {
            label: 'Kind',
            value: type ? (FILTERS.find((f) => f.id === type)?.label ?? humanise(type)) : null,
            onClear: () => setType(''),
          },
          {
            label: 'Also showing',
            value: showAcknowledged ? 'Acknowledged' : null,
            onClear: () => setShowAcknowledged(false),
          },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={showAcknowledged ? Check : BellRing}
              title={showAcknowledged ? 'Nothing acknowledged yet' : 'Nothing needs attention'}
              description={
                showAcknowledged
                  ? 'Alerts somebody has dealt with appear here.'
                  : 'Every item is above its minimum and nothing is near its expiry date.'
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead>Raised</TableHead>
                  <TableHead className="text-right">
                    {showAcknowledged ? 'Acknowledged by' : ''}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.rows.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <div className="font-medium">{alert.itemName}</div>
                      <div className="text-xs text-muted-foreground">{alert.sku}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={ALERT_STYLE[alert.alertType].className}>
                        {ALERT_STYLE[alert.alertType].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {/* A shortage is about the item; only an expiry names a
                          batch, which is why this is often blank. */}
                      {alert.batchNumber ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {alert.expiryDate ? (
                        <>
                          {formatDate(alert.expiryDate)}
                          <span className="block text-xs text-muted-foreground">
                            {daysUntil(alert.expiryDate)}
                            {alert.remainingQty != null && ` · ${alert.remainingQty} left`}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {alert.currentStock} {alert.unit}
                      <span className="block text-xs text-muted-foreground">
                        min {alert.minimumStock}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(alert.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {alert.isAcknowledged ? (
                        <div className="text-xs text-muted-foreground">
                          {alert.acknowledgedByName ?? 'Someone'}
                          {alert.acknowledgedAt && (
                            <span className="block">{formatDate(alert.acknowledgedAt)}</span>
                          )}
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => acknowledge(alert)}>
                          <Check className="h-4 w-4 mr-1" />
                          Acknowledge
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <GridPagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="alerts"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </CardContent>
      </Card>

      {/*
        Acknowledging silences an alert without changing the stock. That is the
        point: a clinic that has already ordered more gloves needs it to stop
        shouting before the delivery arrives.
      */}
      <p className="text-xs text-muted-foreground">
        Acknowledging an alert records who dealt with it and stops it appearing here. It does not
        change the stock level — a new alert is raised if the item drops again, or if another batch
        nears its expiry date.
      </p>
    </div>
  )
}
