/**
 * The invoice forms' lines, as typed.
 *
 * Client-safe. The New and Edit pages share these so a line means the same on
 * both: what makes it valid, what it costs, and how far a treatment line has
 * been priced below the treatment. The server checks the same rules again
 * (lib/invoice-lines.ts); these exist so the person typing hears about a
 * problem beside the field rather than from a refused request.
 */
import { round2 } from '@/lib/till'
import type { InvoiceLineMoney } from '@/lib/billing-utils'

export interface FormLine {
  /** Stable React key; not sent. */
  key: string
  treatmentId: string | null
  inventoryItemId: string | null
  description: string
  /** As typed, so a cleared field stays cleared rather than becoming 0 or 1. */
  quantity: string
  unitPrice: string
  taxable: boolean
  /** A treatment's own price, to show (and count) a line charged below it. */
  listPrice?: number | null
  /** What the line points at, shown under the description: TRT-… or a SKU. */
  reference?: string | null
  /** A product's stock on the shelf when it was added, for a warning. */
  inStock?: number | null
  unit?: string | null
}

let counter = 0
export function lineKey(): string {
  counter += 1
  return `line-${Date.now()}-${counter}`
}

/** The quantity, or null when it is not a whole number of 1 or more. */
export function lineQuantity(line: Pick<FormLine, 'quantity'>): number | null {
  const text = String(line.quantity).trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n >= 1 ? n : null
}

/** The unit price, or null when it is blank, not a number, or negative. */
export function linePrice(line: Pick<FormLine, 'unitPrice'>): number | null {
  const text = String(line.unitPrice).trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** What is wrong with a line, for the message under it, or null. */
export function lineProblem(line: FormLine): string | null {
  if (!line.description.trim()) return 'Add a description'
  if (lineQuantity(line) === null) return 'Quantity must be a whole number of 1 or more'
  if (String(line.unitPrice).trim() === '') return 'Enter a price (0 if it is free)'
  if (linePrice(line) === null) return 'Price must be a number of 0 or more'
  return null
}

/** The lines as the totals need them. An unfinished line counts as nothing. */
export function linesForTotals(lines: FormLine[]): InvoiceLineMoney[] {
  return lines.map((line) => ({
    quantity: lineQuantity(line) ?? 0,
    unitPrice: linePrice(line) ?? 0,
    taxable: line.taxable,
  }))
}

/** The lines as the invoice routes take them. Call once every line is valid. */
export function linesForRequest(lines: FormLine[]) {
  return lines.map((line) => ({
    treatmentId: line.treatmentId,
    inventoryItemId: line.inventoryItemId,
    description: line.description.trim(),
    quantity: lineQuantity(line),
    unitPrice: linePrice(line),
    taxable: line.taxable,
  }))
}

/**
 * How far below their own price the treatment lines are charged, in total.
 * Counts towards the discount-approval threshold, as the server counts it.
 */
export function priceShortfall(lines: FormLine[]): number {
  return round2(
    lines.reduce((sum, line) => {
      if (!line.treatmentId || line.listPrice == null) return sum
      const charged = round2((lineQuantity(line) ?? 0) * round2(linePrice(line) ?? 0))
      return charged < line.listPrice ? sum + (line.listPrice - charged) : sum
    }, 0)
  )
}

/** A product as the billing product list returns it. */
export interface SellableProduct {
  id: string
  sku: string
  name: string
  unit: string
  currentStock: number
  sellingPrice: number | null
}

/**
 * A new line selling one of a product: priced at its selling price and
 * taxable, which is how retail goods are treated when tax is on.
 */
export function productLine(product: SellableProduct): FormLine {
  return {
    key: lineKey(),
    treatmentId: null,
    inventoryItemId: product.id,
    description: product.name,
    quantity: '1',
    unitPrice: product.sellingPrice != null ? String(product.sellingPrice) : '',
    taxable: true,
    reference: product.sku,
    inStock: product.currentStock,
    unit: product.unit,
  }
}
