import { prisma } from '@/lib/prisma'
import { SETTLED_PAYMENT_STATUSES } from '@/lib/cashier'
import type { InvoiceStatus, Prisma } from '@prisma/client'
import {
  AGEING_BUCKETS,
  EMPTY_AGEING,
  ageInvoices,
  agesFrom,
  daysBetween,
  money,
  type AgeableInvoice,
  type Ageing,
} from '@/lib/ageing'

// Re-exported so a server-side caller can take the whole vocabulary of an
// account from one module. Client components import from '@/lib/ageing'
// directly — see the note at the top of that file.
export { AGEING_BUCKETS, EMPTY_AGEING, ageInvoices, agesFrom }
export type { AgeableInvoice, Ageing }

/**
 * A patient's account: every charge, every payment, and what is left.
 *
 * The application could answer "what does this invoice owe" and "what did we
 * take yesterday" and had no way to answer the question a practice is actually
 * asked at the desk — *what do I owe you?* The patient's billing tab was a
 * list of invoices with individual balances, which is the same facts with the
 * arithmetic left to the receptionist and the patient standing there.
 *
 * Nothing is stored. A running balance kept in a column is a second copy of
 * the truth and it goes wrong the first time an invoice is voided or a payment
 * is refunded three weeks later; the invoices, payments and refunds are the
 * record, and this reads them. The cost is one query per entity per patient,
 * which is nothing beside getting it wrong.
 *
 * Two rules decide what counts, and both are about not showing a patient a
 * number the clinic has not asked them for:
 *
 *  - a **DRAFT** invoice is not a charge. It is a bill somebody is still
 *    writing, and FR-013 can hold one in draft for days waiting on a discount
 *    approval. Putting it on the account would tell a patient they owe money
 *    the clinic has not decided to charge them;
 *  - a **CANCELLED** invoice is not a charge either, and it is the nearest
 *    thing this schema has to a write-off.
 */

/** Invoice states that represent money the clinic has actually asked for. */
export const CHARGEABLE_INVOICE_STATUSES: InvoiceStatus[] = [
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'REFUNDED',
]

export type LedgerEntryKind = 'INVOICE' | 'PAYMENT' | 'REFUND'

export interface LedgerEntry {
  id: string
  date: Date
  kind: LedgerEntryKind
  /** The document number — `INV-202609-0001`, `PAY-…`, `REF-…`. */
  reference: string
  description: string
  /** What the patient was charged, or what was handed back to them. */
  debit: number
  /** What the patient paid. */
  credit: number
  /** The account balance after this entry. Positive means the patient owes. */
  balance: number
  /** For an entry the reader may want to open. */
  href?: string
}

export interface LedgerSummary {
  charged: number
  paid: number
  refunded: number
  /** charged − paid + refunded. Positive means the patient owes the clinic. */
  balance: number
  /** Of the balance, how much is past its due date. */
  overdue: number
  oldestUnpaidAt: Date | null
}

export interface Ledger {
  entries: LedgerEntry[]
  summary: LedgerSummary
  ageing: Ageing
}

/**
 * Build one patient's account.
 *
 * `patientIds` rather than one id so that a guarantor's statement can be the
 * whole family on one account — which is the point of having a guarantor at
 * all. Ordering is chronological across all three kinds of entry, because a
 * running balance that is not in date order is not a running balance.
 */
export async function buildLedger(
  hospitalId: string,
  patientIds: string[],
  today: Date = new Date()
): Promise<Ledger> {
  if (patientIds.length === 0) {
    return { entries: [], summary: emptySummary(), ageing: EMPTY_AGEING }
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      hospitalId,
      patientId: { in: patientIds },
      status: { in: CHARGEABLE_INVOICE_STATUSES },
    },
    select: {
      id: true,
      invoiceNo: true,
      createdAt: true,
      dueDate: true,
      totalAmount: true,
      balanceAmount: true,
      status: true,
      patient: { select: { id: true, firstName: true, lastName: true } },
      payments: {
        where: { status: { in: [...SETTLED_PAYMENT_STATUSES] as never } },
        select: {
          id: true,
          paymentNo: true,
          amount: true,
          paymentDate: true,
          paymentMethod: true,
          refunds: {
            select: { id: true, refundNo: true, amount: true, refundedAt: true, reason: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Names are prefixed onto a family statement's descriptions, and left off a
  // single patient's — repeating one name down every line of your own
  // statement is noise.
  const family = patientIds.length > 1

  const entries: LedgerEntry[] = []
  let charged = 0
  let paid = 0
  let refunded = 0

  for (const invoice of invoices) {
    const who = family ? `${invoice.patient.firstName} ${invoice.patient.lastName} — ` : ''
    const total = money(invoice.totalAmount)
    charged += total

    entries.push({
      id: invoice.id,
      date: invoice.createdAt,
      kind: 'INVOICE',
      reference: invoice.invoiceNo,
      description: `${who}Invoice`,
      debit: total,
      credit: 0,
      balance: 0,
      href: `/billing/invoices/${invoice.id}`,
    })

    for (const payment of invoice.payments) {
      const amount = money(payment.amount)
      paid += amount

      entries.push({
        id: payment.id,
        date: payment.paymentDate,
        kind: 'PAYMENT',
        reference: payment.paymentNo,
        description: `${who}Payment against ${invoice.invoiceNo}`,
        debit: 0,
        credit: amount,
        balance: 0,
        href: `/billing/payments/${payment.id}/receipt`,
      })

      for (const refund of payment.refunds) {
        const back = money(refund.amount)
        refunded += back

        // A refund is a debit. Money went back to the patient, so what they
        // owe goes up — the mirror image of the payment above it, and the
        // reason it cannot simply be netted off that payment: the two happened
        // on different days and the account has to show both.
        entries.push({
          id: refund.id,
          date: refund.refundedAt,
          kind: 'REFUND',
          reference: refund.refundNo,
          description: `${who}Refund of ${payment.paymentNo}`,
          debit: back,
          credit: 0,
          balance: 0,
          href: `/billing/payments/${payment.id}/receipt`,
        })
      }
    }
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime())

  let running = 0
  for (const entry of entries) {
    running = money(running + entry.debit - entry.credit)
    entry.balance = running
  }

  const unpaid = invoices.filter((invoice) => money(invoice.balanceAmount) > 0)
  const ageing = ageInvoices(unpaid, today)

  const overdue = unpaid
    .filter((invoice) => daysBetween(agesFrom(invoice), today) > 0)
    .reduce((sum, invoice) => sum + money(invoice.balanceAmount), 0)

  const oldest = unpaid
    .map((invoice) => agesFrom(invoice))
    .sort((a, b) => a.getTime() - b.getTime())[0]

  return {
    entries,
    ageing,
    summary: {
      charged: money(charged),
      paid: money(paid),
      refunded: money(refunded),
      balance: money(running),
      overdue: money(overdue),
      oldestUnpaidAt: oldest ?? null,
    },
  }
}

function emptySummary(): LedgerSummary {
  return { charged: 0, paid: 0, refunded: 0, balance: 0, overdue: 0, oldestUnpaidAt: null }
}

// ────────────────────────────────────────────────────────────────────────────
// Receivables — the same arithmetic, across the whole practice
// ────────────────────────────────────────────────────────────────────────────

export interface ReceivableRow {
  patientId: string
  patientNo: string
  name: string
  phone: string
  /** Set when somebody else settles this patient's bills. */
  guarantorId: string | null
  guarantorName: string | null
  ageing: Ageing
  oldestAt: Date
  invoiceCount: number
}

export interface Receivables {
  rows: ReceivableRow[]
  totals: Ageing
  patientsOwing: number
}

/**
 * Who owes the clinic money, and for how long.
 *
 * Built from unpaid invoices rather than from the patient list: a practice with
 * four thousand patients has perhaps ninety who owe anything, and starting from
 * the debt is both faster and the only way to get the "oldest" column right.
 *
 * Rows are attributed to the patient the invoice was raised against, with the
 * guarantor named beside them rather than replacing them. Rolling a family's
 * debt up under the payer would be the wrong screen: the desk chasing a balance
 * needs to know which treatment it was for, and the statement — which *is*
 * addressed to the payer — is a different document.
 */
export async function receivables(
  hospitalId: string,
  options: { minBalance?: number; today?: Date; search?: string } = {}
): Promise<Receivables> {
  const today = options.today ?? new Date()
  const minBalance = options.minBalance ?? 0.01

  const search = options.search?.trim()
  const patientWhere: Prisma.PatientWhereInput | undefined = search
    ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { patientId: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      }
    : undefined

  const invoices = await prisma.invoice.findMany({
    where: {
      hospitalId,
      status: { in: CHARGEABLE_INVOICE_STATUSES },
      balanceAmount: { gt: minBalance },
      ...(patientWhere ? { patient: patientWhere } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      dueDate: true,
      balanceAmount: true,
      patient: {
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          phone: true,
          guarantorId: true,
          guarantor: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })

  const byPatient = new Map<string, { row: ReceivableRow; invoices: AgeableInvoice[] }>()

  for (const invoice of invoices) {
    const patient = invoice.patient
    let bucket = byPatient.get(patient.id)

    if (!bucket) {
      bucket = {
        row: {
          patientId: patient.id,
          patientNo: patient.patientId,
          name: `${patient.firstName} ${patient.lastName}`,
          phone: patient.phone,
          guarantorId: patient.guarantorId,
          guarantorName: patient.guarantor
            ? `${patient.guarantor.firstName} ${patient.guarantor.lastName}`
            : null,
          ageing: { ...EMPTY_AGEING },
          oldestAt: agesFrom(invoice),
          invoiceCount: 0,
        },
        invoices: [],
      }
      byPatient.set(patient.id, bucket)
    }

    bucket.invoices.push(invoice)
    bucket.row.invoiceCount += 1
    const from = agesFrom(invoice)
    if (from < bucket.row.oldestAt) bucket.row.oldestAt = from
  }

  const rows: ReceivableRow[] = []
  const totals = { ...EMPTY_AGEING }

  for (const { row, invoices: theirs } of byPatient.values()) {
    row.ageing = ageInvoices(theirs, today)
    rows.push(row)

    totals.current += row.ageing.current
    totals.days30 += row.ageing.days30
    totals.days60 += row.ageing.days60
    totals.days90 += row.ageing.days90
    totals.total += row.ageing.total
  }

  // Oldest debt first. A receivables list sorted by amount puts a large recent
  // bill above a small one that has been outstanding since March, and it is the
  // March one that needs the call.
  rows.sort((a, b) => a.oldestAt.getTime() - b.oldestAt.getTime())

  return {
    rows,
    patientsOwing: rows.length,
    totals: {
      current: money(totals.current),
      days30: money(totals.days30),
      days60: money(totals.days60),
      days90: money(totals.days90),
      total: money(totals.total),
    },
  }
}
