'use client'

import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { IconTooltip } from '@/components/ui/icon-action'
import { InventoryItemPicker } from '@/components/inventory/inventory-item-picker'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/billing-utils'
import {
  lineKey,
  linePrice,
  lineProblem,
  lineQuantity,
  productLine,
  type FormLine,
  type SellableProduct,
} from '@/lib/invoice-form'
import { round2 } from '@/lib/till'
import { Plus, Trash2 } from 'lucide-react'

/**
 * The lines of an invoice being written, for the New and Edit pages.
 *
 * One editor so the two pages cannot drift: the Edit page dropped the taxable
 * flag and did its own arithmetic while New did neither (invoice review 1.2),
 * and the two parsed a typed quantity differently — New turned "1.5" into 1
 * without a word, Edit sent it and got a bare 400 (review 1.5). Here a
 * quantity or price that will not do says so under the field.
 */
export function InvoiceLinesEditor({
  lines,
  onChange,
  showErrors,
  trailTo = (href) => href,
}: {
  lines: FormLine[]
  onChange: (lines: FormLine[]) => void
  /** Set after a save was attempted, so empty fields are flagged too. */
  showErrors: boolean
  trailTo?: (href: string) => string
}) {
  const update = (key: string, patch: Partial<FormLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  return (
    <div className="space-y-4">
      {lines.length > 0 && (
        <div className="overflow-x-auto">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Description</TableHead>
                <TableHead className="w-24 text-center">Qty</TableHead>
                <TableHead className="w-32 text-right">Unit price</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
                <TableHead className="w-20 text-center">Taxable</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const quantity = lineQuantity(line)
                const price = linePrice(line)
                const problem = lineProblem(line)
                // Typed-and-wrong shows at once; merely empty waits for a save.
                const typedWrong =
                  (String(line.quantity).trim() !== '' && quantity === null) ||
                  (String(line.unitPrice).trim() !== '' && price === null)
                const shownProblem = problem && (showErrors || typedWrong) ? problem : null
                const amount =
                  quantity !== null && price !== null ? round2(quantity * round2(price)) : null
                const belowPrice =
                  line.treatmentId &&
                  line.listPrice != null &&
                  amount !== null &&
                  amount < line.listPrice
                const shortOfStock =
                  line.inventoryItemId &&
                  line.inStock != null &&
                  quantity !== null &&
                  quantity > line.inStock
                const problemId = `line-${line.key}-problem`

                return (
                  <TableRow key={line.key} className="align-top">
                    <TableCell>
                      <Input
                        value={line.description}
                        onChange={(e) => update(line.key, { description: e.target.value })}
                        placeholder="Item description"
                        aria-label={`Line ${index + 1} description`}
                        aria-describedby={shownProblem ? problemId : undefined}
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {line.treatmentId && (
                          <>
                            <Badge variant="outline">Treatment</Badge>
                            {line.reference && (
                              <Link
                                href={trailTo(`/treatments/${line.treatmentId}`)}
                                className="hover:underline"
                              >
                                {line.reference}
                              </Link>
                            )}
                          </>
                        )}
                        {line.inventoryItemId && (
                          <>
                            <Badge variant="outline">Product</Badge>
                            {line.reference && <span>{line.reference}</span>}
                            {line.inStock != null && (
                              <span>
                                {line.inStock} {line.unit ?? ''} in stock
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {shownProblem && (
                        <p id={problemId} className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {shownProblem}
                        </p>
                      )}
                      {!shownProblem && belowPrice && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          {formatCurrency(round2(line.listPrice! - amount!))} below the
                          treatment&rsquo;s price of {formatCurrency(line.listPrice)}. Counts as a
                          discount for approval.
                        </p>
                      )}
                      {!shownProblem && shortOfStock && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          More than the {line.inStock} in stock; the invoice cannot be issued until
                          stock is received.
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => update(line.key, { quantity: e.target.value })}
                        className="w-20 text-center"
                        aria-label={`Line ${index + 1} quantity`}
                        aria-invalid={quantity === null && (showErrors || typedWrong)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                        className="w-28 text-right"
                        aria-label={`Line ${index + 1} unit price`}
                        aria-invalid={price === null && (showErrors || typedWrong)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium pt-4">
                      {amount === null ? '—' : formatCurrency(amount)}
                    </TableCell>
                    <TableCell className="text-center pt-4">
                      <Checkbox
                        checked={line.taxable}
                        onCheckedChange={(checked) =>
                          update(line.key, { taxable: checked === true })
                        }
                        aria-label={`Line ${index + 1} taxable`}
                      />
                    </TableCell>
                    <TableCell>
                      <IconTooltip label="Remove this line">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove this line"
                          onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                        >
                          <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                        </Button>
                      </IconTooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...lines,
              {
                key: lineKey(),
                treatmentId: null,
                inventoryItemId: null,
                description: '',
                quantity: '1',
                unitPrice: '',
                taxable: true,
              },
            ])
          }
        >
          <Plus className="h-4 w-4 mr-1" />
          Add custom item
        </Button>
        <ProductPicker onPick={(product) => onChange([...lines, productLine(product)])} />
      </div>
    </div>
  )
}

/**
 * "Add product": a search over the clinic's active products, priced at their
 * selling price, with what is on the shelf beside each (invoice review 4.5).
 * Picking one adds a line; stock leaves when the invoice is issued.
 *
 * The shared `InventoryItemPicker`, pointed at `/api/billing/products` rather
 * than the stock list: the people raising invoices hold `billing:write`, not
 * `inventory:read`, and a sale has no use for purchase prices.
 */
export function ProductPicker({ onPick }: { onPick: (product: SellableProduct) => void }) {
  return (
    <div className="w-full sm:w-72">
      <InventoryItemPicker<SellableProduct>
        endpoint="/api/billing/products"
        showPrice
        value={null}
        onSelect={onPick}
        placeholder="Add product…"
        aria-label="Add a product"
        noun="products"
      />
    </div>
  )
}
