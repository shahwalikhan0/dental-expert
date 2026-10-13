/**
 * GET /api/portal/bills — invoices, what has been paid, what is outstanding.
 *
 * DRAFT invoices are excluded. A draft is the clinic still deciding — the
 * total moves, lines come and go — and a patient who reads one will believe
 * they owe a number nobody has agreed to yet.
 *
 * The discount *approval* fields are not selected either. Who requested a
 * discount, who approved it and what they wrote in the decision note is the
 * clinic's internal business; the patient's business is the amount, which is
 * in `discountAmount` and already reflected in the total.
 *
 * What is owed is decided by the rule every clinic screen uses
 * (lib/invoice-figures.ts), so the patient's "Outstanding" is the figure the
 * desk would chase, and a cancelled or refunded bill is never shown as due.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePortalPatient } from '@/lib/portal/auth'
import { SETTLED_PAYMENT_STATUSES } from '@/lib/cashier'
import { isInvoiceOwed, money, outstandingOf } from '@/lib/invoice-figures'

export async function GET() {
  const { error, caller } = await requirePortalPatient()
  if (error) return error

  const invoices = await prisma.invoice.findMany({
    where: {
      patientId: caller.patient.id,
      hospitalId: caller.patient.hospitalId,
      status: { not: 'DRAFT' },
    },
    select: {
      id: true,
      invoiceNo: true,
      subtotal: true,
      discountAmount: true,
      taxAmount: true,
      totalAmount: true,
      paidAmount: true,
      balanceAmount: true,
      status: true,
      dueDate: true,
      issuedAt: true,
      createdAt: true,
      items: {
        select: { id: true, description: true, quantity: true, unitPrice: true, amount: true },
      },
      payments: {
        // Every payment the patient actually made, refunded or not, with what
        // went back listed under it. Filtering to COMPLETED dropped a payment
        // the moment any of it was refunded, while "Paid" above still counted
        // what was kept of it — the patient saw Paid 3,000 and no payment at
        // all. A failed or pending payment is still left out: no money moved.
        where: { status: { in: [...SETTLED_PAYMENT_STATUSES] as never } },
        select: {
          id: true,
          paymentNo: true,
          amount: true,
          paymentDate: true,
          paymentMethod: true,
          refunds: {
            select: { id: true, refundNo: true, amount: true, refundedAt: true },
            orderBy: { refundedAt: 'asc' },
          },
        },
        orderBy: { paymentDate: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const data = invoices.map((inv) => ({
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    subtotal: Number(inv.subtotal),
    discount: Number(inv.discountAmount),
    tax: Number(inv.taxAmount),
    total: Number(inv.totalAmount),
    paid: Number(inv.paidAmount),
    balance: Number(inv.balanceAmount),
    // Whether the patient owes anything on it. The balance column alone says
    // yes for a cancelled bill and for one whose charge was refunded in full.
    owed: isInvoiceOwed(inv),
    status: inv.status,
    dueDate: inv.dueDate,
    // The day it was issued, which is the day it became the patient's bill.
    date: inv.issuedAt ?? inv.createdAt,
    items: inv.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      amount: Number(item.amount),
    })),
    payments: inv.payments.map((p) => ({
      id: p.id,
      paymentNo: p.paymentNo,
      amount: Number(p.amount),
      date: p.paymentDate,
      method: p.paymentMethod,
    })),
    refunds: inv.payments
      .flatMap((p) =>
        p.refunds.map((r) => ({
          id: r.id,
          refundNo: r.refundNo,
          paymentNo: p.paymentNo,
          amount: money(r.amount),
          date: r.refundedAt,
        }))
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
  }))

  return NextResponse.json({
    success: true,
    data: {
      invoices: data,
      // Computed here rather than in the browser so the figure the patient
      // reads and the figure the clinic chases come from the same arithmetic.
      outstanding: outstandingOf(invoices),
    },
  })
}
