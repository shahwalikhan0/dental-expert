'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/status-badge'
import { GridBody, GridPagination } from '@/components/ui/data-grid'
import { PageHeader } from '@/components/ui/page-header'
import { BackLink, useTrail } from '@/components/ui/trail'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { useListParams } from '@/hooks/use-list-params'
import { useToast } from '@/hooks/use-toast'
import { BLANK, displayDate } from '@/lib/dates'
import { TONE_TEXT_CLASS, statusOptions, statusTone } from '@/lib/status'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { BellRing, Check } from 'lucide-react'

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

const KIND_OPTIONS = statusOptions('stockAlert')

function daysUntil(date: string) {
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days === 0) return 'today'
  return `in ${days} days`
}

export default function StockAlertsPage() {
  const trail = useTrail('Stock alerts')
  const { toast } = useToast()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const list = useListParams({ defaults: { type: 'all', acknowledged: false } })
  const { type, acknowledged } = list.filters

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams({ acknowledged: acknowledged ? 'true' : 'false' })
      if (type !== 'all') params.set('type', type)
      const data = await readJson<{ data: Alert[]; summary: Summary }>(
        await fetch(`/api/inventory/alerts?${params}`)
      )
      setAlerts(data.data)
      setSummary(data.summary)
    } catch (err) {
      console.error('Error loading stock alerts:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [type, acknowledged])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchAlerts()
  }, [fetchAlerts])

  // The route returns every alert; the search and the page are applied here.
  const matching = useMemo(() => {
    const term = list.query.toLowerCase()
    if (!term) return alerts
    return alerts.filter((a) =>
      [a.itemName, a.sku, a.batchNumber].some((v) => v?.toLowerCase().includes(term))
    )
  }, [alerts, list.query])
  const rows = matching.slice((list.page - 1) * list.pageSize, list.page * list.pageSize)

  const acknowledge = async (alert: Alert) => {
    try {
      await readJson(
        await fetch('/api/inventory/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alertId: alert.id }),
        })
      )
      toast(toastSuccess('Alert acknowledged', `${alert.itemName} — noted as dealt with.`))
      await fetchAlerts()
    } catch (error) {
      toast(toastError(`acknowledge the alert for ${alert.itemName}`, error))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock alerts"
        description="What has run out, what is running out, and what is about to go out of date."
        back={<BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />}
      />

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: 'Expired', value: summary.expired, tone: statusTone('stockAlert', 'EXPIRED') },
            {
              label: 'Out of stock',
              value: summary.outOfStock,
              tone: statusTone('stockAlert', 'OUT_OF_STOCK'),
            },
            {
              label: 'Expiring soon',
              value: summary.expiringSoon,
              tone: statusTone('stockAlert', 'EXPIRING_SOON'),
            },
            {
              label: 'Low stock',
              value: summary.lowStock,
              tone: statusTone('stockAlert', 'LOW_STOCK'),
            },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p
                  className={`text-3xl font-bold mt-1 ${stat.value > 0 ? TONE_TEXT_CLASS[stat.tone] : ''}`}
                >
                  {stat.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search stock alerts"
            placeholder="Search by item, SKU or batch…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Alert"
              plural="alerts"
              value={type}
              onValueChange={(value) => list.setFilter('type', value)}
              options={KIND_OPTIONS}
            />
            <Button
              variant={acknowledged ? 'default' : 'outline'}
              onClick={() => list.setFilter('acknowledged', !acknowledged)}
              aria-pressed={acknowledged}
            >
              <Check className="h-4 w-4 mr-2" />
              Acknowledged
            </Button>
          </>
        }
        active={{
          noun: 'alerts',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Alert',
              value: filterValueLabel(KIND_OPTIONS, type),
              onClear: () => list.setFilter('type', 'all'),
            },
            {
              label: 'Showing',
              value: acknowledged ? 'Acknowledged' : null,
              onClear: () => list.setFilter('acknowledged', false),
            },
          ],
        }}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[880px]">
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Alert</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">In stock</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead className="text-right">
                  {acknowledged ? 'Acknowledged by' : ''}
                </TableHead>
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              failed={failed}
              onRetry={fetchAlerts}
              empty={matching.length === 0}
              emptyIcon={acknowledged ? Check : BellRing}
              emptyTitle={
                list.query || type !== 'all'
                  ? 'No alerts found'
                  : acknowledged
                    ? 'Nothing acknowledged yet'
                    : 'Nothing needs attention'
              }
              emptyDescription={
                list.query || type !== 'all'
                  ? 'No alert matches these filters.'
                  : acknowledged
                    ? 'Alerts somebody has dealt with appear here.'
                    : 'Every item is above its minimum and nothing is near its expiry date.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : undefined}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {rows.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell>
                    <div className="font-medium">{alert.itemName}</div>
                    <div className="text-xs text-muted-foreground">{alert.sku}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="stockAlert" status={alert.alertType} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {/* A shortage is about the item; only an expiry names a
                        batch, which is why this is often blank. */}
                    {alert.batchNumber ?? <span className="text-muted-foreground">{BLANK}</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {alert.expiryDate ? (
                      <>
                        {displayDate(alert.expiryDate)}
                        <span className="block text-xs text-muted-foreground">
                          {daysUntil(alert.expiryDate)}
                          {alert.remainingQty != null && ` · ${alert.remainingQty} left`}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{BLANK}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {alert.currentStock} {alert.unit}
                    <span className="block text-xs text-muted-foreground">
                      min {alert.minimumStock}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {displayDate(alert.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {alert.isAcknowledged ? (
                      <div className="text-xs text-muted-foreground">
                        {alert.acknowledgedByName ?? 'Someone'}
                        {alert.acknowledgedAt && (
                          <span className="block">{displayDate(alert.acknowledgedAt)}</span>
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
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={matching.length}
            noun="alerts"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
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
