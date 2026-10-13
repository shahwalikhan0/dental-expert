import { describe, it, expect } from 'vitest'
import { IMPORTED_BALANCE_LINE, importedInvoiceFigures } from '@/lib/import/invoice-figures'

// The invoice import's check on a row's money (invoice review, 14 Oct, §5).
// The rows are what the importer builds after coercion: numbers or null.

function figures(row: Record<string, unknown>) {
  const result = importedInvoiceFigures(row)
  if (!result.ok) throw new Error(`refused: ${result.problem.message}`)
  return result
}

function refusal(row: Record<string, unknown>) {
  const result = importedInvoiceFigures(row)
  if (result.ok) throw new Error('expected the row to be refused')
  return result.problem
}

describe('importedInvoiceFigures — totals', () => {
  it('accepts a row whose total is subtotal − discount + tax, and derives the rate', () => {
    const { figures: f } = figures({
      subtotal: 1000,
      discountAmount: 100,
      taxAmount: 144,
      totalAmount: 1044,
    })
    expect(f.taxRate).toBe(16)
    expect(f.taxable).toBe(true)
    expect(f.taxableAmount).toBe(900)
    expect(f.totalAmount).toBe(1044)
    expect(f.description).toBe(IMPORTED_BALANCE_LINE)
  })

  it('refuses the review example: subtotal 1,000, total 1,160, no tax', () => {
    const problem = refusal({ subtotal: 1000, totalAmount: 1160 })
    expect(problem.field).toBe('totalAmount')
    expect(problem.message).toMatch(/does not add up/)
  })

  it('allows a paisa of rounding and lets the tax take it up', () => {
    const { figures: f } = figures({ subtotal: 999, taxAmount: 159.85, totalAmount: 1158.84 })
    expect(f.taxAmount).toBe(159.84)
    expect(f.totalAmount).toBe(1158.84)
  })

  it('refuses a difference of more than a paisa', () => {
    expect(refusal({ subtotal: 1000, taxAmount: 0, totalAmount: 1000.02 }).field).toBe(
      'totalAmount'
    )
  })

  it('sums legacy CGST and SGST into the tax when there is no tax column', () => {
    const { figures: f } = figures({
      subtotal: 1000,
      cgstAmount: 90,
      sgstAmount: 90,
      totalAmount: 1180,
    })
    expect(f.taxAmount).toBe(180)
    expect(f.taxRate).toBe(18)
  })

  it('leaves an untaxed invoice untaxed', () => {
    const { figures: f } = figures({ subtotal: 500, totalAmount: 500 })
    expect(f.taxRate).toBe(0)
    expect(f.taxable).toBe(false)
    expect(f.taxableAmount).toBe(0)
  })

  it('refuses a discount larger than the subtotal, and tax on nothing', () => {
    expect(refusal({ subtotal: 100, discountAmount: 150, totalAmount: -50 }).field).toBe(
      'discountAmount'
    )
    expect(
      refusal({ subtotal: 100, discountAmount: 100, taxAmount: 10, totalAmount: 10 }).field
    ).toBe('taxAmount')
  })

  it('uses the row description for the line', () => {
    const { figures: f } = figures({
      subtotal: 100,
      totalAmount: 100,
      description: '  Root canal  ',
    })
    expect(f.description).toBe('Root canal')
  })
})

describe('importedInvoiceFigures — paid amount and status', () => {
  it('takes the paid amount and starts the invoice unpaid for settlement', () => {
    const { figures: f, warnings } = figures({
      subtotal: 5000,
      totalAmount: 5000,
      paidAmount: 2000,
      status: 'PARTIALLY_PAID',
    })
    expect(f.paidAmount).toBe(2000)
    expect(f.status).toBe('PENDING')
    expect(warnings).toEqual([])
  })

  it('reads PAID with no paid amount as paid in full', () => {
    const { figures: f } = figures({ subtotal: 5000, totalAmount: 5000, status: 'PAID' })
    expect(f.paidAmount).toBe(5000)
  })

  it('warns when the status disagrees with the paid amount', () => {
    const { figures: f, warnings } = figures({
      subtotal: 5000,
      totalAmount: 5000,
      paidAmount: 0,
      status: 'PAID',
    })
    expect(f.paidAmount).toBe(0)
    expect(warnings.map((w) => w.field)).toContain('status')
  })

  it('refuses a paid amount more than the total', () => {
    expect(refusal({ subtotal: 100, totalAmount: 100, paidAmount: 150 }).field).toBe('paidAmount')
  })

  it('refuses a partially paid row with no paid amount', () => {
    expect(refusal({ subtotal: 100, totalAmount: 100, status: 'PARTIALLY_PAID' }).field).toBe(
      'paidAmount'
    )
  })

  it('keeps DRAFT and CANCELLED when nothing is paid', () => {
    expect(figures({ subtotal: 100, totalAmount: 100, status: 'DRAFT' }).figures.status).toBe(
      'DRAFT'
    )
    expect(
      figures({ subtotal: 100, totalAmount: 100, status: 'CANCELLED', paidAmount: 0 }).figures
        .status
    ).toBe('CANCELLED')
  })

  it('refuses a draft or cancelled invoice with money paid on it', () => {
    expect(
      refusal({ subtotal: 100, totalAmount: 100, status: 'DRAFT', paidAmount: 50 }).field
    ).toBe('paidAmount')
    expect(
      refusal({ subtotal: 100, totalAmount: 100, status: 'CANCELLED', paidAmount: 50 }).field
    ).toBe('paidAmount')
  })

  it('refuses REFUNDED, which the invoice file alone cannot represent', () => {
    expect(refusal({ subtotal: 100, totalAmount: 100, status: 'REFUNDED' }).field).toBe('status')
  })

  it('keeps OVERDUE as the unpaid status', () => {
    expect(figures({ subtotal: 100, totalAmount: 100, status: 'OVERDUE' }).figures.status).toBe(
      'OVERDUE'
    )
  })

  it('warns when the balance column disagrees', () => {
    const { warnings } = figures({
      subtotal: 100,
      totalAmount: 100,
      paidAmount: 40,
      balanceAmount: 100,
    })
    expect(warnings.map((w) => w.field)).toEqual(['balanceAmount'])
  })
})
