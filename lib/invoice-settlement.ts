import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import type { InvoiceStatus, PrismaClient } from '@prisma/client'
import { SETTLED_PAYMENT_STATUSES, round2 } from '@/lib/cashier'

/**
 * What an invoice has been paid, and what that makes its status.
 *
 * Three routes used to work this out for themselves, each from the invoice's
 * own running total: taking a payment added to `paidAmount`, completing a
 * pending payment added to it again, and a refund subtracted from it. A total
 * that is carried forward rather than counted is only as right as every
 * request that ever touched it (bug report 12 Oct, findings 15, 16 and 39):
 *
 *  - two payments taken at once both read the same balance, both passed the
 *    overpayment check, and the invoice recorded one of them;
 *  - refunding the duplicate then subtracted from the one the invoice had
 *    recorded, and a patient who had paid in full was shown as owing it all,
 *    on an invoice marked REFUNDED that refused any further payment;
 *  - and an invoice could be set to PAID by hand, with nothing paid, while
 *    receivables went on counting its balance.
 *
 * So the payments are the record and the invoice's figures are read from
 * them. `paidAmount` is what was received less what went back; the balance and
 * the status follow from that and from nothing else. Every route that moves
 * money on an invoice ends by calling `settleInvoice`, inside the same
 * transaction as the movement, after taking the invoice's row lock.
 */

type Db = PrismaClient | Prisma.TransactionClient

/**
 * A request refused for a reason the person at the desk can act on. Thrown
 * from inside a transaction, so the refusal also rolls back anything the
 * transaction had already written — a reference number included.
 *
 * `code` is for a refusal a screen should recognise rather than just show —
 * `NO_OPEN_TILL` sends the person to the Till screen (finding 38).
 */
export class BillingRefusal extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'BillingRefusal'
  }
}

/** The answer a route gives for a refusal, or null if `err` is not one. */
export function billingRefusalResponse(err: unknown): NextResponse | null {
  return err instanceof BillingRefusal
    ? NextResponse.json(
        err.code ? { error: err.message, code: err.code } : { error: err.message },
        { status: err.status }
      )
    : null
}

/**
 * Hold the invoice row until the transaction ends.
 *
 * A second request for the same invoice waits here rather than reading a
 * balance the first is about to change. Everything after this inside the
 * transaction reads the invoice as the last committed writer left it.
 */
export async function lockInvoice(db: Db, invoiceId: string, hospitalId: string): Promise<void> {
  await db.$queryRaw`
    SELECT "id" FROM "Invoice"
    WHERE "id" = ${invoiceId} AND "hospitalId" = ${hospitalId}
    FOR UPDATE
  `
}

/**
 * Hold treatment rows while they are put on an invoice, so two desks billing
 * the same visit at once cannot both see it as unbilled.
 */
export async function lockTreatments(db: Db, treatmentIds: string[]): Promise<void> {
  if (treatmentIds.length === 0) return
  await db.$queryRaw`
    SELECT "id" FROM "Treatment" WHERE "id" IN (${Prisma.join(treatmentIds)}) FOR UPDATE
  `
}

export interface PaymentForSettlement {
  amount: unknown
  status: string
  refundAmount?: unknown
  refunds?: { amount: unknown }[] | null
}

/**
 * Money received on an invoice and not handed back.
 *
 * A payment counts while it is settled (completed, or refunded in whole or in
 * part); a pending, failed or cancelled one never reached the drawer. What went
 * back is the payment's refund rows. Payments refunded before refunds had rows
 * of their own carry the total in `refundAmount`, which the refund route still
 * keeps as a mirror — the larger of the two is taken, and never more than the
 * payment itself.
 */
export function netPaid(payments: PaymentForSettlement[] | null | undefined): number {
  let total = 0
  for (const payment of payments ?? []) {
    if (!(SETTLED_PAYMENT_STATUSES as readonly string[]).includes(payment.status)) continue
    const amount = Number(payment.amount ?? 0)
    const fromRows = (payment.refunds ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
    const refunded = Math.min(Math.max(fromRows, Number(payment.refundAmount ?? 0)), amount)
    total += amount - refunded
  }
  return round2(total)
}

/** Whether any money that came in on these payments has gone back out. */
function anyRefunded(payments: PaymentForSettlement[] | null | undefined): boolean {
  return (payments ?? []).some(
    (p) =>
      (SETTLED_PAYMENT_STATUSES as readonly string[]).includes(p.status) &&
      (p.status !== 'COMPLETED' ||
        Number(p.refundAmount ?? 0) > 0 ||
        (p.refunds ?? []).some((r) => Number(r.amount ?? 0) > 0))
  )
}

/**
 * The status an invoice's money gives it.
 *
 * DRAFT and CANCELLED are decisions somebody made about the document, not
 * facts about its money, so they are kept. Everything else is read from what
 * has been paid: all of it is PAID, some of it PARTIALLY_PAID, none of it
 * after a refund REFUNDED, and none of it otherwise whatever unpaid state the
 * invoice was in (PENDING, or OVERDUE if it had been marked so).
 *
 * An issued invoice for nothing — a 100% discount, or every line at no charge
 * — owes nothing, so it is PAID. It used to sit PENDING for ever with a zero
 * balance: offered "Record Payment", which the payment route then refused as
 * already paid, listed as overdue once its date passed, and counted among the
 * outstanding invoices (invoice review 2.2). Taking a payment checks the
 * balance, not this status, so nothing there changes.
 */
export function deriveInvoiceStatus(input: {
  status: InvoiceStatus
  totalAmount: number
  paidAmount: number
  refunded: boolean
}): InvoiceStatus {
  const { status, totalAmount, paidAmount, refunded } = input
  if (status === 'CANCELLED') return 'CANCELLED'
  if (status === 'DRAFT' && paidAmount <= 0) return 'DRAFT'

  if (totalAmount <= 0) return 'PAID'
  if (paidAmount > 0 && paidAmount >= totalAmount) return 'PAID'
  if (paidAmount > 0) return 'PARTIALLY_PAID'
  if (refunded) return 'REFUNDED'
  return status === 'OVERDUE' ? 'OVERDUE' : 'PENDING'
}

export interface Settlement {
  paidAmount: number
  balanceAmount: number
  status: InvoiceStatus
}

/** The money on an invoice as its payments have it, without writing anything. */
export async function readSettlement(
  db: Db,
  invoice: { id: string; status: InvoiceStatus; totalAmount: unknown }
): Promise<Settlement> {
  const payments = await db.payment.findMany({
    where: { invoiceId: invoice.id },
    select: {
      amount: true,
      status: true,
      refundAmount: true,
      refunds: { select: { amount: true } },
    },
  })

  const totalAmount = Number(invoice.totalAmount ?? 0)
  const paidAmount = netPaid(payments)
  return {
    paidAmount,
    balanceAmount: round2(totalAmount - paidAmount),
    status: deriveInvoiceStatus({
      status: invoice.status,
      totalAmount,
      paidAmount,
      refunded: anyRefunded(payments),
    }),
  }
}

/**
 * Recount an invoice's money from its payments and write the result.
 *
 * Called inside the transaction that moved the money, after `lockInvoice`, so
 * the count includes the movement and nobody else's can interleave with it.
 */
export async function settleInvoice(
  db: Db,
  invoice: { id: string; status: InvoiceStatus; totalAmount: unknown }
): Promise<Settlement> {
  const settlement = await readSettlement(db, invoice)
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      paidAmount: settlement.paidAmount,
      balanceAmount: settlement.balanceAmount,
      status: settlement.status,
    },
  })
  return settlement
}

// ────────────────────────────────────────────────────────────────────────────
// Treatments on invoices (finding 13)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The one rule for "this treatment has been billed": it is a line on an
 * invoice that has not been cancelled. A cancelled invoice gives its
 * treatments back, so they can go on the replacement (finding 17).
 *
 * Shared by the invoice routes, which refuse a treatment already billed, and
 * by "unbilled treatments", which lists the ones that are not — two copies of
 * this rule are how a visit came to be billed twice.
 */
export const BILLED_ON_LIVE_INVOICE = {
  invoice: { status: { not: 'CANCELLED' as InvoiceStatus } },
} satisfies Prisma.InvoiceItemWhereInput

/**
 * The treatment statuses that can be billed: work done, or under way for a
 * course billed as it goes. A PLANNED treatment has not happened and a
 * CANCELLED one will not. Shared with "unbilled treatments", so a treatment
 * the list offers is one the invoice routes accept (invoice review 4.1).
 */
export const BILLABLE_TREATMENT_STATUSES = ['COMPLETED', 'IN_PROGRESS'] as const

/**
 * Why these treatments cannot be billed on this patient's invoice, or null.
 *
 * Each must belong to this clinic and this patient, be in progress or
 * completed, appear once, and not already be on another invoice that is still
 * live. `invoiceId` is the invoice being edited, whose own lines do not count
 * against it.
 */
export async function treatmentBillingProblem(
  db: Db,
  args: { hospitalId: string; patientId: string; treatmentIds: string[]; invoiceId?: string }
): Promise<string | null> {
  const { hospitalId, patientId, invoiceId } = args
  const ids = args.treatmentIds
  if (ids.length === 0) return null

  if (new Set(ids).size !== ids.length) {
    return 'The same treatment appears on more than one line of this invoice'
  }

  const treatments = await db.treatment.findMany({
    where: { id: { in: ids }, hospitalId },
    select: { id: true, patientId: true, treatmentNo: true, status: true },
  })
  const found = new Map((treatments ?? []).map((t) => [t.id, t]))

  for (const id of ids) {
    const treatment = found.get(id)
    if (!treatment) return 'A treatment on this invoice was not found'
    if (treatment.patientId !== patientId) {
      return `${treatment.treatmentNo} belongs to another patient and cannot go on this invoice`
    }
    // The API accepted a PLANNED or CANCELLED treatment, which the unbilled
    // list never offers; billing work that has not been done is a charge
    // without a service behind it.
    if (!(BILLABLE_TREATMENT_STATUSES as readonly string[]).includes(String(treatment.status))) {
      return `${treatment.treatmentNo} is ${String(treatment.status ?? 'not started')
        .toLowerCase()
        .replace('_', ' ')} and cannot be billed until it is in progress or completed`
    }
  }

  const alreadyBilled = await db.invoiceItem.findFirst({
    where: {
      treatmentId: { in: ids },
      ...BILLED_ON_LIVE_INVOICE,
      ...(invoiceId ? { invoiceId: { not: invoiceId } } : {}),
    },
    select: {
      treatment: { select: { treatmentNo: true } },
      invoice: { select: { invoiceNo: true } },
    },
  })
  if (alreadyBilled) {
    return `${alreadyBilled.treatment?.treatmentNo ?? 'A treatment'} is already billed on ${alreadyBilled.invoice.invoiceNo}`
  }

  return null
}
