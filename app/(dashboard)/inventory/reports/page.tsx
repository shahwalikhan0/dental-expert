'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function InventoryReportsPage() {
  const [activeReport, setActiveReport] = useState('summary')
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<any>(null)
  const [reportParams, setReportParams] = useState({
    days: 30,
  })

  useEffect(() => {
    fetchReport()
  }, [activeReport, reportParams])

  const fetchReport = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        type: activeReport,
        days: String(reportParams.days),
      })

      const response = await fetch(`/api/inventory/reports?${params}`)
      const data = await response.json()

      if (data.success) {
        setReportData(data.data)
      }
    } catch (error) {
      console.error('Error fetching report:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
    }).format(amount)
  }

  const renderSummaryReport = () => {
    if (!reportData) return null

    return (
      <div>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Total Items</h3>
            <p className="text-3xl font-bold mt-2">{reportData.summary.totalItems}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {reportData.summary.activeItems} active
            </p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Out of Stock</h3>
            <p className="text-3xl font-bold mt-2 text-red-600 dark:text-red-400">
              {reportData.summary.outOfStockItems}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Items need restock</p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Low Stock</h3>
            <p className="text-3xl font-bold mt-2 text-orange-600 dark:text-orange-400">
              {reportData.summary.lowStockItems}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Items below minimum</p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Inventory Value</h3>
            <p className="text-3xl font-bold mt-2 text-green-600 dark:text-green-400">
              {formatCurrency(reportData.summary.totalInventoryValue || 0)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Total stock value</p>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="bg-background p-6 rounded-lg shadow mb-6">
          <h3 className="text-lg font-bold mb-4">Inventory by Category</h3>
          <div>
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Item Count</TableHead>
                  <TableHead>Category Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.categoryBreakdown.map((cat: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {cat.category || 'Uncategorized'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {cat.itemCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatCurrency(cat.categoryValue || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Type Breakdown */}
        <div className="bg-background p-6 rounded-lg shadow">
          <h3 className="text-lg font-bold mb-4">Inventory by Type</h3>
          <div>
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Item Count</TableHead>
                  <TableHead>Type Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.typeBreakdown.map((type: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {type.itemType.replace('_', ' ').toUpperCase()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {type.itemCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatCurrency(type.typeValue || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    )
  }

  const renderLowStockReport = () => {
    if (!reportData || !Array.isArray(reportData)) return null

    return (
      <div className="bg-background rounded-lg shadow overflow-hidden">
        <div>
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead>Item Code</TableHead>
                <TableHead>Item Name</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Minimum Stock</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead>Suggested Order</TableHead>
                <TableHead>Supplier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportData.map((item: any) => (
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
                    <span
                      className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        item.urgency === 'out_of_stock'
                          ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                          : item.urgency === 'critical'
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300'
                      }`}
                    >
                      {item.urgency.replace('_', ' ').toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {item.suggestedOrderQuantity} {item.unit}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {item.supplierName || '-'}
                    {item.supplierPhone && (
                      <div className="text-xs text-muted-foreground">{item.supplierPhone}</div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  const renderExpiringReport = () => {
    if (!reportData) return null

    return (
      <div>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Expired Batches</h3>
            <p className="text-3xl font-bold mt-2 text-red-600 dark:text-red-400">
              {reportData.summary.expiredBatches || 0}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Value: {formatCurrency(reportData.summary.expiredValue || 0)}
            </p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Expiring Soon</h3>
            <p className="text-3xl font-bold mt-2 text-orange-600 dark:text-orange-400">
              {reportData.summary.expiringSoonBatches || 0}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Value: {formatCurrency(reportData.summary.expiringSoonValue || 0)}
            </p>
          </div>
        </div>

        {/* Items Table */}
        <div className="bg-background rounded-lg shadow overflow-hidden">
          <div>
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Batch Number</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Days to Expiry</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Value at Risk</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.items.map((item: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {item.name}
                      <br />
                      <span className="text-xs text-muted-foreground">{item.sku}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {item.batchNumber}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {new Date(item.expiryDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{item.daysToExpiry} days</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.remainingQty} {item.unit}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatCurrency(item.valueAtRisk || 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          item.urgency === 'expired'
                            ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                            : item.urgency === 'critical'
                              ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300'
                              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300'
                        }`}
                      >
                        {item.urgency.toUpperCase()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    )
  }

  const renderStockValuationReport = () => {
    if (!reportData) return null

    return (
      <div>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Total Stock Value</h3>
            <p className="text-3xl font-bold mt-2 text-green-600 dark:text-green-400">
              {formatCurrency(reportData.totals.totalValue || 0)}
            </p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Items in Stock</h3>
            <p className="text-3xl font-bold mt-2">{reportData.totals.itemsInStock || 0}</p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">Average Item Value</h3>
            <p className="text-3xl font-bold mt-2">
              {formatCurrency(reportData.totals.averageItemValue || 0)}
            </p>
          </div>
        </div>

        {/* Items Table */}
        <div className="bg-background rounded-lg shadow overflow-hidden">
          <div>
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Item Code</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Stock Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap font-medium">{item.sku}</TableCell>
                    <TableCell className="whitespace-nowrap">{item.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {item.categoryName || '-'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.currentStock} {item.unit}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatCurrency(item.purchasePrice)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatCurrency(item.stockValue || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="page-title">Inventory Reports</h1>
        <Link
          href="/inventory"
          className="px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/80"
        >
          Back to Inventory
        </Link>
      </div>

      {/* Report Tabs */}
      <div className="bg-background rounded-lg shadow mb-6">
        <div className="border-b border-border">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {[
              { id: 'summary', label: 'Summary' },
              { id: 'low_stock', label: 'Low Stock' },
              { id: 'expiring', label: 'Expiring Items' },
              { id: 'stock_valuation', label: 'Stock Valuation' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveReport(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeReport === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Report Parameters */}
        {activeReport === 'expiring' && (
          <div className="p-6 bg-muted/50">
            <label className="block text-sm font-medium text-foreground mb-2">Days Ahead</label>
            <select
              value={reportParams.days}
              onChange={(e) => setReportParams({ ...reportParams, days: parseInt(e.target.value) })}
              className="px-4 py-2 border border-border rounded-lg"
            >
              <option value="7">7 days</option>
              <option value="15">15 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
        )}
      </div>

      {/* Report Content */}
      <div className="mt-6">
        {loading ? (
          <div className="bg-background rounded-lg shadow p-8 text-center">Loading...</div>
        ) : (
          <>
            {activeReport === 'summary' && renderSummaryReport()}
            {activeReport === 'low_stock' && renderLowStockReport()}
            {activeReport === 'expiring' && renderExpiringReport()}
            {activeReport === 'stock_valuation' && renderStockValuationReport()}
          </>
        )}
      </div>
    </div>
  )
}
