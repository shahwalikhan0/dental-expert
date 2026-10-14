'use client'

/**
 * Choosing a drug from the clinic's catalogue.
 *
 * Replaces three copies of the same effect (the prescription form, the
 * prescription template editor, the inventory item form), one of which said
 * "No medication of that name in the catalogue" before anybody had typed. It
 * now opens onto the first ten active drugs alphabetically and searches name,
 * generic name and manufacturer from the second character.
 *
 *   <MedicationPicker
 *     value={row.medicationId}
 *     selectedLabel={row.medicationName}
 *     onSelect={(med) => …}
 *     onClear={() => …}
 *   />
 */
import * as React from 'react'
import Link from 'next/link'
import { SearchSelect, type SearchOption } from '@/components/ui/search-select'
import { useCatalogueSearch } from '@/hooks/use-catalogue-search'

/** What the picker reads of a catalogue row; the route sends more. */
export interface MedicationRow {
  id: string
  name: string
  genericName?: string | null
  strength?: string | null
  form?: string | null
}

/** `Amoxicillin 500mg` — the name a prescription line shows. */
export function medicationLabel(med: MedicationRow): string {
  return `${med.name}${med.strength ? ` ${med.strength}` : ''}`
}

export interface MedicationPickerProps<M extends MedicationRow = MedicationRow> {
  /** The linked medication's id, or null. */
  value: string | null
  /** Shown while closed with a value — the line's stored medication name. */
  selectedLabel?: string | null
  onSelect: (medication: M) => void
  /** Omit to make the field un-clearable once set. */
  onClear?: () => void
  /** Leave these out — drugs already on the prescription, say. */
  excludeIds?: readonly string[]
  filter?: (medication: M) => boolean
  /** Only active catalogue entries. Default true. */
  activeOnly?: boolean
  /**
   * Offer "Add it to the drug catalogue" (opens /medications in a new tab)
   * when nothing matches. Default true.
   */
  allowAdd?: boolean
  /** Default "Search by name or generic name…". */
  placeholder?: string
  /** Default "Medication". */
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  disabled?: boolean
  id?: string
  className?: string
}

export function MedicationPicker<M extends MedicationRow = MedicationRow>({
  value,
  selectedLabel,
  onSelect,
  onClear,
  excludeIds,
  filter,
  activeOnly = true,
  allowAdd = true,
  placeholder = 'Search by name or generic name…',
  'aria-label': ariaLabel = 'Medication',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  disabled,
  id,
  className,
}: MedicationPickerProps<M>) {
  // Nothing is fetched until the list is first opened.
  const [opened, setOpened] = React.useState(false)
  const search = useCatalogueSearch<M>({
    enabled: opened,
    endpoint: '/api/medications',
    // Alphabetical: the grid's newest-first order is no use to somebody
    // scanning for a name.
    params: { sort: 'name', active: activeOnly ? 'true' : undefined },
  })

  const options: SearchOption<M>[] = search.results
    .filter((med) => !excludeIds?.includes(med.id) && (!filter || filter(med)))
    .map((med) => ({
      id: med.id,
      label: medicationLabel(med),
      hint: med.form || undefined,
      detail: med.genericName || undefined,
      data: med,
    }))

  return (
    <SearchSelect<M>
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
      noun="medications"
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      disabled={disabled}
      emptyAction={
        allowAdd ? (
          <Link
            href="/medications"
            target="_blank"
            className="text-sm text-primary hover:underline"
          >
            Add it to the drug catalogue
          </Link>
        ) : undefined
      }
    />
  )
}
