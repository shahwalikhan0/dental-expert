import type { Prisma, PrismaClient } from '@prisma/client'
import { calculateInvoiceTotals, resolveTaxRate } from '@/lib/billing-utils'
import { DEFAULT_TIMEZONE, localDay } from '@/lib/appointment-time'
import { BillingRefusal, settleInvoice, type Settlement } from '@/lib/invoice-settlement'
import { deductInvoiceStock } from '@/lib/invoice-stock'
import { dueDateOn, dueDateRefusal } from '@/lib/invoice-dates'

/**
 * Issuing an invoice: the moment a draft becomes a bill the patient owes.
 *
 * Everything that has to happen at that moment happens here, so the routes
 * that issue (the edit route's DRAFT → PENDING, which "Create & issue" also
 * goes through) cannot each remember a different subset of it:
 *
 *  - `issuedAt` is stamped, and billed figures are dated by it;
 *  - the tax rate is the clinic's *now*. It used to be the rate when the draft
 *    was started, so a draft raised before tax was switched on was issued at
 *    0% (invoice review 1.5);
 *  - the totals are recomputed with that rate;
 *  - the due date defaults to the issue day — "Due on receipt" — and may not
 *    be earlier than it;
 *  - products on the invoice leave stock;
 *  - and the invoice is settled, so one that owes nothing is PAID at once.
 */

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Issue a draft: stamp it, price it at today's tax rate, set its due date,
 * take its products out of stock and settle it.
 *
 * Call inside the transaction that holds the invoice's row lock, after any
 * change to its lines has been written — the lines are read from the
 * database, so what is issued is exactly what was saved. The discount
 * approval is the caller's to check first; nothing here decides it.
 */
export async function issueInvoice(
  db: Db,
  args: { invoiceId: string; hospitalId: string; userId: string | null }
): Promise<Settlement> {
  const { invoiceId, hospitalId, userId } = args

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId, hospitalId },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  })
  if (!invoice) throw new BillingRefusal(404, 'Invoice not found')
  if (invoice.status !== 'DRAFT') {
    throw new BillingRefusal(409, `${invoice.invoiceNo} has already been issued`)
  }

  const clinic = await db.hospital.findUnique({
    where: { id: hospitalId },
    select: { taxEnabled: true, taxRate: true, timezone: true },
  })
  const taxRate = resolveTaxRate(clinic)
  const timezone = clinic?.timezone || DEFAULT_TIMEZONE

  const totals = calculateInvoiceTotals(
    (invoice.items ?? []).map((item) => ({
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      taxable: item.taxable,
    })),
    invoice.discountType ?? 'FIXED',
    Number(invoice.discountValue ?? 0),
    taxRate
  )

  const issuedAt = new Date()
  const issueDay = localDay(issuedAt, timezone)
  let dueDate = dueDateOn(issueDay)
  if (invoice.dueDate) {
    const dueDay = localDay(invoice.dueDate, timezone)
    const refusal = dueDateRefusal(dueDay, issueDay)
    if (refusal) throw new BillingRefusal(409, `${refusal} Change the due date, then issue it.`)
    dueDate = invoice.dueDate
  }

  await deductInvoiceStock(db, {
    hospitalId,
    invoiceId,
    invoiceNo: invoice.invoiceNo,
    userId,
    lines: invoice.items ?? [],
  })

  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'PENDING',
      issuedAt,
      dueDate,
      taxRate,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxableAmount: totals.taxableAmount,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      balanceAmount: totals.totalAmount,
    },
  })

  // A draft has no payments, so this only matters for an invoice that owes
  // nothing: it becomes PAID rather than waiting for a payment it cannot take.
  return settleInvoice(db, { id: invoiceId, status: 'PENDING', totalAmount: totals.totalAmount })
}
