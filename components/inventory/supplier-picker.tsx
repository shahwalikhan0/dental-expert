'use client'

/**
 * Choosing a supplier, for a purchase order or a stock receipt.
 *
 * Replaces the native `<select>`s capped at a hundred suppliers. Opens onto
 * the first ten active suppliers alphabetically and searches name, code and
 * contact person from the second character.
 *
 *   <SupplierPicker value={supplierId} selectedLabel={supplierName} onSelect={…} />
 *
 * Laboratories live in the same table but are not suppliers; the route keeps
 * them out. A lab vendor is a short bounded list — use a Radix `Select`.
 */
import * as React from 'react'
import Link from 'next/link'
import { SearchSelect, type SearchOption } from '@/components/ui/search-select'
import { useCatalogueSearch } from '@/hooks/use-catalogue-search'
import { formatPhone } from '@/lib/utils'

/** What the picker reads of a supplier; the route sends more. */
export interface SupplierRow {
  id: string
  name: string
  code?: string | null
  contactPerson?: string | null
  phone?: string | null
  status?: string | null
}

export interface SupplierPickerProps<S extends SupplierRow = SupplierRow> {
  /** The chosen supplier's id, or null. */
  value: string | null
  /** Shown while closed with a value. */
  selectedLabel?: string | null
  onSelect: (supplier: S) => void
  /** Omit to make the field un-clearable once set. */
  onClear?: () => void
  /** Only active suppliers. Default true; false also lists inactive and blocked. */
  activeOnly?: boolean
  excludeIds?: readonly string[]
  filter?: (supplier: S) => boolean
  /** Offer "Add a supplier" (opens /inventory/suppliers in a new tab). Default false. */
  allowAdd?: boolean
  /** Default "Search by name, code or contact…". */
  placeholder?: string
  /** Default "Supplier". */
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  disabled?: boolean
  id?: string
  className?: string
}

export function SupplierPicker<S extends SupplierRow = SupplierRow>({
  value,
  selectedLabel,
  onSelect,
  onClear,
  activeOnly = true,
  excludeIds,
  filter,
  allowAdd = false,
  placeholder = 'Search by name, code or contact…',
  'aria-label': ariaLabel = 'Supplier',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  disabled,
  id,
  className,
}: SupplierPickerProps<S>) {
  // Nothing is fetched until the list is first opened.
  const [opened, setOpened] = React.useState(false)
  const search = useCatalogueSearch<S>({
    enabled: opened,
    endpoint: '/api/inventory/suppliers',
    params: { sort: 'name', status: activeOnly ? 'ACTIVE' : undefined },
  })

  const options: SearchOption<S>[] = search.results
    .filter((s) => !excludeIds?.includes(s.id) && (!filter || filter(s)))
    .map((s) => ({
      id: s.id,
      label: s.name,
      hint: s.code || undefined,
      detail: [s.contactPerson, formatPhone(s.phone)].filter(Boolean).join(' · ') || undefined,
      data: s,
    }))

  return (
    <SearchSelect<S>
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
      noun="suppliers"
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      disabled={disabled}
      emptyAction={
        allowAdd ? (
          <Link
            href="/inventory/suppliers"
            target="_blank"
            className="text-sm text-primary hover:underline"
          >
            Add a supplier
          </Link>
        ) : undefined
      }
    />
  )
}
