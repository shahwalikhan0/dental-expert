'use client'

/**
 * The supplier form, for both the new and the edit page.
 *
 * A supplier is a primary record (docs/UX_STANDARDS.md §5) — purchase orders,
 * stock receipts and preferred-source links hang off it — so it is created and
 * edited on a page, not in a dialog. Creating one had been a placeholder modal
 * that said "use the API directly"; editing was already a page. Both now share
 * this form, so the two cannot drift.
 */
import * as React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FormActions, FormSection } from '@/components/ui/form-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/ui/form-field'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput, parseMoney } from '@/components/ui/money-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { useFormGuard } from '@/hooks/use-form-guard'
import { statusOptions } from '@/lib/status'
import { Save } from 'lucide-react'

/** ACTIVE, INACTIVE, BLOCKED — VendorStatus, named as the badge names it. */
const STATUSES = statusOptions('supplier')

export interface SupplierFormValues {
  code: string
  name: string
  contactPerson: string
  phone: string
  alternatePhone: string
  email: string
  address: string
  city: string
  state: string
  postalCode: string
  taxRegistrationNo: string
  nationalTaxNo: string
  paymentTerms: string
  creditLimit: string
  rating: string
  status: string
  notes: string
}

export const EMPTY_SUPPLIER: SupplierFormValues = {
  code: '',
  name: '',
  contactPerson: '',
  phone: '',
  alternatePhone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  taxRegistrationNo: '',
  nationalTaxNo: '',
  paymentTerms: '',
  creditLimit: '',
  rating: '',
  status: 'ACTIVE',
  notes: '',
}

/** The body the supplier routes take. */
export function supplierPayload(form: SupplierFormValues) {
  return {
    ...form,
    // Payment terms are free text — clinics write "Net 30", "On delivery",
    // "50% advance". Coercing to a number would have turned every one of those
    // into NaN.
    paymentTerms: form.paymentTerms.trim() || null,
    // Empty means "not set", not zero — a blank credit limit is not a limit of
    // nothing.
    creditLimit: form.creditLimit.trim() === '' ? null : parseMoney(form.creditLimit),
    rating: form.rating === '' ? null : Number(form.rating),
  }
}

type Errors = Partial<Record<keyof SupplierFormValues, string>>

function validate(form: SupplierFormValues, requirePhone: boolean): Errors {
  const errors: Errors = {}
  if (!form.code.trim()) errors.code = 'Enter a supplier code — orders are matched on it.'
  if (!form.name.trim()) errors.name = 'Enter the supplier’s name.'
  if (requirePhone && !form.phone.trim()) errors.phone = 'Enter a phone number.'
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    errors.email = 'Enter an email address like name@example.com.'
  if (form.creditLimit.trim() && parseMoney(form.creditLimit) === null)
    errors.creditLimit = 'Enter an amount, or leave it blank.'
  if (form.rating !== '') {
    const rating = Number(form.rating)
    if (!Number.isInteger(rating) || rating < 0 || rating > 5)
      errors.rating = 'A whole number from 0 to 5.'
  }
  return errors
}

export interface SupplierFormProps {
  initial: SupplierFormValues
  /** "Create supplier" or "Save changes". */
  submitLabel: string
  busyLabel: string
  /** The create route requires a phone; the edit route does not. */
  requirePhone?: boolean
  cancelHref: string
  saving: boolean
  /** Called with valid values. Throwing is the caller's business (its toast). */
  onSubmit: (values: SupplierFormValues) => void
  /** Called when validation fails, for the summary toast. */
  onInvalid: () => void
}

export function SupplierForm({
  initial,
  submitLabel,
  busyLabel,
  requirePhone = false,
  cancelHref,
  saving,
  onSubmit,
  onInvalid,
}: SupplierFormProps) {
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard(saving)
  const [form, setForm] = React.useState(initial)
  const [errors, setErrors] = React.useState<Errors>({})

  const set = (field: keyof SupplierFormValues, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const found = validate(form, requirePhone)
    setErrors(found)
    if (Object.keys(found).length) {
      onInvalid()
      const node = event.currentTarget as HTMLFormElement
      requestAnimationFrame(() => {
        const first = node.querySelector<HTMLElement>('[aria-invalid="true"]')
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        first?.focus({ preventScroll: true })
      })
      return
    }
    onSubmit(form)
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
      <FormSection title="Identity" description="The code orders are matched on, and its standing">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Supplier code" required error={errors.code}>
            {(c) => (
              <Input {...c} value={form.code} onChange={(e) => set('code', e.target.value)} />
            )}
          </FormField>
          <FormField label="Name" required error={errors.name}>
            {(c) => (
              <Input {...c} value={form.name} onChange={(e) => set('name', e.target.value)} />
            )}
          </FormField>
          <FormField label="Status">
            {(c) => (
              <Select value={form.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger id={c.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Rating (out of 5)" error={errors.rating}>
            {(c) => (
              <Input
                {...c}
                type="number"
                inputMode="numeric"
                min="0"
                max="5"
                step="1"
                value={form.rating}
                onChange={(e) => set('rating', e.target.value)}
              />
            )}
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Contact" description="Who to call and where they are">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Contact person">
            {(c) => (
              <Input
                {...c}
                value={form.contactPerson}
                onChange={(e) => set('contactPerson', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Email" error={errors.email}>
            {(c) => (
              <Input
                {...c}
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Phone" required={requirePhone} error={errors.phone}>
            {(c) => <PhoneInput {...c} value={form.phone} onChange={(v) => set('phone', v)} />}
          </FormField>
          <FormField label="Alternate phone">
            {(c) => (
              <PhoneInput
                {...c}
                value={form.alternatePhone}
                onChange={(v) => set('alternatePhone', v)}
              />
            )}
          </FormField>
          <FormField label="Address" className="md:col-span-2">
            {(c) => (
              <Input {...c} value={form.address} onChange={(e) => set('address', e.target.value)} />
            )}
          </FormField>
          <FormField label="City">
            {(c) => (
              <Input {...c} value={form.city} onChange={(e) => set('city', e.target.value)} />
            )}
          </FormField>
          <FormField label="Postal code">
            {(c) => (
              <Input
                {...c}
                value={form.postalCode}
                onChange={(e) => set('postalCode', e.target.value)}
              />
            )}
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Trading terms" description="Payment, credit and tax registration">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Payment terms">
            {(c) => (
              <Input
                {...c}
                value={form.paymentTerms}
                onChange={(e) => set('paymentTerms', e.target.value)}
                placeholder="e.g. Net 30 days, On delivery"
              />
            )}
          </FormField>
          <FormField label="Credit limit" error={errors.creditLimit}>
            {(c) => (
              <MoneyInput
                {...c}
                value={form.creditLimit}
                onChange={(raw) => set('creditLimit', raw)}
              />
            )}
          </FormField>
          <FormField label="Sales tax number">
            {(c) => (
              <Input
                {...c}
                value={form.taxRegistrationNo}
                onChange={(e) => set('taxRegistrationNo', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="National tax number">
            {(c) => (
              <Input
                {...c}
                value={form.nationalTaxNo}
                onChange={(e) => set('nationalTaxNo', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Notes" className="md:col-span-2">
            {(c) => (
              <Textarea
                {...c}
                rows={3}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            )}
          </FormField>
        </div>
      </FormSection>

      <FormActions>
        <Button type="button" variant="outline" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <SubmitButton busy={saving} busyLabel={busyLabel} icon={Save}>
          {submitLabel}
        </SubmitButton>
      </FormActions>
    </form>
  )
}
