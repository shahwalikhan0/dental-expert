'use client'

/**
 * The purchase order form, for a new order and for a draft being changed.
 *
 * "A draft can be edited later", the new-order screen said, and the route has
 * always taken an edit of a draft (PATCH) — but no screen ever sent one, so a
 * draft with a wrong quantity had to be deleted and typed out again. Both
 * screens now share this form; a draft opened here is saved with PATCH, its
 * lines replaced as a whole, which is what the route does with them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/i18n/format'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { Button } from '@/components/ui/button'
import { FormActions, FormSection } from '@/components/ui/form-section'
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

/** A saved draft, as the edit screen hands it over. */
export interface PurchaseOrderDraft {
  id: string
  orderNumber: string
  supplier: { id: string; name: string }
  expectedDate: string | null
  notes: string | null
  items: {
    itemId: string
    quantity: number
    unitPrice: string | number
    item: { name: string; unit?: string | null; currentStock?: number | null }
  }[]
}

function parseQuantity(raw: string): number | null {
  if (!/^\s*\d+\s*$/.test(raw)) return null
  const value = parseInt(raw, 10)
  return value >= 1 ? value : null
}

export function PurchaseOrderForm({ draft }: { draft?: PurchaseOrderDraft }) {
  const router = useRouter()
  const trail = useTrail(draft ? `Edit ${draft.orderNumber}` : 'New purchase order')
  const { toast } = useToast()
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(
    draft ? draft.supplier : null
  )
  const [expectedDate, setExpectedDate] = useState(draft?.expectedDate?.slice(0, 10) ?? '')
  // The earliest delivery date the picker offers. Set after mount: the
  // server's today and the browser's can differ around midnight, and a
  // differing `min` would be a hydration mismatch.
  const [today, setToday] = useState('')
  const [notes, setNotes] = useState(draft?.notes ?? '')
  const [lines, setLines] = useState<Line[]>(() =>
    (draft?.items ?? []).map((line, index) => ({
      key: index,
      itemId: line.itemId,
      itemName: line.item.name,
      stock: `${line.item.currentStock ?? 0} ${line.item.unit ?? ''}`.trim() + ' in stock',
      quantity: String(line.quantity),
      unitPrice: String(Number(line.unitPrice)),
    }))
  )
  const nextKey = useRef(draft?.items.length ?? 0)
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
    const items = lines.map((line) => ({
      itemId: line.itemId,
      quantity: parseQuantity(line.quantity)!,
      unitPrice: parseMoney(line.unitPrice)!,
    }))
    try {
      if (draft) {
        // The draft's lines are replaced as a whole; placing is a second
        // request, as it is from the order's own screen, so a refusal to place
        // (a supplier deactivated since) still leaves the edit saved.
        await readJson(
          await fetch(`/api/inventory/purchase-orders/${draft.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              supplierId: supplier!.id,
              expectedDate: expectedDate || null,
              notes: notes || null,
              items,
            }),
          })
        )
        if (place) {
          await readJson(
            await fetch(`/api/inventory/purchase-orders/${draft.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'ORDERED' }),
            })
          )
        }
        toast(toastSuccess(place ? 'Purchase order placed' : 'Draft saved', draft.orderNumber))
        router.push(`/inventory/purchase-orders/${draft.id}`)
        return
      }

      const data = await readJson<{ data: { id: string; orderNumber?: string } }>(
        await fetch('/api/inventory/purchase-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supplierId: supplier!.id,
            expectedDate: expectedDate || null,
            notes: notes || null,
            status: place ? 'ORDERED' : 'DRAFT',
            items,
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
    <div ref={formRef} className="space-y-6">
      <PageHeader
        title={draft ? `Edit ${draft.orderNumber}` : 'New purchase order'}
        description={draft ? 'A draft: nothing has been sent to the supplier yet.' : undefined}
        back={
          <BackLink
            trail={trail}
            fallback={
              draft ? `/inventory/purchase-orders/${draft.id}` : '/inventory/purchase-orders'
            }
            fallbackLabel={draft ? draft.orderNumber : 'Purchase orders'}
          />
        }
      />

      <FormSection title="Order" description="Who it is from and when it should arrive">
        <div className="space-y-4">
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
        </div>
      </FormSection>

      <FormSection
        title="Items"
        description="What is being ordered, how many, and at what price"
        aside={
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4" />
            Add line
          </Button>
        }
      >
        <div>
          {lines.length === 0 ? (
            <p
              className={`rounded-xl border border-dashed py-6 text-center text-sm ${
                errors.lines
                  ? 'border-destructive/50 text-destructive'
                  : 'border-border text-muted-foreground'
              }`}
              data-field-error={errors.lines ? '' : undefined}
              role={errors.lines ? 'alert' : undefined}
            >
              {errors.lines ?? 'Nothing on this order yet.'}
            </p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, index) => {
                const e = errors.line?.[line.key] ?? {}
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-1 items-start gap-4 rounded-xl border border-border p-4 sm:grid-cols-2 xl:grid-cols-12"
                  >
                    <FormField
                      className="sm:col-span-2 xl:col-span-6"
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
                      className="xl:col-span-2"
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
                      className="xl:col-span-2"
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

                    <div className="flex items-center justify-between gap-2 sm:col-span-2 xl:col-span-2 xl:pt-8">
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
            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-muted/60 px-4 py-3">
              <span className="text-sm text-muted-foreground">Subtotal before tax</span>
              <span className="text-lg font-semibold tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
          )}
        </div>
      </FormSection>

      {/* Receiving is only possible against a placed order: goods arriving
          against something nobody sent is a stock adjustment, not a delivery. */}
      <FormActions hint="A draft can be edited until it is placed. Goods can only be received against a placed order.">
        <Button variant="outline" asChild>
          <Link
            href={trail.back(
              draft ? `/inventory/purchase-orders/${draft.id}` : '/inventory/purchase-orders'
            )}
          >
            Cancel
          </Link>
        </Button>
        <SubmitButton
          type="button"
          variant="outline"
          busy={saving === 'draft'}
          busyLabel="Saving…"
          disabled={saving !== null}
          onClick={() => save(false)}
        >
          {draft ? 'Save draft' : 'Save as draft'}
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
      </FormActions>
    </div>
  )
}
