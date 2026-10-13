import { round2 } from '@/lib/till'

/**
 * The figures an imported invoice row is created with, or why it cannot be.
 *
 * The importer used to write a row's subtotal, total, paid amount and status
 * straight onto the invoice (invoice review, 14 Oct, §5). Nothing checked that
 * the total was the subtotal less the discount plus the tax, `taxRate` was
 * left at 0 so the invoice page hid a tax line the total included, and the
 * paid amount and status had no payments behind them — so the payment screen
 * counted the invoice as unpaid and took the same money a second time.
 *
 * Now a row's money has to add up before it is imported, the rate is worked
 * out from the tax it was charged, and what was paid becomes a payment that
 * the invoice's figures are then counted from. Pure, so the validate step
 * reports the same refusals the commit step would make.
 */

/** The single line an imported invoice carries when the row gives no description. */
export const IMPORTED_BALANCE_LINE = 'Imported balance'

/**
 * Notes on the payment made from an invoice row's paid amount. Also how the
 * payments import finds it to set aside when a payments file covers the
 * invoice — see `importPayments` in the commit route.
 */
export const IMPORTED_PAYMENT_NOTE = 'Imported payment'

/** Within a paisa: what an old system's rounding is allowed to differ by. */
const TOLERANCE = 0.01 + 1e-9

export type ImportedInvoiceStatus = 'DRAFT' | 'CANCELLED' | 'PENDING' | 'OVERDUE'

export interface ImportedInvoiceFigures {
  description: string
  subtotal: number
  discountAmount: number
  taxableAmount: number
  taxRate: number
  taxAmount: number
  totalAmount: number
  /** Whether the one line is taxed — true exactly when the row carries tax. */
  taxable: boolean
  /** What the synthetic payment is for; 0 for none. */
  paidAmount: number
  /**
   * The status the invoice is created with, before `settleInvoice` counts its
   * payments. DRAFT and CANCELLED are kept as decisions about the document;
   * anything else starts unpaid and the payments decide the rest.
   */
  status: ImportedInvoiceStatus
}

export interface FigureProblem {
  field: string
  message: string
}

export type InvoiceFiguresResult =
  | { ok: true; figures: ImportedInvoiceFigures; warnings: FigureProblem[] }
  | { ok: false; problem: FigureProblem }

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const fmt = (n: number) => n.toFixed(2)

/**
 * Check an invoice row's money and work out what it is imported as.
 *
 * `row` is the coerced row the importer builds: numbers for the decimal
 * columns, an `InvoiceStatus` value or null for `status`.
 */
export function importedInvoiceFigures(row: Record<string, unknown>): InvoiceFiguresResult {
  const refuse = (field: string, message: string): InvoiceFiguresResult => ({
    ok: false,
    problem: { field, message },
  })
  const warnings: FigureProblem[] = []

  const subtotal = num(row.subtotal)
  if (subtotal === null) return refuse('subtotal', 'Subtotal is required')
  if (subtotal < 0) return refuse('subtotal', `Subtotal ${fmt(subtotal)} cannot be negative`)

  const total = num(row.totalAmount)
  if (total === null) return refuse('totalAmount', 'Total amount is required')

  const discount = num(row.discountAmount) ?? 0
  if (discount < 0) return refuse('discountAmount', 'Discount cannot be negative')
  if (discount > subtotal + TOLERANCE) {
    return refuse(
      'discountAmount',
      `Discount ${fmt(discount)} is more than the subtotal ${fmt(subtotal)}`
    )
  }

  // A row from an Indian system may carry cgst/sgst columns instead of one tax
  // column; they are summed into the single tax line rather than dropped.
  const statedTax = num(row.taxAmount) ?? (num(row.cgstAmount) ?? 0) + (num(row.sgstAmount) ?? 0)
  if (statedTax < 0) return refuse('taxAmount', 'Tax cannot be negative')

  const net = round2(subtotal - discount)
  const expected = round2(net + statedTax)
  if (Math.abs(total - expected) > TOLERANCE) {
    return refuse(
      'totalAmount',
      `Total ${fmt(total)} does not add up: subtotal ${fmt(subtotal)} − discount ${fmt(discount)} + tax ${fmt(statedTax)} = ${fmt(expected)}`
    )
  }

  // Within a paisa, the row's total is what the patient was billed, so it is
  // kept and the tax takes up the rounding — the components on the invoice
  // then add up to it exactly. With no tax there is nothing to take it up, and
  // the line (at the subtotal) less the discount is the total.
  const taxAmount = statedTax > 0 ? Math.max(round2(total - net), 0) : 0
  const totalAmount = round2(net + taxAmount)

  let taxRate = 0
  if (taxAmount > 0) {
    if (net <= 0) {
      return refuse(
        'taxAmount',
        `Tax ${fmt(taxAmount)} is charged on nothing (subtotal less discount is 0)`
      )
    }
    taxRate = round2((taxAmount / net) * 100)
    if (taxRate > 100) {
      return refuse(
        'taxAmount',
        `Tax ${fmt(taxAmount)} on ${fmt(net)} is a rate of ${fmt(taxRate)}%, which cannot be right`
      )
    }
  }
  const taxable = taxAmount > 0

  // ── What was paid, and the status that follows ─────────────────────────────
  const rowStatus = typeof row.status === 'string' && row.status ? row.status : null
  const statedPaid = num(row.paidAmount)
  if (statedPaid !== null && statedPaid < 0) {
    return refuse('paidAmount', 'Paid amount cannot be negative')
  }

  if (rowStatus === 'DRAFT' || rowStatus === 'CANCELLED') {
    // A draft is not a bill yet and takes no payment at the desk; a cancelled
    // invoice with money on it is either a refund or money moved to another
    // bill, and the row cannot say which. Somebody who knows should decide.
    if ((statedPaid ?? 0) > 0) {
      return refuse(
        'paidAmount',
        rowStatus === 'DRAFT'
          ? 'A draft invoice cannot have a paid amount. Import it as Pending, or clear the paid amount.'
          : 'A cancelled invoice cannot have a paid amount. Clear the paid amount, or import it as Pending, Paid or Partially paid.'
      )
    }
    return {
      ok: true,
      figures: {
        description: description(row),
        subtotal,
        discountAmount: discount,
        taxableAmount: taxable ? net : 0,
        taxRate,
        taxAmount,
        totalAmount,
        taxable,
        paidAmount: 0,
        status: rowStatus,
      },
      warnings: balanceWarning(row, totalAmount, 0),
    }
  }

  if (rowStatus === 'REFUNDED') {
    // Without the payment and its refund there is nothing to count the
    // invoice's figures from, and importing it unpaid would show the whole
    // amount as owed again.
    return refuse(
      'status',
      'A refunded invoice cannot be imported from the invoice file alone. Import it as Cancelled if nothing is owed on it.'
    )
  }

  let paidAmount = statedPaid
  if (paidAmount === null) {
    // An export with a status column and no paid column: PAID can only mean
    // all of it. PARTIALLY_PAID could mean any amount, so it is asked for.
    if (rowStatus === 'PARTIALLY_PAID') {
      return refuse('paidAmount', 'A partially paid invoice needs its paid amount')
    }
    paidAmount = rowStatus === 'PAID' ? totalAmount : 0
  }
  if (paidAmount > totalAmount + TOLERANCE) {
    return refuse(
      'paidAmount',
      `Paid amount ${fmt(paidAmount)} is more than the total ${fmt(totalAmount)}`
    )
  }
  paidAmount = Math.min(round2(paidAmount), totalAmount)

  const status: ImportedInvoiceStatus = rowStatus === 'OVERDUE' ? 'OVERDUE' : 'PENDING'
  // The same rule settleInvoice applies, for a warning only: the paid amount
  // decides the status, and a row whose status says otherwise is told so.
  const willBe =
    paidAmount > 0 && paidAmount >= totalAmount
      ? 'PAID'
      : paidAmount > 0
        ? 'PARTIALLY_PAID'
        : status
  if (rowStatus && rowStatus !== willBe) {
    warnings.push({
      field: 'status',
      message: `Status "${rowStatus}" will be ${willBe}, from the paid amount ${fmt(paidAmount)} of ${fmt(totalAmount)}`,
    })
  }
  warnings.push(...balanceWarning(row, totalAmount, paidAmount))

  return {
    ok: true,
    figures: {
      description: description(row),
      subtotal,
      discountAmount: discount,
      taxableAmount: taxable ? net : 0,
      taxRate,
      taxAmount,
      totalAmount,
      taxable,
      paidAmount,
      status,
    },
    warnings,
  }
}

function description(row: Record<string, unknown>): string {
  const text = typeof row.description === 'string' ? row.description.trim() : ''
  return text || IMPORTED_BALANCE_LINE
}

/** The row's balance column is not used; say so when it disagrees. */
function balanceWarning(
  row: Record<string, unknown>,
  totalAmount: number,
  paidAmount: number
): FigureProblem[] {
  const stated = num(row.balanceAmount)
  const balance = round2(totalAmount - paidAmount)
  if (stated === null || Math.abs(stated - balance) <= TOLERANCE) return []
  return [
    {
      field: 'balanceAmount',
      message: `Balance ${fmt(stated)} does not match total less paid; ${fmt(balance)} will be used`,
    },
  ]
}
