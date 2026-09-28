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
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePortalPatient } from '@/lib/portal/auth'

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
      createdAt: true,
      items: {
        select: { id: true, description: true, quantity: true, unitPrice: true, amount: true },
      },
      payments: {
        // A refunded or failed payment is not money the patient has paid, and
        // listing it as one invites a telephone call about a receipt that does
        // not exist.
        where: { status: 'COMPLETED' },
        select: { id: true, paymentNo: true, amount: true, paymentDate: true, paymentMethod: true },
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
    status: inv.status,
    dueDate: inv.dueDate,
    date: inv.createdAt,
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
  }))

  return NextResponse.json({
    success: true,
    data: {
      invoices: data,
      // Computed here rather than in the browser so the figure the patient
      // reads and the figure the clinic chases come from the same arithmetic.
      outstanding: data
        .filter((inv) => inv.status !== 'CANCELLED' && inv.status !== 'REFUNDED')
        .reduce((sum, inv) => sum + inv.balance, 0),
    },
  })
}
