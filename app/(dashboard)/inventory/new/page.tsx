'use client'

import { useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'
import { EMPTY_ITEM, ItemForm, type ItemFormValues } from '@/components/inventory/item-form'

export default function NewInventoryItemPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (values: ItemFormValues) => {
    setSaving(true)
    try {
      const res = await fetch('/api/inventory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to create the item')

      toast({ title: 'Item created', description: `${values.name} is now in the catalogue.` })
      router.push('/inventory')
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create the item',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={formRef} className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Add New Inventory Item</h1>
        <Link
          href="/inventory"
          className="px-4 py-2 bg-muted-foreground text-white rounded-lg hover:bg-muted-foreground/80"
        >
          Back to Inventory
        </Link>
      </div>

      <ItemForm
        mode="create"
        initial={EMPTY_ITEM}
        busy={saving}
        cancelHref="/inventory"
        submitLabel="Create Item"
        busyLabel="Creating…"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
