'use client'

import { useEffect, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { EMPTY_ITEM, ItemForm, type ItemFormValues } from '@/components/inventory/item-form'
import { Loader2 } from 'lucide-react'

/**
 * Edit an inventory item.
 *
 * The inventory list has offered this from its row menu since the screen was
 * written, pushing at an address with no page behind it. The API route has had
 * PUT all along.
 */
export default function EditInventoryItemPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const params = useParams()
  const itemId = params.id as string
  const { toast } = useToast()

  const [initial, setInitial] = useState<ItemFormValues>(EMPTY_ITEM)
  const [name, setName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const trail = useTrail(name)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/inventory/items/${itemId}`)
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || 'That item could not be loaded')

        const item = data.data
        setName(item.name)
        setInitial({
          sku: item.sku ?? '',
          name: item.name ?? '',
          category: item.category ?? '',
          itemType: item.itemType ?? 'DENTAL_MATERIAL',
          description: item.description ?? '',
          unit: item.unit ?? '',
          currentStock: Number(item.currentStock ?? 0),
          minimumStock: Number(item.minimumStock ?? 0),
          reorderLevel: Number(item.reorderLevel ?? 0),
          maximumStock: item.maximumStock ?? '',
          purchasePrice: Number(item.purchasePrice ?? 0),
          sellingPrice: Number(item.sellingPrice ?? 0),
          taxCode: item.taxCode ?? '',
          taxPercentage: Number(item.taxPercentage ?? 0),
          preferredSupplierId: item.preferredSupplierId ?? '',
          medicationId: item.medicationId ?? '',
          storageLocation: item.storageLocation ?? '',
          expiryTracking: Boolean(item.expiryTracking),
          batchTracking: Boolean(item.batchTracking),
          isActive: Boolean(item.isActive),
          notes: item.notes ?? '',
        })
      } catch (error) {
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to load the item',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [itemId, toast])

  const handleSubmit = async (values: ItemFormValues) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/inventory/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          maximumStock: values.maximumStock === '' ? null : Number(values.maximumStock),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save the item')

      toast({ title: 'Saved', description: `${values.name} has been updated.` })
      router.push(`/inventory/${itemId}`)
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save the item',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div ref={formRef} className="space-y-6">
      <BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />

      <h1 className="page-title">Edit {name ?? 'item'}</h1>

      <ItemForm
        mode="edit"
        initial={initial}
        busy={saving}
        cancelHref={`/inventory/${itemId}`}
        submitLabel="Save changes"
        busyLabel="Saving…"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
