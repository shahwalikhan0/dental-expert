'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/ui/form-field'
import { MoneyInput, parseMoney } from '@/components/ui/money-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { MedicationPicker, medicationLabel } from '@/components/catalogue/medication-picker'
import { SupplierPicker } from '@/components/inventory/supplier-picker'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { humanise } from '@/lib/labels'
import { toastError } from '@/lib/toast-utils'

/**
 * The inventory item form, shared by the create and edit screens.
 *
 * Extracted when the edit screen was built. The list offered an Edit action all
 * along and pushed at /inventory/<id>/edit, which did not exist; copying this
 * form to build it would have left three hundred lines to keep in step by hand.
 *
 * Current stock is only offered when creating. On an existing item the level is
 * the sum of its movements — receipts, issues, adjustments — and the update
 * route ignores the field entirely. An editable box that silently does nothing
 * is worse than no box.
 *
 * Numbers are kept as typed and read on submit (`itemPayload`), so a typo is
 * flagged rather than saved as zero.
 */

export interface ItemFormValues {
  sku: string
  name: string
  category: string
  itemType: string
  /** The drug catalogue entry this stock is of. Only meaningful for MEDICINE. */
  medicationId: string
  description: string
  unit: string
  currentStock: string
  minimumStock: string
  reorderLevel: string
  maximumStock: string
  purchasePrice: string
  sellingPrice: string
  taxCode: string
  taxPercentage: string
  preferredSupplierId: string
  /** Shown in the supplier picker; not sent. */
  preferredSupplierName: string
  storageLocation: string
  expiryTracking: boolean
  batchTracking: boolean
  isActive: boolean
  notes: string
}

export const EMPTY_ITEM: ItemFormValues = {
  sku: '',
  name: '',
  category: '',
  itemType: 'DENTAL_MATERIAL',
  medicationId: '',
  description: '',
  unit: '',
  currentStock: '0',
  minimumStock: '0',
  reorderLevel: '0',
  maximumStock: '',
  purchasePrice: '',
  sellingPrice: '',
  taxCode: '',
  taxPercentage: '0',
  preferredSupplierId: '',
  preferredSupplierName: '',
  storageLocation: '',
  expiryTracking: false,
  batchTracking: false,
  isActive: true,
  notes: '',
}

const ITEM_TYPES = [
  'DENTAL_MATERIAL',
  'INSTRUMENT',
  'CONSUMABLE',
  'MEDICINE',
  'OFFICE_SUPPLY',
  'EQUIPMENT',
].map((value) => ({ value, label: humanise(value) }))

/** Radix Select cannot hold an empty value; this stands for "no category". */
const NO_CATEGORY = '__none__'

const WHOLE = /^\s*\d+\s*$/
const DECIMAL = /^\s*\d+(\.\d+)?\s*$/

/** A whole number of zero or more; blank reads as `blank`. */
function wholeNumber(raw: string, blank: number | null): number | null | undefined {
  if (!raw.trim()) return blank
  return WHOLE.test(raw) ? parseInt(raw, 10) : undefined
}

/** The body the item routes take. Call only on values that passed validation. */
export function itemPayload(values: ItemFormValues) {
  const { preferredSupplierName, ...rest } = values
  return {
    ...rest,
    sku: values.sku.trim().toUpperCase(),
    currentStock: wholeNumber(values.currentStock, 0) ?? 0,
    minimumStock: wholeNumber(values.minimumStock, 0) ?? 0,
    reorderLevel: wholeNumber(values.reorderLevel, 0) ?? 0,
    maximumStock: wholeNumber(values.maximumStock, null) ?? null,
    purchasePrice: parseMoney(values.purchasePrice),
    // A blank selling price is "not sold", recorded as nothing.
    sellingPrice: values.sellingPrice.trim() ? parseMoney(values.sellingPrice) : 0,
    taxPercentage: values.taxPercentage.trim() ? Number(values.taxPercentage) : 0,
  }
}

type Errors = Partial<Record<keyof ItemFormValues, string>>

function validate(values: ItemFormValues, mode: 'create' | 'edit'): Errors {
  const errors: Errors = {}
  if (!values.sku.trim()) errors.sku = 'Enter an item code.'
  if (!values.name.trim()) errors.name = 'Enter the item’s name.'
  if (!values.unit.trim()) errors.unit = 'Enter the unit it is counted in.'
  if (parseMoney(values.purchasePrice) === null)
    errors.purchasePrice = values.purchasePrice.trim()
      ? 'Enter an amount of zero or more.'
      : 'Enter what the clinic pays for one unit.'
  if (values.sellingPrice.trim() && parseMoney(values.sellingPrice) === null)
    errors.sellingPrice = 'Enter an amount, or leave it blank.'
  const counts = ['minimumStock', 'reorderLevel', 'maximumStock'] as const
  for (const field of mode === 'create' ? (['currentStock', ...counts] as const) : counts) {
    if (wholeNumber(values[field], 0) === undefined) errors[field] = 'A whole number, 0 or more.'
  }
  if (values.taxPercentage.trim()) {
    const rate = Number(values.taxPercentage)
    if (!DECIMAL.test(values.taxPercentage) || rate > 100)
      errors.taxPercentage = 'A percentage from 0 to 100.'
  }
  return errors
}

export function ItemForm({
  mode,
  initial,
  busy,
  cancelHref,
  submitLabel,
  busyLabel,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  initial: ItemFormValues
  busy: boolean
  cancelHref: string
  submitLabel: string
  busyLabel: string
  onSubmit: (values: ItemFormValues) => void | Promise<void>
}) {
  const { toast } = useToast()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard(busy)
  const [formData, setFormData] = useState<ItemFormValues>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [selectedMedicationLabel, setSelectedMedicationLabel] = useState<string | null>(null)

  // The label for an already-linked item, which arrives as an id alone. Without
  // this the edit screen would open showing an empty search box over a real
  // link, and saving would look like it had cleared it.
  useEffect(() => {
    if (!initial.medicationId) return
    let current = true
    fetch(`/api/medications/${initial.medicationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        const med = result?.data ?? result
        if (current && med?.name) setSelectedMedicationLabel(medicationLabel(med))
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [initial.medicationId])

  useEffect(() => {
    fetch('/api/inventory/categories')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setCategories(data.data)
      })
      .catch((error) => console.error('Error loading categories', error))
  }, [])

  const set = <K extends keyof ItemFormValues>(field: K, value: ItemFormValues[K]) => {
    setFormData((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const text = (field: keyof ItemFormValues) => ({
    value: formData[field] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(field, e.target.value),
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const found = validate(formData, mode)
    setErrors(found)
    if (Object.keys(found).length) {
      toast(
        toastError(
          mode === 'create' ? 'create the item' : 'save the item',
          'Check the highlighted fields.'
        )
      )
      const form = e.currentTarget
      requestAnimationFrame(() => {
        const first = form.querySelector<HTMLElement>('[aria-invalid="true"]')
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        first?.focus({ preventScroll: true })
      })
      return
    }
    onSubmit(formData)
  }

  // Stock counts: a whole number, typed as text and read on submit.
  const count = (field: keyof ItemFormValues, label: string) => (
    <FormField label={label} error={errors[field]}>
      {(c) => <Input {...c} type="number" inputMode="numeric" min="0" step="1" {...text(field)} />}
    </FormField>
  )

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Item</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            label="Item code"
            required
            error={errors.sku}
            hint="Stored in capitals, so DM-001 and dm-001 are one item."
          >
            {(c) => (
              <Input
                {...c}
                {...text('sku')}
                // One spelling on the way in; the routes upper-case it too.
                onBlur={() => set('sku', formData.sku.trim().toUpperCase())}
                placeholder="e.g. DM-001"
                autoCapitalize="characters"
              />
            )}
          </FormField>

          <FormField label="Item name" required error={errors.name}>
            {(c) => <Input {...c} {...text('name')} placeholder="e.g. Composite resin" />}
          </FormField>

          <FormField label="Category">
            {(c) => (
              <Select
                value={formData.category || NO_CATEGORY}
                onValueChange={(v) => set('category', v === NO_CATEGORY ? '' : v)}
              >
                <SelectTrigger id={c.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                  {/* A category the list has not loaded yet, or no longer has. */}
                  {formData.category && !categories.some((c) => c.id === formData.category) && (
                    <SelectItem value={formData.category}>{formData.category}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label="Item type" required>
            {(c) => (
              <Select value={formData.itemType} onValueChange={(v) => set('itemType', v)}>
                <SelectTrigger id={c.id} aria-required>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          {/*
            Only for medicine, and only here. Linking stock to the drug
            catalogue is what lets a prescriber see whether what they are about
            to write for is on the shelf — until this existed, the two tables
            had nothing in common but a name that rarely matched exactly.

            Shown conditionally rather than always: on a box of gloves the field
            has no meaning, and a field with no meaning still gets filled in.
          */}
          {formData.itemType === 'MEDICINE' && (
            <FormField
              className="md:col-span-2"
              label="Drug catalogue entry"
              hint="Optional. Linking lets prescribers see this item’s stock while writing a prescription."
            >
              {(c) => (
                <MedicationPicker
                  id={c.id}
                  aria-describedby={c['aria-describedby']}
                  value={formData.medicationId || null}
                  selectedLabel={selectedMedicationLabel}
                  onSelect={(med) => {
                    set('medicationId', med.id)
                    setSelectedMedicationLabel(medicationLabel(med))
                  }}
                  onClear={() => {
                    set('medicationId', '')
                    setSelectedMedicationLabel(null)
                  }}
                />
              )}
            </FormField>
          )}

          <FormField label="Unit of measurement" required error={errors.unit}>
            {(c) => (
              <Input {...c} {...text('unit')} placeholder="e.g. pieces, boxes, bottles, kg" />
            )}
          </FormField>

          <FormField label="Storage location">
            {(c) => <Input {...c} {...text('storageLocation')} placeholder="e.g. Shelf A1" />}
          </FormField>

          <FormField label="Description" className="md:col-span-2">
            {(c) => <Textarea {...c} {...text('description')} rows={3} />}
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stock levels</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Current stock is set when the item is created and moved by
              transactions thereafter; the update route does not read it. */}
          {mode === 'create' && count('currentStock', 'Current stock')}
          {count('minimumStock', 'Minimum stock')}
          {count('reorderLevel', 'Reorder point')}
          {count('maximumStock', 'Maximum stock')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricing and supplier</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Unit price" required error={errors.purchasePrice}>
            {(c) => (
              <MoneyInput
                {...c}
                value={formData.purchasePrice}
                onChange={(raw) => set('purchasePrice', raw)}
              />
            )}
          </FormField>

          <FormField label="Selling price" error={errors.sellingPrice}>
            {(c) => (
              <MoneyInput
                {...c}
                value={formData.sellingPrice}
                onChange={(raw) => set('sellingPrice', raw)}
              />
            )}
          </FormField>

          <FormField label="HSN code">{(c) => <Input {...c} {...text('taxCode')} />}</FormField>

          <FormField label="Tax percentage (%)" error={errors.taxPercentage}>
            {(c) => (
              <Input
                {...c}
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                {...text('taxPercentage')}
              />
            )}
          </FormField>

          <FormField label="Preferred supplier" className="md:col-span-2">
            {(c) => (
              // Active suppliers only (the picker's default).
              <SupplierPicker
                id={c.id}
                aria-describedby={c['aria-describedby']}
                value={formData.preferredSupplierId || null}
                selectedLabel={formData.preferredSupplierName || null}
                onSelect={(s) => {
                  set('preferredSupplierId', s.id)
                  set('preferredSupplierName', s.name)
                }}
                onClear={() => {
                  set('preferredSupplierId', '')
                  set('preferredSupplierName', '')
                }}
                allowAdd
              />
            )}
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tracking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(
              [
                ['expiryTracking', 'Requires expiry tracking'],
                ['batchTracking', 'Requires batch tracking'],
                ['isActive', 'Active'],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className="flex items-center gap-2">
                <Checkbox
                  id={`item-${field}`}
                  checked={formData[field]}
                  onCheckedChange={(checked) => set(field, checked === true)}
                />
                <Label htmlFor={`item-${field}`} className="cursor-pointer font-normal">
                  {label}
                </Label>
              </div>
            ))}
          </div>

          <FormField label="Notes">
            {(c) => <Textarea {...c} {...text('notes')} rows={2} />}
          </FormField>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <SubmitButton busy={busy} busyLabel={busyLabel} icon={Save}>
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  )
}
