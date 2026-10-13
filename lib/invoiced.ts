import { prisma } from '@/lib/prisma'
import {
  billedAt,
  billedInvoiceWhere,
  money,
  netLineAmounts,
  owedInvoiceWhere,
  type Window,
} from '@/lib/invoice-figures'

/**
 * Billed and outstanding, read from the database.
 *
 * The rules are in lib/invoice-figures.ts, which touches no database so that
 * client components can share them. This is the server half: the same rules
 * as aggregates, so a route that wants "billed this month" or "outstanding
 * now" asks for it by name instead of writing its own `where` and getting the
 * statuses slightly different — which is how there came to be six
 * outstandings (invoice review, 14 Oct, §3.1).
 *
 * What was *collected* is lib/collections.ts.
 */

export interface BilledTotals {
  /** Σ totalAmount, tax included: what the patients were asked to pay. */
  billed: number
  discounts: number
  tax: number
  invoiceCount: number
}

/** Invoices issued in the window, neither draft nor cancelled. */
export async function billedTotals(hospitalId: string, window: Window): Promise<BilledTotals> {
  const result = await prisma.invoice.aggregate({
    where: { hospitalId, ...billedInvoiceWhere(window) },
    _sum: { totalAmount: true, discountAmount: true, taxAmount: true },
    _count: true,
  })
  return {
    billed: money(result._sum.totalAmount),
    discounts: money(result._sum.discountAmount),
    tax: money(result._sum.taxAmount),
    invoiceCount: result._count,
  }
}

export interface OutstandingTotals {
  outstanding: number
  invoiceCount: number
}

/** What patients owe the clinic right now, by the one definition. */
export async function outstandingTotals(hospitalId: string): Promise<OutstandingTotals> {
  const result = await prisma.invoice.aggregate({
    where: { hospitalId, ...owedInvoiceWhere() },
    _sum: { balanceAmount: true },
    _count: true,
  })
  return { outstanding: money(result._sum.balanceAmount), invoiceCount: result._count }
}

export interface InvoicedLine {
  invoiceId: string
  itemId: string
  billedAt: Date
  /** The line less its pro-rata share of the invoice discount, before tax. */
  amount: number
  treatmentId: string | null
  procedure: { id: string; code: string; name: string; category: string } | null
  doctor: {
    id: string
    firstName: string
    lastName: string
    specialization: string | null
    role: string
  } | null
}

/**
 * Every invoice line billed in the window, at what was actually invoiced.
 *
 * Revenue by procedure, by doctor and per member of staff used to add up
 * `Treatment.cost` by when the treatment was started — a list price, counted
 * whether or not it was ever billed, with no discount taken off, and changed
 * after the fact if somebody re-costed the treatment. These are the bills:
 * the line amount less its share of the discount, on invoices that are
 * neither draft nor cancelled, dated by when they were issued. The doctor is
 * the one on the treatment the line bills; a line with no treatment (a
 * product, a manual charge) has no procedure and no doctor.
 */
export async function invoicedLines(hospitalId: string, window: Window): Promise<InvoicedLine[]> {
  const invoices = await prisma.invoice.findMany({
    where: { hospitalId, ...billedInvoiceWhere(window) },
    select: {
      id: true,
      issuedAt: true,
      createdAt: true,
      discountAmount: true,
      items: {
        select: {
          id: true,
          amount: true,
          treatment: {
            select: {
              id: true,
              procedure: { select: { id: true, code: true, name: true, category: true } },
              doctor: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  specialization: true,
                  user: { select: { role: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  const lines: InvoicedLine[] = []
  for (const invoice of invoices) {
    const net = netLineAmounts(
      invoice.items.map((item) => item.amount),
      invoice.discountAmount
    )
    invoice.items.forEach((item, index) => {
      const doctor = item.treatment?.doctor
      lines.push({
        invoiceId: invoice.id,
        itemId: item.id,
        billedAt: billedAt(invoice),
        amount: net[index],
        treatmentId: item.treatment?.id ?? null,
        procedure: item.treatment?.procedure ?? null,
        doctor: doctor
          ? {
              id: doctor.id,
              firstName: doctor.firstName,
              lastName: doctor.lastName,
              specialization: doctor.specialization,
              role: doctor.user.role,
            }
          : null,
      })
    })
  }
  return lines
}
