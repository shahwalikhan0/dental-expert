'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import {
  EMPTY_SUPPLIER,
  SupplierForm,
  supplierPayload,
  type SupplierFormValues,
} from '@/components/inventory/supplier-form'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

/**
 * Edit a supplier.
 *
 * Paired with the detail page and the new-supplier page, which share the form
 * (components/inventory/supplier-form.tsx).
 */
export default function EditSupplierPage() {
  const router = useRouter()
  const params = useParams()
  const supplierId = params.id as string
  const { toast } = useToast()

  const [initial, setInitial] = useState<SupplierFormValues | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const trail = useTrail(initial?.name || null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ data: Record<string, unknown> & Partial<SupplierFormValues> }>(
        await fetch(`/api/inventory/suppliers/${supplierId}`)
      )
      const s = data.data
      const text = (value: unknown) => (value == null ? '' : String(value))
      setInitial({
        ...EMPTY_SUPPLIER,
        code: text(s.code),
        name: text(s.name),
        contactPerson: text(s.contactPerson),
        phone: text(s.phone),
        alternatePhone: text(s.alternatePhone),
        email: text(s.email),
        address: text(s.address),
        city: text(s.city),
        state: text(s.state),
        postalCode: text(s.postalCode),
        taxRegistrationNo: text(s.taxRegistrationNo),
        nationalTaxNo: text(s.nationalTaxNo),
        paymentTerms: text(s.paymentTerms),
        creditLimit: text(s.creditLimit),
        rating: text(s.rating),
        status: text(s.status) || 'ACTIVE',
        notes: text(s.notes),
      })
    } catch (err) {
      console.error('Error loading supplier:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [supplierId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    load()
  }, [load])

  const save = async (form: SupplierFormValues) => {
    setSaving(true)
    try {
      await readJson(
        await fetch(`/api/inventory/suppliers/${supplierId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(supplierPayload(form)),
        })
      )
      toast(toastSuccess('Supplier saved', form.name))
      router.push(`/inventory/suppliers/${supplierId}`)
    } catch (err) {
      toast(toastError(`save supplier ${form.name}`, err))
      setSaving(false)
    }
  }

  const back = <BackLink trail={trail} fallback="/inventory/suppliers" fallbackLabel="Suppliers" />

  if (loading && !initial) return <PageSkeleton variant="form" />

  if (failed || !initial) {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this supplier" onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit ${initial.name || 'supplier'}`} back={back} />
      <SupplierForm
        initial={initial}
        submitLabel="Save changes"
        busyLabel="Saving…"
        cancelHref={trail.back(`/inventory/suppliers/${supplierId}`)}
        saving={saving}
        onSubmit={save}
        onInvalid={() => toast(toastError('save the supplier', 'Check the highlighted fields.'))}
      />
    </div>
  )
}
