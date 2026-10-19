'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import {
  EMPTY_ITEM,
  ItemForm,
  itemPayload,
  type ItemFormValues,
} from '@/components/inventory/item-form'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

/**
 * Edit an inventory item.
 *
 * The inventory list has offered this from its row menu since the screen was
 * written, pushing at an address with no page behind it. The API route has had
 * PUT all along.
 */
export default function EditInventoryItemPage() {
  const router = useRouter()
  const params = useParams()
  const itemId = params.id as string
  const { toast } = useToast()

  const [initial, setInitial] = useState<ItemFormValues | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const trail = useTrail(initial?.name ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ data: any }>(await fetch(`/api/inventory/items/${itemId}`))
      const item = data.data
      const text = (value: unknown, fallback = '') => (value == null ? fallback : String(value))
      setInitial({
        ...EMPTY_ITEM,
        sku: text(item.sku),
        name: text(item.name),
        category: text(item.category),
        itemType: text(item.itemType, 'DENTAL_MATERIAL'),
        description: text(item.description),
        unit: text(item.unit),
        currentStock: text(item.currentStock, '0'),
        minimumStock: text(item.minimumStock, '0'),
        reorderLevel: text(item.reorderLevel, '0'),
        maximumStock: text(item.maximumStock),
        purchasePrice: text(item.purchasePrice),
        sellingPrice: text(item.sellingPrice),
        taxCode: text(item.taxCode),
        taxPercentage: text(item.taxPercentage, '0'),
        preferredSupplierId: text(item.preferredSupplierId),
        preferredSupplierName: text(item.supplierName),
        medicationId: text(item.medicationId),
        storageLocation: text(item.storageLocation),
        expiryTracking: Boolean(item.expiryTracking),
        batchTracking: Boolean(item.batchTracking),
        isActive: Boolean(item.isActive),
        notes: text(item.notes),
      })
    } catch (error) {
      console.error('Error loading the item:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    load()
  }, [load])

  const handleSubmit = async (values: ItemFormValues) => {
    setSaving(true)
    try {
      await readJson(
        await fetch(`/api/inventory/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemPayload(values)),
        })
      )
      toast(toastSuccess('Item saved', `${values.name} has been updated.`))
      router.push(`/inventory/${itemId}`)
    } catch (error) {
      toast(toastError(`save ${values.name || 'the item'}`, error))
      setSaving(false)
    }
  }

  const back = <BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />

  if (loading && !initial) return <PageSkeleton variant="form" />

  if (failed || !initial) {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this item" onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit ${initial.name || 'item'}`} back={back} />

      <ItemForm
        mode="edit"
        initial={initial}
        busy={saving}
        cancelHref={trail.back(`/inventory/${itemId}`)}
        submitLabel="Save changes"
        busyLabel="Saving…"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
