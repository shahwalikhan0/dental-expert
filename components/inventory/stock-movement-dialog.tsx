'use client'

/**
 * Recording a stock movement by hand: used in treatment, an adjustment, a
 * write-off, a return, a purchase with no order behind it.
 *
 * A dialog rather than a page: a movement is a small record of five fields,
 * made from the movements list (docs/UX_STANDARDS.md §5). It was a hand-built
 * `fixed inset-0` modal with native selects listing up to a thousand items;
 * the item and the supplier are now the shared pickers, which offer active
 * records only.
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
import {
  InventoryItemPicker,
  type InventoryItemRow,
} from '@/components/inventory/inventory-item-picker'
import { SupplierPicker } from '@/components/inventory/supplier-picker'
import { useToast } from '@/hooks/use-toast'
import { displayDate, isoDay } from '@/lib/dates'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

/**
 * The movements a person records by hand, in the API's own spelling.
 *
 * The form used to offer `adjustment`, `usage` and `wastage`, none of which is
 * a `StockTransactionType` — the route answered 400 for all three, so the only
 * movements this screen could record were a purchase and a return. A
 * delivery against an order is booked in on the order, not here.
 */
export const RECORDABLE_TYPES = [
  { value: 'CONSUMPTION', label: 'Used in treatment' },
  { value: 'ADJUSTMENT_IN', label: 'Adjustment (add)' },
  { value: 'ADJUSTMENT_OUT', label: 'Adjustment (remove)' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'RETURNED', label: 'Returned to supplier' },
  { value: 'PURCHASE', label: 'Purchase (no order)' },
]

/** What the form reads of a stock item. */
export interface MovementItem extends InventoryItemRow {
  batchTracking?: boolean
  purchasePrice?: string | number | null
  isActive?: boolean
}

interface Batch {
  id: string
  batchNumber: string
  remainingQty: number
  expiryDate: string | null
}

interface Errors {
  item?: string
  quantity?: string
  unitPrice?: string
  transactionDate?: string
  batch?: string
}

function parseQuantity(raw: string): number | null {
  if (!/^\s*\d+\s*$/.test(raw)) return null
  const value = parseInt(raw, 10)
  return value >= 1 ? value : null
}

export interface StockMovementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The item the screen was opened about, chosen already. */
  initialItem?: MovementItem | null
  /** After a movement is saved. */
  onRecorded: () => void
}

export function StockMovementDialog({
  open,
  onOpenChange,
  initialItem,
  onRecorded,
}: StockMovementDialogProps) {
  const { toast } = useToast()
  const [type, setType] = React.useState('CONSUMPTION')
  const [item, setItem] = React.useState<MovementItem | null>(initialItem ?? null)
  const [batchId, setBatchId] = React.useState('')
  const [batches, setBatches] = React.useState<Batch[]>([])
  const [quantity, setQuantity] = React.useState('')
  const [unitPrice, setUnitPrice] = React.useState(
    initialItem?.purchasePrice != null ? String(Number(initialItem.purchasePrice)) : ''
  )
  const [transactionDate, setTransactionDate] = React.useState(() => isoDay(new Date()))
  const [supplier, setSupplier] = React.useState<{ id: string; name: string } | null>(null)
  const [notes, setNotes] = React.useState('')
  const [errors, setErrors] = React.useState<Errors>({})
  const [saving, setSaving] = React.useState(false)

  // The handed item can arrive after the dialog is first drawn (it is fetched
  // by the page); take it while nothing else has been chosen.
  const [seenInitial, setSeenInitial] = React.useState(initialItem?.id ?? null)
  if ((initialItem?.id ?? null) !== seenInitial) {
    setSeenInitial(initialItem?.id ?? null)
    if (initialItem && !item) {
      setItem(initialItem)
      setUnitPrice(
        initialItem.purchasePrice != null ? String(Number(initialItem.purchasePrice)) : ''
      )
    }
  }

  const needsBatch = !!item?.batchTracking

  /**
   * The batches of a batch-tracked item, for the picker (finding 19). Every
   * movement of such an item names its batch, so the batches keep adding up
   * to the item's stock.
   */
  React.useEffect(() => {
    if (!item?.id || !needsBatch) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBatches([])
      return
    }
    let cancelled = false
    fetch(`/api/inventory/items/${item.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.success) setBatches(data.data.batches ?? [])
      })
      .catch((err) => console.error('Error loading batches:', err))
    return () => {
      cancelled = true
    }
  }, [item?.id, needsBatch])

  const reset = () => {
    setType('CONSUMPTION')
    setItem(null)
    setBatchId('')
    setQuantity('')
    setUnitPrice('')
    setTransactionDate(isoDay(new Date()))
    setSupplier(null)
    setNotes('')
    setErrors({})
  }

  // A new item means a new batch list, and its own price.
  const chooseItem = (chosen: MovementItem) => {
    setItem(chosen)
    setBatchId('')
    setUnitPrice(chosen.purchasePrice != null ? String(Number(chosen.purchasePrice)) : '')
    setErrors((e) => ({ ...e, item: undefined, batch: undefined }))
  }

  const validate = (): Errors => {
    const found: Errors = {}
    if (!item) found.item = 'Choose an item.'
    if (parseQuantity(quantity) === null) found.quantity = 'A whole number, at least 1.'
    if (unitPrice.trim() && parseMoney(unitPrice) === null)
      found.unitPrice = 'Enter an amount, or leave it blank.'
    if (!transactionDate) found.transactionDate = 'Choose a date.'
    if (needsBatch && !batchId)
      found.batch = `${item?.name ?? 'This item'} is batch-tracked: say which batch moved.`
    return found
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) {
      toast(toastError('record the movement', 'Check the highlighted fields.'))
      const form = event.currentTarget
      requestAnimationFrame(() => {
        const first = form.querySelector<HTMLElement>('[aria-invalid="true"]')
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }

    setSaving(true)
    try {
      await readJson(
        await fetch('/api/inventory/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            itemId: item!.id,
            batchId: batchId || undefined,
            quantity: parseQuantity(quantity),
            // A blank price is "not given", recorded as nothing paid.
            unitPrice: unitPrice.trim() ? parseMoney(unitPrice) : 0,
            transactionDate,
            supplierId: type === 'PURCHASE' ? supplier?.id || undefined : undefined,
            notes,
          }),
        })
      )
      toast(toastSuccess('Stock movement recorded', item!.name))
      reset()
      onOpenChange(false)
      onRecorded()
    } catch (error) {
      console.error('Error recording transaction:', error)
      toast(toastError('record the movement', error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New stock transaction</DialogTitle>
          <DialogDescription>
            A delivery against a purchase order is received on the order, not here.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Transaction type" required>
              {(c) => (
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id={c.id} aria-required>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECORDABLE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>

            <FormField label="Item" required error={errors.item}>
              {(c) => (
                <InventoryItemPicker<MovementItem>
                  id={c.id}
                  aria-describedby={c['aria-describedby']}
                  aria-invalid={c['aria-invalid']}
                  value={item?.id ?? null}
                  selectedLabel={item?.name}
                  onSelect={chooseItem}
                />
              )}
            </FormField>

            <FormField label="Quantity" required error={errors.quantity}>
              {(c) => (
                <Input
                  {...c}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value)
                    setErrors((x) => ({ ...x, quantity: undefined }))
                  }}
                />
              )}
            </FormField>

            <FormField label="Unit price" error={errors.unitPrice}>
              {(c) => <MoneyInput {...c} value={unitPrice} onChange={(raw) => setUnitPrice(raw)} />}
            </FormField>

            <FormField label="Transaction date" required error={errors.transactionDate}>
              {(c) => (
                <Input
                  {...c}
                  type="date"
                  value={transactionDate}
                  onChange={(e) => setTransactionDate(e.target.value)}
                />
              )}
            </FormField>

            {needsBatch && (
              <FormField
                label="Batch"
                required
                error={errors.batch}
                hint={
                  batches.length === 0
                    ? 'No batches yet. Receive this item against a purchase order to create one.'
                    : undefined
                }
              >
                {(c) => (
                  // A short, bounded list: the item's own batches.
                  <Select
                    value={batchId}
                    onValueChange={(v) => {
                      setBatchId(v)
                      setErrors((x) => ({ ...x, batch: undefined }))
                    }}
                    disabled={batches.length === 0}
                  >
                    <SelectTrigger
                      id={c.id}
                      aria-describedby={c['aria-describedby']}
                      aria-invalid={c['aria-invalid']}
                    >
                      <SelectValue placeholder="Choose a batch…" />
                    </SelectTrigger>
                    <SelectContent>
                      {batches.map((batch) => (
                        <SelectItem key={batch.id} value={batch.id}>
                          {batch.batchNumber} — {batch.remainingQty} left
                          {batch.expiryDate ? `, expires ${displayDate(batch.expiryDate)}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}

            {type === 'PURCHASE' && (
              <FormField label="Supplier">
                {(c) => (
                  <SupplierPicker
                    id={c.id}
                    aria-describedby={c['aria-describedby']}
                    value={supplier?.id ?? null}
                    selectedLabel={supplier?.name}
                    onSelect={(s) => setSupplier({ id: s.id, name: s.name })}
                    onClear={() => setSupplier(null)}
                  />
                )}
              </FormField>
            )}
          </div>

          <FormField label="Notes">
            {(c) => (
              <Textarea {...c} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            )}
          </FormField>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <SubmitButton busy={saving} busyLabel="Recording…">
              Record transaction
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
