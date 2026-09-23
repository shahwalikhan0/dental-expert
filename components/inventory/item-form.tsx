'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

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
 */

export interface ItemFormValues {
  sku: string
  name: string
  category: string
  itemType: string
  description: string
  unit: string
  currentStock: number
  minimumStock: number
  reorderLevel: number
  maximumStock: string | number
  purchasePrice: number
  sellingPrice: number
  taxCode: string
  taxPercentage: number
  preferredSupplierId: string
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
  description: '',
  unit: '',
  currentStock: 0,
  minimumStock: 0,
  reorderLevel: 0,
  maximumStock: '',
  purchasePrice: 0,
  sellingPrice: 0,
  taxCode: '',
  taxPercentage: 0,
  preferredSupplierId: '',
  storageLocation: '',
  expiryTracking: false,
  batchTracking: false,
  isActive: true,
  notes: '',
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
  const [formData, setFormData] = useState<ItemFormValues>(initial)
  const [categories, setCategories] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])

  // The edit screen loads the item after this mounts, so the form has to take
  // the values when they arrive rather than only at first render.
  useEffect(() => {
    setFormData(initial)
  }, [initial])

  useEffect(() => {
    const load = async (url: string, set: (rows: any[]) => void) => {
      try {
        const res = await fetch(url)
        const data = await res.json()
        if (data.success) set(data.data)
      } catch (error) {
        console.error('Error loading', url, error)
      }
    }
    load('/api/inventory/categories', setCategories)
    load('/api/inventory/suppliers?status=active', setSuppliers)
  }, [])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target

    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked
      setFormData({ ...formData, [name]: checked })
    } else if (type === 'number') {
      setFormData({ ...formData, [name]: parseFloat(value) || 0 })
    } else {
      setFormData({ ...formData, [name]: value })
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-background rounded-lg shadow p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Item Code */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Item Code <span className="text-red-500 dark:text-red-400">*</span>
          </label>
          <input
            type="text"
            name="sku"
            value={formData.sku}
            onChange={handleChange}
            required
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., DM-001"
          />
        </div>

        {/* Item Name */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Item Name <span className="text-red-500 dark:text-red-400">*</span>
          </label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Composite Resin"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Category</label>
          <select
            name="category"
            value={formData.category}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select Category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Item Type */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Item Type <span className="text-red-500 dark:text-red-400">*</span>
          </label>
          <select
            name="itemType"
            value={formData.itemType}
            onChange={handleChange}
            required
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="DENTAL_MATERIAL">Dental Material</option>
            <option value="INSTRUMENT">Instrument</option>
            <option value="CONSUMABLE">Consumable</option>
            <option value="MEDICINE">Medicine</option>
            <option value="OFFICE_SUPPLY">Office Supply</option>
            <option value="EQUIPMENT">Equipment</option>
          </select>
        </div>

        {/* Unit of Measurement */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Unit of Measurement <span className="text-red-500 dark:text-red-400">*</span>
          </label>
          <input
            type="text"
            name="unit"
            value={formData.unit}
            onChange={handleChange}
            required
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., pieces, boxes, bottles, kg"
          />
        </div>

        {/* Current stock is set when the item is created and moved by
              transactions thereafter; the update route does not read it. */}
        {mode === 'create' && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Current Stock</label>
            <input
              type="number"
              name="currentStock"
              value={formData.currentStock}
              onChange={handleChange}
              step="0.01"
              className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Minimum Stock */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Minimum Stock</label>
          <input
            type="number"
            name="minimumStock"
            value={formData.minimumStock}
            onChange={handleChange}
            step="0.01"
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Reorder Point */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Reorder Point</label>
          <input
            type="number"
            name="reorderLevel"
            value={formData.reorderLevel}
            onChange={handleChange}
            step="0.01"
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Maximum Stock */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Maximum Stock</label>
          <input
            type="number"
            name="maximumStock"
            value={formData.maximumStock}
            onChange={handleChange}
            step="0.01"
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Unit Price */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Unit Price (Rs)</label>
          <input
            type="number"
            name="purchasePrice"
            value={formData.purchasePrice}
            onChange={handleChange}
            step="0.01"
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Selling Price */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Selling Price (Rs)
          </label>
          <input
            type="number"
            name="sellingPrice"
            value={formData.sellingPrice}
            onChange={handleChange}
            step="0.01"
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* HSN Code */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">HSN Code</label>
          <input
            type="text"
            name="taxCode"
            value={formData.taxCode}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Tax Percentage */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Tax Percentage (%)
          </label>
          <input
            type="number"
            name="taxPercentage"
            value={formData.taxPercentage}
            onChange={handleChange}
            step="0.01"
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Preferred Supplier */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Preferred Supplier
          </label>
          <select
            name="preferredSupplierId"
            value={formData.preferredSupplierId}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select Supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>

        {/* Storage Location */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Storage Location</label>
          <input
            type="text"
            name="storageLocation"
            value={formData.storageLocation}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Shelf A1"
          />
        </div>
      </div>

      {/* Description */}
      <div className="mt-6">
        <label className="block text-sm font-medium text-foreground mb-2">Description</label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows={3}
          className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Checkboxes */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            name="expiryTracking"
            checked={formData.expiryTracking}
            onChange={handleChange}
            className="w-4 h-4 text-blue-600 dark:text-blue-400"
          />
          <span className="text-sm">Requires Expiry Tracking</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            name="batchTracking"
            checked={formData.batchTracking}
            onChange={handleChange}
            className="w-4 h-4 text-blue-600 dark:text-blue-400"
          />
          <span className="text-sm">Requires Batch Tracking</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            name="isActive"
            checked={formData.isActive}
            onChange={handleChange}
            className="w-4 h-4 text-blue-600 dark:text-blue-400"
          />
          <span className="text-sm">Active</span>
        </label>
      </div>

      {/* Notes */}
      <div className="mt-6">
        <label className="block text-sm font-medium text-foreground mb-2">Notes</label>
        <textarea
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          rows={2}
          className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="mt-6 flex justify-end gap-4">
        <Link
          href={cancelHref}
          className="px-6 py-2 border border-border rounded-lg hover:bg-muted"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={busy}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  )
}
