'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency } from '@/lib/i18n/format'

interface Supplier {
  id: string
  name: string
  code: string
}

interface Item {
  id: string
  sku: string
  name: string
  unit: string
  currentStock: number
  minimumStock: number
  purchasePrice: string
}

interface Line {
  itemId: string
  quantity: number
  unitPrice: number
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  // The earliest delivery date the picker offers. Set after mount: the
  // server's today and the browser's can differ around midnight, and a
  // differing `min` would be a hydration mismatch.
  const [today, setToday] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const now = new Date()
    setToday(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    )
  }, [])

  useEffect(() => {
    Promise.all([
      // Active suppliers and items only: an order naming an inactive one is
      // refused (finding 44), and deleted items are never listed (finding 58).
      fetch('/api/inventory/suppliers?status=active&limit=100&sort=name').then((r) => r.json()),
      fetch('/api/inventory/items?status=active&limit=500').then((r) => r.json()),
    ])
      .then(([supplierData, itemData]) => {
        if (supplierData.success) setSuppliers(supplierData.data)
        if (itemData.success) setItems(itemData.data)
      })
      .catch((err) => console.error('Error loading order form:', err))
  }, [])

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const addLine = () =>
    setLines((current) => [...current, { itemId: '', quantity: 1, unitPrice: 0 }])

  const updateLine = (index: number, changes: Partial<Line>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...changes } : line)))

  const removeLine = (index: number) => setLines((current) => current.filter((_, i) => i !== index))

  // Choosing an item fills in the price the clinic already pays, so a routine
  // reorder does not have to be retyped from the last invoice.
  const chooseItem = (index: number, itemId: string) => {
    const item = itemById.get(itemId)
    updateLine(index, { itemId, unitPrice: item ? Number(item.purchasePrice) : 0 })
  }

  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)

  const save = async (place: boolean) => {
    const fail = (description: string) => {
      toast({ variant: 'destructive', title: 'Could not save the order', description })
    }

    if (!supplierId) return fail('Choose a supplier')
    if (lines.length === 0) return fail('Add at least one item')
    if (lines.some((line) => !line.itemId)) return fail('Every line needs an item')

    setSaving(true)
    try {
      const response = await fetch('/api/inventory/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId,
          expectedDate: expectedDate || null,
          notes: notes || null,
          status: place ? 'ORDERED' : 'DRAFT',
          items: lines,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        fail(data.error || 'The server refused the order.')
        return
      }

      router.push(`/inventory/purchase-orders/${data.data.id}`)
    } catch (err) {
      console.error('Error saving purchase order:', err)
      fail('The order could not be sent. Check the connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={formRef} className="mx-auto max-w-5xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="page-title">New Purchase Order</h1>
        <Link
          href="/inventory/purchase-orders"
          className="px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/80"
        >
          Cancel
        </Link>
      </div>

      <div className="bg-background rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="supplier" className="block text-sm font-medium mb-1">
              Supplier
            </label>
            <select
              id="supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full px-4 py-2 border border-border rounded-lg"
            >
              <option value="">Choose a supplier…</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name} ({supplier.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="expected" className="block text-sm font-medium mb-1">
              Expected delivery
            </label>
            <input
              id="expected"
              type="date"
              value={expectedDate}
              min={today || undefined}
              onChange={(e) => setExpectedDate(e.target.value)}
              className="w-full px-4 py-2 border border-border rounded-lg"
            />
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="notes" className="block text-sm font-medium mb-1">
            Notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-4 py-2 border border-border rounded-lg"
          />
        </div>
      </div>

      <div className="bg-background rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Items</h2>
          <button
            type="button"
            onClick={addLine}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Add line
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on this order yet.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line, index) => {
              const item = itemById.get(line.itemId)
              return (
                <div key={index} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6">
                    <label className="block text-xs text-muted-foreground mb-1">Item</label>
                    <select
                      value={line.itemId}
                      onChange={(e) => chooseItem(index, e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                    >
                      <option value="">Choose an item…</option>
                      {items.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} ({option.sku})
                        </option>
                      ))}
                    </select>
                    {item && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {item.currentStock} {item.unit} in stock, minimum {item.minimumStock}
                      </p>
                    )}
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs text-muted-foreground mb-1">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(index, { quantity: parseInt(e.target.value, 10) || 0 })
                      }
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs text-muted-foreground mb-1">Unit price</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) =>
                        updateLine(index, { unitPrice: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                    />
                  </div>

                  <div className="col-span-1 text-sm text-right pb-2">
                    {formatCurrency(line.quantity * line.unitPrice)}
                  </div>

                  <div className="col-span-1 pb-1">
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="px-2 py-1 text-sm text-red-600 hover:underline dark:text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {lines.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border text-right">
            <span className="text-sm text-muted-foreground mr-3">Subtotal before tax</span>
            <span className="text-lg font-semibold">{formatCurrency(subtotal)}</span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => save(false)}
          className="px-4 py-2 border border-border rounded-lg hover:bg-muted disabled:opacity-50"
        >
          Save as draft
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => save(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          Save and place order
        </button>
      </div>

      {/* Receiving is only possible against a placed order: goods arriving
          against something nobody sent is a stock adjustment, not a delivery. */}
      <p className="text-xs text-muted-foreground text-right mt-2">
        A draft can be edited later. Goods can only be received against a placed order.
      </p>
    </div>
  )
}
