'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import {
  EMPTY_SUPPLIER,
  SupplierForm,
  supplierPayload,
  type SupplierFormValues,
} from '@/components/inventory/supplier-form'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

/**
 * A new supplier.
 *
 * A page rather than a dialog: a supplier is a primary record with orders,
 * receipts and items hanging off it (docs/UX_STANDARDS.md §5), and its edit
 * screen was already a page. This replaces a placeholder modal on the list
 * that only said to use the API.
 */
export default function NewSupplierPage() {
  const router = useRouter()
  const trail = useTrail('New supplier')
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const save = async (form: SupplierFormValues) => {
    setSaving(true)
    try {
      const data = await readJson<{ data: { id: string } }>(
        await fetch('/api/inventory/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(supplierPayload(form)),
        })
      )
      toast(toastSuccess('Supplier created', form.name))
      router.push(`/inventory/suppliers/${data.data.id}`)
    } catch (err) {
      toast(toastError('create the supplier', err))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New supplier"
        back={<BackLink trail={trail} fallback="/inventory/suppliers" fallbackLabel="Suppliers" />}
      />
      <SupplierForm
        initial={EMPTY_SUPPLIER}
        submitLabel="Create supplier"
        busyLabel="Creating supplier…"
        requirePhone
        cancelHref={trail.back('/inventory/suppliers')}
        saving={saving}
        onSubmit={save}
        onInvalid={() => toast(toastError('create the supplier', 'Check the highlighted fields.'))}
      />
    </div>
  )
}
