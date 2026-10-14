'use client'

/**
 * Choosing a procedure from the clinic's catalogue.
 *
 * The catalogue is small and bounded (tens of rows, not thousands), so it is
 * loaded once — `/api/procedures?all=true&isActive=true`, alphabetical within
 * category — and filtered here as the user types: name, code and category all
 * match. It replaces the unsearchable Radix selects on the treatment plan
 * forms, where finding "Crown" meant a scroll through every heading.
 *
 *   <ProcedurePicker value={procedureId} onSelect={(p) => …} onClear={…} />
 *
 * A form that already holds the list (it needs the prices for totals, say)
 * passes `procedures` and nothing is fetched.
 */
import * as React from 'react'
import Link from 'next/link'
import { SearchSelect, type SearchOption } from '@/components/ui/search-select'
import { formatCurrency } from '@/lib/i18n/format'
import { procedureCategoryConfig } from '@/lib/treatment-utils'

/** What the picker reads of a procedure; the route sends more. */
export interface ProcedureRow {
  id: string
  code: string
  name: string
  category: string
  basePrice?: number | string | null
}

export function procedureCategoryLabel(category: string): string {
  return procedureCategoryConfig[category]?.label || category
}

/**
 * The active catalogue, fetched once per mount. Exported for forms that need
 * the rows themselves (to price a plan) as well as the picker.
 */
export function useProcedureCatalogue<P extends ProcedureRow = ProcedureRow>(enabled = true) {
  const [procedures, setProcedures] = React.useState<P[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!enabled) return
    let current = true
    ;(async () => {
      try {
        const response = await fetch('/api/procedures?all=true&isActive=true')
        if (!response.ok) throw new Error('procedures failed')
        const data = await response.json()
        if (current) {
          setProcedures(data.procedures ?? [])
          setFailed(false)
        }
      } catch {
        if (current) setFailed(true)
      }
    })()
    return () => {
      current = false
    }
  }, [enabled, attempt])

  return {
    procedures: procedures ?? [],
    loading: enabled && procedures === null && !failed,
    failed,
    retry: () => {
      setFailed(false)
      setAttempt((n) => n + 1)
    },
  }
}

export interface ProcedurePickerProps<P extends ProcedureRow = ProcedureRow> {
  /** The chosen procedure's id, or null. */
  value: string | null
  onSelect: (procedure: P) => void
  /** Omit to make the field un-clearable once set. */
  onClear?: () => void
  /** The catalogue, when the form already has it. Omit to fetch it here. */
  procedures?: P[]
  /** Shown while closed. Defaults to the chosen procedure's name from the list. */
  selectedLabel?: string | null
  excludeIds?: readonly string[]
  filter?: (procedure: P) => boolean
  /** Show the base price beside each name. Default true. */
  showPrice?: boolean
  /** Offer "Open the procedure catalogue" when nothing matches. Default true. */
  allowAdd?: boolean
  /** Default "Search by name or code…". */
  placeholder?: string
  /** Default "Procedure". */
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  disabled?: boolean
  id?: string
  className?: string
}

export function ProcedurePicker<P extends ProcedureRow = ProcedureRow>({
  value,
  onSelect,
  onClear,
  procedures: given,
  selectedLabel,
  excludeIds,
  filter,
  showPrice = true,
  allowAdd = true,
  placeholder = 'Search by name or code…',
  'aria-label': ariaLabel = 'Procedure',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  disabled,
  id,
  className,
}: ProcedurePickerProps<P>) {
  const catalogue = useProcedureCatalogue<P>(!given)
  const procedures = given ?? catalogue.procedures

  const options: SearchOption<P>[] = React.useMemo(
    () =>
      procedures
        .filter((p) => !excludeIds?.includes(p.id) && (!filter || filter(p)))
        .map((p) => ({
          id: p.id,
          label: p.name,
          hint: showPrice && p.basePrice != null ? formatCurrency(p.basePrice) : undefined,
          // The category on each row rather than as a heading, so it is
          // searchable rather than merely visible.
          detail: `${p.code} · ${procedureCategoryLabel(p.category)}`,
          data: p,
        })),
    [procedures, excludeIds, filter, showPrice]
  )

  const chosen = procedures.find((p) => p.id === value)

  return (
    <SearchSelect<P>
      id={id}
      className={className}
      value={value}
      selectedLabel={selectedLabel ?? chosen?.name ?? null}
      options={options}
      onSelect={(option) => option.data && onSelect(option.data)}
      onClear={onClear}
      loading={!given && catalogue.loading}
      failed={!given && catalogue.failed}
      onRetry={catalogue.retry}
      noun="procedures"
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      disabled={disabled}
      emptyAction={
        allowAdd ? (
          <Link
            href="/settings/procedures"
            target="_blank"
            className="text-sm text-primary hover:underline"
          >
            Open the procedure catalogue
          </Link>
        ) : undefined
      }
    />
  )
}
