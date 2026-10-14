'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import {
  EMPTY_ITEM,
  ItemForm,
  itemPayload,
  type ItemFormValues,
} from '@/components/inventory/item-form'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

export default function NewInventoryItemPage() {
  const router = useRouter()
  const trail = useTrail('New item')
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (values: ItemFormValues) => {
    setSaving(true)
    try {
      await readJson(
        await fetch('/api/inventory/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemPayload(values)),
        })
      )
      toast(toastSuccess('Item created', `${values.name} is now in the catalogue.`))
      router.push('/inventory')
    } catch (error) {
      toast(toastError('create the item', error))
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="New inventory item"
        back={<BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />}
      />

      <ItemForm
        mode="create"
        initial={EMPTY_ITEM}
        busy={saving}
        cancelHref={trail.back('/inventory')}
        submitLabel="Create item"
        busyLabel="Creating item…"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
