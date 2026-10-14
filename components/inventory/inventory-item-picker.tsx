'use client'

/**
 * Choosing a stock item: for a purchase order line, a stock movement, or a
 * product sold on an invoice.
 *
 * Replaces the native `<select>`s that loaded up to a thousand items into one
 * list. Each row shows what is on the shelf — "12 box in stock" — because that
 * is the question somebody picking an item is usually also asking.
 *
 *   <InventoryItemPicker value={itemId} selectedLabel={itemName} onSelect={…} />
 *
 * Two sources, the same rows:
 *
 *   - `/api/inventory/items?status=active` (the default) — the stock list,
 *     newest first, behind `inventory:read`;
 *   - `/api/billing/products` — active items with their selling price, behind
 *     `billing:write`, for the invoice forms: reception and the accountant
 *     raise invoices but do not hold `inventory:read`, and a sale has no use
 *     for purchase prices or suppliers. Pass `endpoint="/api/billing/products"
 *     showPrice`.
 */
import * as React from 'react'
import { SearchSelect, type SearchOption } from '@/components/ui/search-select'
import { useCatalogueSearch } from '@/hooks/use-catalogue-search'
import { formatCurrency } from '@/lib/i18n/format'

/** What the picker reads of an item. Both routes send at least this. */
export interface InventoryItemRow {
  id: string
  name: string
  sku?: string | null
  unit?: string | null
  currentStock?: number | null
  sellingPrice?: number | string | null
}

/** `SKU-001 · 12 box in stock` */
export function stockLine(item: InventoryItemRow): string {
  const stock =
    item.currentStock != null ? `${item.currentStock} ${item.unit ?? ''}`.trim() + ' in stock' : ''
  return [item.sku, stock].filter(Boolean).join(' · ')
}

export interface InventoryItemPickerProps<I extends InventoryItemRow = InventoryItemRow> {
  /** The chosen item's id, or null. For an "add a line" picker, pass null. */
  value: string | null
  /** Shown while closed with a value. */
  selectedLabel?: string | null
  onSelect: (item: I) => void
  /** Omit to make the field un-clearable once set. */
  onClear?: () => void
  /**
   * The list route. Default `/api/inventory/items`. Use
   * `/api/billing/products` on billing screens (see above).
   */
  endpoint?: string
  /**
   * Query parameters. Default `{ status: 'active' }` for the stock list, none
   * for any other endpoint.
   */
  params?: Record<string, string | number | boolean | null | undefined>
  /** Leave these out — items already on the order. */
  excludeIds?: readonly string[]
  filter?: (item: I) => boolean
  /** Show the selling price beside each name ("No selling price" when unset). */
  showPrice?: boolean
  /** Default "Search by name or SKU…". */
  placeholder?: string
  /** Default "Item". */
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  /** Plural noun for the empty message, "No <noun> match “x”." Default "items". */
  noun?: string
  /** Overrides the standard empty message. Prefer `noun`. */
  emptyMessage?: React.ReactNode
  emptyAction?: React.ReactNode
  disabled?: boolean
  id?: string
  className?: string
}

export function InventoryItemPicker<I extends InventoryItemRow = InventoryItemRow>({
  value,
  selectedLabel,
  onSelect,
  onClear,
  endpoint = '/api/inventory/items',
  params,
  excludeIds,
  filter,
  showPrice = false,
  placeholder = 'Search by name or SKU…',
  'aria-label': ariaLabel = 'Item',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  noun = 'items',
  emptyMessage,
  emptyAction,
  disabled,
  id,
  className,
}: InventoryItemPickerProps<I>) {
  // Nothing is fetched until the list is first opened.
  const [opened, setOpened] = React.useState(false)
  const search = useCatalogueSearch<I>({
    enabled: opened,
    endpoint,
    params: params ?? (endpoint === '/api/inventory/items' ? { status: 'active' } : undefined),
  })

  const options: SearchOption<I>[] = search.results
    .filter((item) => !excludeIds?.includes(item.id) && (!filter || filter(item)))
    .map((item) => ({
      id: item.id,
      label: item.name,
      hint: showPrice
        ? item.sellingPrice != null
          ? formatCurrency(item.sellingPrice)
          : 'No selling price'
        : undefined,
      detail: stockLine(item) || undefined,
      data: item,
    }))

  return (
    <SearchSelect<I>
      id={id}
      className={className}
      value={value}
      selectedLabel={selectedLabel}
      options={options}
      onSelect={(option) => option.data && onSelect(option.data)}
      onClear={onClear}
      onSearchChange={search.setTerm}
      onOpen={() => setOpened(true)}
      preload
      loading={search.searching}
      failed={search.failed}
      onRetry={search.retry}
      total={search.total}
      noun={noun}
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      disabled={disabled}
    />
  )
}
