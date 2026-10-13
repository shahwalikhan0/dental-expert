import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { generatePaymentNo } from '@/lib/billing-utils'
import { getOpenSession, round2 } from '@/lib/cashier'
import { PaymentMethod } from '@prisma/client'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import {
  BillingRefusal,
  billingRefusalResponse,
  lockInvoice,
  readSettlement,
  settleInvoice,
} from '@/lib/invoice-settlement'

// GET - Get payments for an invoice
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Check if invoice exists
    const invoice = await prisma.invoice.findUnique({
      where: { id, hospitalId },
      select: {
        id: true,
        invoiceNo: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const payments = await prisma.payment.findMany({
      where: { invoiceId: id, hospitalId },
      orderBy: {
        paymentDate: 'desc',
      },
    })

    return NextResponse.json({
      invoice,
      payments,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching payments:', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

// POST - Record a payment for an invoice
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('billing:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const {
      amount: rawAmount,
      paymentMethod,
      paymentDate = new Date(),
      transactionId,
      bankName,
      chequeNumber,
      chequeDate,
      notes,
    } = body

    // Everything that can be checked without the invoice is checked before
    // the transaction, so a malformed request never draws a payment number.
    const amount = round2(Number(rawAmount))
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Valid payment amount is required' }, { status: 400 })
    }

    if (!paymentMethod) {
      return NextResponse.json({ error: 'Payment method is required' }, { status: 400 })
    }
    // Finding 49: `"BITCOIN"` reached Prisma and came back as a 500.
    if (!isEnumMember(PaymentMethod, paymentMethod)) {
      return enumRefusal('paymentMethod', paymentMethod, PaymentMethod)
    }

    const paidOn = new Date(paymentDate)
    if (Number.isNaN(paidOn.getTime())) {
      return NextResponse.json({ error: 'The payment date is not a valid date' }, { status: 400 })
    }
    const chequeOn = chequeDate ? new Date(chequeDate) : null
    if (chequeOn && Number.isNaN(chequeOn.getTime())) {
      return NextResponse.json({ error: 'The cheque date is not a valid date' }, { status: 400 })
    }

    // One transaction, holding the invoice row, from reading the balance to
    // writing the new one (finding 16). Three "pay 3,000" requests against a
    // Rs 3,000 invoice used to all read a balance of 3,000; two were accepted.
    // Now the second waits for the first to commit and then reads a balance
    // of 0.
    const { payment, invoiceNo, settlement, previousStatus } = await prisma.$transaction(
      async (tx) => {
        await lockInvoice(tx, id, hospitalId)

        const invoice = await tx.invoice.findUnique({
          where: { id, hospitalId },
        })

        if (!invoice) throw new BillingRefusal(404, 'Invoice not found')

        // Check if invoice can accept payments
        if (invoice.status === 'CANCELLED' || invoice.status === 'REFUNDED') {
          throw new BillingRefusal(400, 'Cannot add payment to a cancelled or refunded invoice')
        }

        // Finding 18: a payment on a draft was accepted, and the invoice became
        // PARTIALLY_PAID at a discount nobody had approved. A draft is not a
        // bill yet; it is issued first, and issuing is where the discount
        // approval is checked.
        if (invoice.status === 'DRAFT') {
          throw new BillingRefusal(
            409,
            'This invoice is still a draft. Issue it before taking a payment.'
          )
        }
        if (
          invoice.discountApprovalStatus === 'PENDING' ||
          invoice.discountApprovalStatus === 'REJECTED'
        ) {
          throw new BillingRefusal(
            409,
            invoice.discountApprovalStatus === 'PENDING'
              ? 'The discount on this invoice is awaiting approval. A payment can be taken once it is decided.'
              : 'The discount on this invoice was rejected. Correct the invoice before taking a payment.'
          )
        }

        // The balance as the payments have it, not as the invoice last
        // recorded it. An invoice marked PAID by hand before that was refused
        // still has a balance, and can now take the payment it is owed.
        const current = await readSettlement(tx, invoice)
        if (current.balanceAmount <= 0) {
          throw new BillingRefusal(400, 'Invoice is already fully paid')
        }
        if (amount > current.balanceAmount) {
          throw new BillingRefusal(
            400,
            `Payment amount (${amount}) exceeds balance (${current.balanceAmount})`
          )
        }

        const paymentNo = await generatePaymentNo(tx, hospitalId)

        // FR-015: a payment taken while a till is open belongs to that till's
        // reconciliation — the receiving user's own till where they have one —
        // and spec §12 names the cashier on a financial transaction. Taking
        // payment with no session open still works: there is no screen yet to
        // open a till, and requiring one would stop every payment (finding 38).
        const openSession = await getOpenSession(hospitalId, { db: tx, userId: user?.id })

        const payment = await tx.payment.create({
          data: {
            hospitalId,
            paymentNo,
            invoiceId: id,
            amount,
            paymentMethod,
            paymentDate: paidOn,
            status: 'COMPLETED',
            transactionId,
            bankName,
            chequeNumber,
            chequeDate: chequeOn,
            notes,
            cashierSessionId: openSession?.id ?? null,
            recordedById: user?.id ?? null,
          },
        })

        const settlement = await settleInvoice(tx, invoice)

        return {
          payment,
          invoiceNo: invoice.invoiceNo,
          settlement,
          previousStatus: invoice.status,
        }
      }
    )

    await recordAudit({
      hospitalId,
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.PAYMENT_RECORDED,
      entityType: 'Payment',
      entityId: payment.id,
      oldValues: { invoiceStatus: previousStatus },
      newValues: {
        paymentNo: payment.paymentNo,
        invoiceId: id,
        invoiceNo,
        amount,
        method: paymentMethod,
        cashierSessionId: payment.cashierSessionId ?? null,
        invoiceStatus: settlement.status,
        balanceAmount: settlement.balanceAmount,
      },
      ...requestContext(request.headers),
    })

    // Return updated invoice with payment
    const updatedInvoice = await prisma.invoice.findUnique({
      where: { id, hospitalId },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        payments: {
          orderBy: {
            paymentDate: 'desc',
          },
        },
      },
    })

    return NextResponse.json(
      {
        payment,
        invoice: updatedInvoice,
      },
      { status: 201 }
    )
  } catch (error) {
    const known = billingRefusalResponse(error) ?? knownErrorResponse(error)
    if (known) return known
    console.error('Error recording payment:', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
