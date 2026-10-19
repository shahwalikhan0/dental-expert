'use client'

import { useState, useEffect, useRef } from 'react'
import { useListParams } from '@/hooks/use-list-params'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Package,
  AlertTriangle,
  FileText,
  TrendingUp,
  Users,
  ShoppingCart,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { ExportMenu } from '@/components/ui/export-menu'
import { humanise } from '@/lib/labels'
import { formatCurrency } from '@/lib/i18n/format'
import { statusLabel } from '@/lib/status'
import { toastError } from '@/lib/toast-utils'

interface InventoryItem {
  id: string
  sku: string
  name: string
  description: string
  itemType: string
  categoryName: string
  supplierName: string
  currentStock: number
  minimumStock: number
  reorderLevel: number
  unit: string
  purchasePrice: number
  sellingPrice: number
  stockStatus: 'out_of_stock' | 'low_stock' | 'reorder' | 'sufficient'
  isActive: boolean
}

interface Category {
  id: string
  name: string
  item_count: number
}

/** InventoryItemType, as the filter offers it. */
const TYPE_OPTIONS = [
  'DENTAL_MATERIAL',
  'INSTRUMENT',
  'CONSUMABLE',
  'MEDICINE',
  'OFFICE_SUPPLY',
  'EQUIPMENT',
].map((value) => ({ value, label: humanise(value) }))

/**
 * The route reads `status=active|inactive`; the labels are the status table's,
 * so the filter and the badge name it the same way.
 */
const STATUS_OPTIONS = [
  { value: 'active', label: statusLabel('inventory', true) },
  { value: 'inactive', label: statusLabel('inventory', false) },
]

/** The inventory's other screens, as tiles under the header. */
const SECTIONS = [
  {
    href: '/inventory/alerts',
    icon: AlertTriangle,
    title: 'Alerts',
    subtitle: 'Low stock and expiry',
  },
  {
    href: '/inventory/purchase-orders',
    icon: ShoppingCart,
    title: 'Purchase orders',
    subtitle: 'Orders and deliveries',
  },
  {
    href: '/inventory/suppliers',
    icon: Users,
    title: 'Suppliers',
    subtitle: 'Who the clinic buys from',
  },
  {
    href: '/inventory/transactions',
    icon: TrendingUp,
    title: 'Transactions',
    subtitle: 'Every movement of stock',
  },
  {
    href: '/inventory/reports',
    icon: FileText,
    title: 'Reports',
    subtitle: 'Value, usage, expiry',
  },
]

export default function InventoryPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Inventory')
  const { toast } = useToast()
  const router = useRouter()
  // A dentist or the manager reads stock (`inventory:read`) but cannot change
  // it; the create and edit actions are not offered to a certain refusal.
  const canWrite = useCan('inventory:write') === true
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  /**
   * Search, filters and page, kept in the address bar, so opening an item and
   * coming back keeps the view.
   */
  const list = useListParams({
    defaults: { category: 'all', type: 'all', status: 'all', lowStock: false },
  })
  const query = list.apiParams().toString()

  const categoryOptions = categories.map((cat) => ({
    value: cat.id,
    label: `${cat.name} (${cat.item_count})`,
  }))

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/inventory/categories')
      if (!response.ok) throw new Error('Failed to fetch categories')
      const data = await response.json()
      setCategories(data.data)
    } catch (error) {
      console.error('Error fetching categories:', error)
      toast(toastError('load the inventory categories', error))
    }
  }

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchItems = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/inventory/items?${query}`)
      if (!response.ok) throw new Error('Failed to fetch inventory items')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setItems(data.data)
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching inventory items:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchItems()
    // The query string is the whole question; `fetchItems` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Manage inventory items and stock levels"
        actions={
          <>
            <ExportMenu
              filename="inventory"
              getData={() =>
                items.map((item) => ({
                  'Item Code': item.sku,
                  Name: item.name,
                  Description: item.description || '',
                  Type: humanise(item.itemType),
                  Category: item.categoryName || 'Uncategorized',
                  Supplier: item.supplierName || '',
                  'Current Stock': item.currentStock,
                  'Minimum Stock': item.minimumStock,
                  'Reorder Point': item.reorderLevel,
                  Unit: item.unit,
                  'Unit Price': item.purchasePrice,
                  'Selling Price': item.sellingPrice,
                  'Stock Status': item.stockStatus,
                  Active: item.isActive ? 'Yes' : 'No',
                }))
              }
            />
            {canWrite && (
              <Button asChild>
                <Link href="/inventory/new">
                  <Plus className="h-4 w-4" />
                  New item
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/*
        The rest of the stock room, one tile each. They were five outline
        buttons in the header, as loud as "New item" and wrapping onto two
        lines; as tiles they read as the sections they are.
      */}
      <nav
        aria-label="Inventory sections"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
      >
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <section.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{section.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {section.subtitle}
              </span>
            </span>
          </Link>
        ))}
      </nav>

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search inventory"
            placeholder="Search by name, item code or description…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Category"
              plural="categories"
              value={list.filters.category}
              onValueChange={(category) => list.setFilter('category', category)}
              options={categoryOptions}
            />
            <FilterSelect
              label="Type"
              plural="types"
              value={list.filters.type}
              onValueChange={(type) => list.setFilter('type', type)}
              options={TYPE_OPTIONS}
            />
            <FilterSelect
              label="Status"
              plural="statuses"
              value={list.filters.status}
              onValueChange={(status) => list.setFilter('status', status)}
              options={STATUS_OPTIONS}
            />
            <Button
              variant={list.filters.lowStock ? 'default' : 'outline'}
              onClick={() => list.setFilter('lowStock', !list.filters.lowStock)}
              aria-pressed={list.filters.lowStock}
            >
              <AlertTriangle className="h-4 w-4" />
              Low stock only
            </Button>
          </>
        }
        active={{
          noun: 'items',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Category',
              value:
                list.filters.category === 'all'
                  ? null
                  : (categories.find((c) => c.id === list.filters.category)?.name ??
                    list.filters.category),
              onClear: () => list.setFilter('category', 'all'),
            },
            {
              label: 'Type',
              value: filterValueLabel(TYPE_OPTIONS, list.filters.type),
              onClear: () => list.setFilter('type', 'all'),
            },
            {
              label: 'Status',
              value: filterValueLabel(STATUS_OPTIONS, list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
            {
              label: 'Only',
              value: list.filters.lowStock ? 'Low stock' : null,
              onClear: () => list.setFilter('lowStock', false),
            },
          ],
        }}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[850px]">
            <TableHeader>
              <TableRow>
                <TableHead>Item code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Stock status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              failed={failed}
              onRetry={fetchItems}
              empty={items.length === 0}
              emptyIcon={Package}
              emptyTitle="No inventory items found"
              emptyDescription={
                list.isFiltered
                  ? 'No item matches these filters.'
                  : 'Nothing is in the stock list yet.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'New item' : undefined
              }
              emptyActionHref={!list.isFiltered && canWrite ? '/inventory/new' : undefined}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {items.map((item) => (
                <ClickableRow
                  key={item.id}
                  href={trail.to(`/inventory/${item.id}`)}
                  label={`Open ${item.name}`}
                >
                  <TableCell>
                    <div className="font-medium">{item.sku}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <Package className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">{item.name}</div>
                        {item.description && (
                          <div className="text-sm text-muted-foreground line-clamp-1">
                            {item.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{item.categoryName || 'Uncategorized'}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{humanise(item.itemType)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">
                        {item.currentStock} {item.unit}
                      </div>
                      <div className="text-xs text-muted-foreground">Min: {item.minimumStock}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{formatCurrency(item.purchasePrice)}</div>
                    {item.sellingPrice > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Selling: {formatCurrency(item.sellingPrice)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge kind="inventory" status={item.stockStatus} />
                      {!item.isActive && <StatusBadge kind="inventory" status={false} />}
                    </div>
                  </TableCell>
                  <GridActionsCell>
                    <DropdownMenu>
                      <IconTooltip label="More actions">
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </IconTooltip>
                      <DropdownMenuContent align="end">
                        {/* No "View details": the row itself opens the item. */}
                        {canWrite && (
                          <>
                            <DropdownMenuItem
                              onClick={() => router.push(trail.to(`/inventory/${item.id}/edit`))}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem
                          onClick={() =>
                            router.push(trail.to(`/inventory/transactions?item=${item.id}`))
                          }
                        >
                          <TrendingUp className="mr-2 h-4 w-4" />
                          Stock history
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="items"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  )
}
