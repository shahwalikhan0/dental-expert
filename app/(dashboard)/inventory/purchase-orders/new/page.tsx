'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/i18n/format'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/ui/form-field'
import { MoneyInput, parseMoney } from '@/components/ui/money-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { IconTooltip } from '@/components/ui/icon-action'
import { BackLink, useTrail } from '@/components/ui/trail'
import { SupplierPicker } from '@/components/inventory/supplier-picker'
import {
  InventoryItemPicker,
  type InventoryItemRow,
} from '@/components/inventory/inventory-item-picker'

/** What the order form reads of a stock item. */
interface Item extends InventoryItemRow {
  minimumStock?: number | null
  purchasePrice?: string | number | null
}

interface Line {
  /** A stable key for React; lines have no id until saved. */
  key: number
  itemId: string
  itemName: string
  /** "12 box in stock, minimum 5" — what was on the shelf when it was chosen. */
  stock: string
  /** Kept as typed. */
  quantity: string
  /** Kept as typed; `parseMoney` reads it. */
  unitPrice: string
}

interface LineErrors {
  item?: string
  quantity?: string
  unitPrice?: string
}

interface Errors {
  supplier?: string
  expectedDate?: string
  lines?: string
  line?: Record<number, LineErrors>
}

function parseQuantity(raw: string): number | null {
  if (!/^\s*\d+\s*$/.test(raw)) return null
  const value = parseInt(raw, 10)
  return value >= 1 ? value : null
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const trail = useTrail('New purchase order')
  const { toast } = useToast()
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null)
  const [expectedDate, setExpectedDate] = useState('')
  // The earliest delivery date the picker offers. Set after mount: the
  // server's today and the browser's can differ around midnight, and a
  // differing `min` would be a hydration mismatch.
  const [today, setToday] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const nextKey = useRef(0)
  // Which of the two buttons is sending, so only that one shows the spinner.
  const [saving, setSaving] = useState<'draft' | 'place' | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  // Warn before a half-filled form is thrown away by a stray click.
  const guardRef = useFormGuard(saving !== null)
  // The form's element, for scrolling to the first error; the guard's ref is a
  // callback, so both are handed the node here.
  const formNode = useRef<HTMLDivElement | null>(null)
  const formRef = useCallback(
    (node: HTMLDivElement | null) => {
      formNode.current = node
      guardRef(node)
    },
    [guardRef]
  )

  useEffect(() => {
    const now = new Date()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    )
  }, [])

  const addLine = () =>
    setLines((current) => [
      ...current,
      { key: nextKey.current++, itemId: '', itemName: '', stock: '', quantity: '1', unitPrice: '' },
    ])

  const updateLine = (key: number, changes: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line))
    )

  const removeLine = (key: number) =>
    setLines((current) => current.filter((line) => line.key !== key))

  // Choosing an item fills in the price the clinic already pays, so a routine
  // reorder does not have to be retyped from the last invoice. Only active
  // items are offered (the picker's default): an order naming an inactive one
  // is refused (finding 44), and deleted items are never listed (finding 58).
  const chooseItem = (key: number, item: Item) =>
    updateLine(key, {
      itemId: item.id,
      itemName: item.name,
      stock:
        `${item.currentStock ?? 0} ${item.unit ?? ''}`.trim() +
        ` in stock, minimum ${item.minimumStock ?? 0}`,
      unitPrice: item.purchasePrice != null ? String(Number(item.purchasePrice)) : '',
    })

  const lineTotal = (line: Line) =>
    (parseQuantity(line.quantity) ?? 0) * (parseMoney(line.unitPrice) ?? 0)
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0)

  const validate = (): Errors => {
    const found: Errors = {}
    if (!supplier) found.supplier = 'Choose a supplier.'
    // The server refuses a date before the clinic's today (lib/purchase-orders.ts
    // `expectedDateRefusal`); said here first, against the browser's today.
    if (expectedDate && today && expectedDate < today)
      found.expectedDate = 'The expected delivery date cannot be before today.'
    if (lines.length === 0) found.lines = 'Add at least one item.'
    const perLine: Record<number, LineErrors> = {}
    for (const line of lines) {
      const e: LineErrors = {}
      if (!line.itemId) e.item = 'Choose an item.'
      if (parseQuantity(line.quantity) === null) e.quantity = 'At least 1.'
      if (parseMoney(line.unitPrice) === null) e.unitPrice = 'Enter a price.'
      if (Object.keys(e).length) perLine[line.key] = e
    }
    if (Object.keys(perLine).length) found.line = perLine
    return found
  }

  const save = async (place: boolean) => {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) {
      toast(toastError('save the order', 'Check the highlighted fields.'))
      // The first field that needs attention, in reading order.
      requestAnimationFrame(() => {
        formNode.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-field-error]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }

    setSaving(place ? 'place' : 'draft')
    try {
      const data = await readJson<{ data: { id: string; orderNumber?: string } }>(
        await fetch('/api/inventory/purchase-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supplierId: supplier!.id,
            expectedDate: expectedDate || null,
            notes: notes || null,
            status: place ? 'ORDERED' : 'DRAFT',
            items: lines.map((line) => ({
              itemId: line.itemId,
              quantity: parseQuantity(line.quantity)!,
              unitPrice: parseMoney(line.unitPrice)!,
            })),
          }),
        })
      )

      toast(
        toastSuccess(place ? 'Purchase order placed' : 'Draft order saved', data.data.orderNumber)
      )
      router.push(`/inventory/purchase-orders/${data.data.id}`)
    } catch (err) {
      console.error('Error saving purchase order:', err)
      toast(toastError('save the order', err))
      setSaving(null)
    }
  }

  return (
    <div ref={formRef} className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="New purchase order"
        back={
          <BackLink
            trail={trail}
            fallback="/inventory/purchase-orders"
            fallbackLabel="Purchase orders"
          />
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Supplier" required error={errors.supplier}>
              {(control) => (
                <div data-field-error={errors.supplier ? '' : undefined}>
                  {/* Active suppliers only (the picker's default). */}
                  <SupplierPicker
                    id={control.id}
                    aria-describedby={control['aria-describedby']}
                    aria-invalid={control['aria-invalid']}
                    value={supplier?.id ?? null}
                    selectedLabel={supplier?.name}
                    onSelect={(s) => {
                      setSupplier({ id: s.id, name: s.name })
                      setErrors((e) => ({ ...e, supplier: undefined }))
                    }}
                    onClear={() => setSupplier(null)}
                    allowAdd
                  />
                </div>
              )}
            </FormField>

            <FormField label="Expected delivery" error={errors.expectedDate}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={expectedDate}
                  min={today || undefined}
                  onChange={(e) => {
                    setExpectedDate(e.target.value)
                    setErrors((x) => ({ ...x, expectedDate: undefined }))
                  }}
                />
              )}
            </FormField>
          </div>

          <FormField label="Notes" htmlFor="notes">
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Items</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="mr-2 h-4 w-4" />
            Add line
          </Button>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p
              className={
                errors.lines ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
              }
              data-field-error={errors.lines ? '' : undefined}
              role={errors.lines ? 'alert' : undefined}
            >
              {errors.lines ?? 'Nothing on this order yet.'}
            </p>
          ) : (
            <div className="space-y-4">
              {lines.map((line, index) => {
                const e = errors.line?.[line.key] ?? {}
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-1 items-start gap-3 border-b pb-4 last:border-b-0 last:pb-0 md:grid-cols-12"
                  >
                    <FormField
                      className="md:col-span-6"
                      label={`Item ${index + 1}`}
                      required
                      error={e.item}
                      hint={line.stock || undefined}
                    >
                      {(control) => (
                        <InventoryItemPicker<Item>
                          id={control.id}
                          aria-describedby={control['aria-describedby']}
                          aria-invalid={control['aria-invalid']}
                          value={line.itemId || null}
                          selectedLabel={line.itemName}
                          onSelect={(item) => chooseItem(line.key, item)}
                        />
                      )}
                    </FormField>

                    <FormField
                      className="md:col-span-2"
                      label="Quantity"
                      required
                      error={e.quantity}
                    >
                      {(control) => (
                        <Input
                          {...control}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          value={line.quantity}
                          onChange={(ev) => updateLine(line.key, { quantity: ev.target.value })}
                        />
                      )}
                    </FormField>

                    <FormField
                      className="md:col-span-2"
                      label="Unit price"
                      required
                      error={e.unitPrice}
                    >
                      {(control) => (
                        <MoneyInput
                          {...control}
                          value={line.unitPrice}
                          onChange={(raw) => updateLine(line.key, { unitPrice: raw })}
                        />
                      )}
                    </FormField>

                    <div className="flex items-center justify-between gap-2 md:col-span-2 md:pt-8">
                      <span className="text-sm tabular-nums">
                        {formatCurrency(lineTotal(line))}
                      </span>
                      <IconTooltip label="Remove line">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove line ${index + 1}`}
                          onClick={() => removeLine(line.key)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </IconTooltip>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {lines.length > 0 && (
            <div className="mt-4 border-t pt-4 text-right">
              <span className="mr-3 text-sm text-muted-foreground">Subtotal before tax</span>
              <span className="text-lg font-semibold">{formatCurrency(subtotal)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild>
          <Link href={trail.back('/inventory/purchase-orders')}>Cancel</Link>
        </Button>
        <SubmitButton
          type="button"
          variant="outline"
          busy={saving === 'draft'}
          busyLabel="Saving…"
          disabled={saving !== null}
          onClick={() => save(false)}
        >
          Save as draft
        </SubmitButton>
        <SubmitButton
          type="button"
          busy={saving === 'place'}
          busyLabel="Placing order…"
          disabled={saving !== null}
          onClick={() => save(true)}
        >
          Save and place order
        </SubmitButton>
      </div>

      {/* Receiving is only possible against a placed order: goods arriving
          against something nobody sent is a stock adjustment, not a delivery. */}
      <p className="text-right text-xs text-muted-foreground">
        A draft can be edited later. Goods can only be received against a placed order.
      </p>
    </div>
  )
}
