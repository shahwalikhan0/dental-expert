'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarClock, Layers, Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GridBody } from '@/components/ui/data-grid'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { humanise } from '@/lib/labels'
import { TONE_BADGE_VARIANT, TONE_TEXT_CLASS, type StatusTone } from '@/lib/status'
import { formatPhone } from '@/lib/utils'
import { readJson } from '@/lib/toast-utils'

const REPORTS = [
  { id: 'summary', label: 'Summary' },
  { id: 'low_stock', label: 'Low stock' },
  { id: 'expiring', label: 'Expiring items' },
  { id: 'stock_valuation', label: 'Stock valuation' },
] as const

type ReportId = (typeof REPORTS)[number]['id']

const DAYS_AHEAD = [7, 15, 30, 60, 90]

/** How urgent a shortage or an expiry is, in the status tones. */
function urgencyTone(urgency: string): StatusTone {
  if (urgency === 'out_of_stock' || urgency === 'expired' || urgency === 'critical') return 'danger'
  return 'progress'
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  return (
    <Badge variant={TONE_BADGE_VARIANT[urgencyTone(urgency)]} className="whitespace-nowrap">
      {humanise(urgency)}
    </Badge>
  )
}

function StatCard({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: React.ReactNode
  note?: React.ReactNode
  tone?: StatusTone
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={`mt-2 text-3xl font-bold ${tone ? TONE_TEXT_CLASS[tone] : ''}`}>{value}</p>
        {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  )
}

export default function InventoryReportsPage() {
  const trail = useTrail('Inventory reports')
  const [activeReport, setActiveReport] = useState<ReportId>('summary')
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  // Kept with the report it answers, so switching tabs never draws one
  // report's data with another's layout.
  const [report, setReport] = useState<{ type: ReportId; data: any } | null>(null)
  const latestRequest = useRef(0)

  const fetchReport = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams({ type: activeReport, days: String(days) })
      const data = await readJson<{ data: any }>(await fetch(`/api/inventory/reports?${params}`))
      if (requestId !== latestRequest.current) return
      setReport({ type: activeReport, data: data.data })
    } catch (error) {
      console.error('Error fetching report:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [activeReport, days])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchReport()
  }, [fetchReport])

  const data = report?.type === activeReport ? report.data : null

  const body = (id: ReportId, render: (data: any) => React.ReactNode) => {
    if (failed) return <LoadFailed what="this report" onRetry={fetchReport} />
    if (loading || !data || report?.type !== id)
      return <PageSkeleton variant={id === 'low_stock' ? 'table' : 'dashboard'} />
    return render(data)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory reports"
        description="Stock levels, shortages, expiry and what the shelves are worth."
        back={<BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />}
      />

      <Tabs value={activeReport} onValueChange={(v) => setActiveReport(v as ReportId)}>
        <TabsList>
          {REPORTS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="summary" className="space-y-6">
          {body('summary', (d) => (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <StatCard
                  label="Total items"
                  value={d.summary.totalItems}
                  note={`${d.summary.activeItems} active`}
                />
                <StatCard
                  label="Out of stock"
                  value={d.summary.outOfStockItems}
                  note="Items need restock"
                  tone="danger"
                />
                <StatCard
                  label="Low stock"
                  value={d.summary.lowStockItems}
                  note="Items below minimum"
                  tone="progress"
                />
                <StatCard
                  label="Inventory value"
                  value={formatCurrency(d.summary.totalInventoryValue ?? 0)}
                  note="Total stock value"
                  tone="success"
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Inventory by category</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Item count</TableHead>
                        <TableHead>Category value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <GridBody
                      columns={3}
                      empty={d.categoryBreakdown.length === 0}
                      emptyIcon={Layers}
                      emptyTitle="No categories yet"
                      emptyDescription="Items are grouped here by their category."
                    >
                      {d.categoryBreakdown.map((cat: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell className="whitespace-nowrap font-medium">
                            {cat.category || 'Uncategorized'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {cat.itemCount}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatCurrency(cat.categoryValue ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </GridBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Inventory by type</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Item count</TableHead>
                        <TableHead>Type value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <GridBody
                      columns={3}
                      empty={d.typeBreakdown.length === 0}
                      emptyIcon={Package}
                      emptyTitle="No items yet"
                      emptyDescription="Items are grouped here by their type."
                    >
                      {d.typeBreakdown.map((type: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell className="whitespace-nowrap font-medium">
                            {humanise(type.itemType)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {type.itemCount}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatCurrency(type.typeValue ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </GridBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ))}
        </TabsContent>

        <TabsContent value="low_stock">
          {body('low_stock', (d) => (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item code</TableHead>
                      <TableHead>Item name</TableHead>
                      <TableHead>Current stock</TableHead>
                      <TableHead>Minimum stock</TableHead>
                      <TableHead>Urgency</TableHead>
                      <TableHead>Suggested order</TableHead>
                      <TableHead>Supplier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <GridBody
                    columns={7}
                    empty={!Array.isArray(d) || d.length === 0}
                    emptyIcon={AlertTriangle}
                    emptyTitle="Nothing is low"
                    emptyDescription="Every item is above its minimum stock."
                  >
                    {(Array.isArray(d) ? d : []).map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-nowrap font-medium">{item.sku}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.name}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {item.currentStock} {item.unit}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {item.minimumStock} {item.unit}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <UrgencyBadge urgency={item.urgency} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {item.suggestedOrderQuantity} {item.unit}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {item.supplierName || BLANK}
                          {item.supplierPhone && (
                            <div className="text-xs text-muted-foreground">
                              {formatPhone(item.supplierPhone)}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </GridBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="expiring" className="space-y-6">
          <div className="flex items-center gap-3">
            <Label htmlFor="days-ahead">Days ahead</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
              <SelectTrigger id="days-ahead" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_AHEAD.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {body('expiring', (d) => (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <StatCard
                  label="Expired batches"
                  value={d.summary.expiredBatches ?? 0}
                  note={`Value: ${formatCurrency(d.summary.expiredValue ?? 0)}`}
                  tone="danger"
                />
                <StatCard
                  label="Expiring soon"
                  value={d.summary.expiringSoonBatches ?? 0}
                  note={`Value: ${formatCurrency(d.summary.expiringSoonValue ?? 0)}`}
                  tone="progress"
                />
              </div>

              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Batch number</TableHead>
                        <TableHead>Expiry date</TableHead>
                        <TableHead>Days to expiry</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Value at risk</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <GridBody
                      columns={7}
                      empty={d.items.length === 0}
                      emptyIcon={CalendarClock}
                      emptyTitle="Nothing is expiring"
                      emptyDescription={`No batch expires in the next ${days} days.`}
                    >
                      {d.items.map((item: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell className="whitespace-nowrap font-medium">
                            {item.name}
                            <span className="block text-xs text-muted-foreground">{item.sku}</span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {item.batchNumber}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {displayDate(item.expiryDate)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {item.daysToExpiry} days
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {item.remainingQty} {item.unit}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatCurrency(item.valueAtRisk ?? 0)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <UrgencyBadge urgency={item.urgency} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </GridBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ))}
        </TabsContent>

        <TabsContent value="stock_valuation" className="space-y-6">
          {body('stock_valuation', (d) => (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <StatCard
                  label="Total stock value"
                  value={formatCurrency(d.totals.totalValue ?? 0)}
                  tone="success"
                />
                <StatCard label="Items in stock" value={d.totals.itemsInStock ?? 0} />
                <StatCard
                  label="Average item value"
                  value={formatCurrency(d.totals.averageItemValue ?? 0)}
                />
              </div>

              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item code</TableHead>
                        <TableHead>Item name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Unit price</TableHead>
                        <TableHead>Stock value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <GridBody
                      columns={6}
                      empty={d.items.length === 0}
                      emptyIcon={Package}
                      emptyTitle="Nothing in stock"
                      emptyDescription="Items with stock on the shelf are valued here."
                    >
                      {d.items.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="whitespace-nowrap font-medium">
                            {item.sku}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{item.name}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {item.categoryName || BLANK}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {item.currentStock} {item.unit}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatCurrency(item.purchasePrice)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-medium">
                            {formatCurrency(item.stockValue ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </GridBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}
