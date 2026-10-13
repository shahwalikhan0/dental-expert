import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { PAYMENT_METHODS, generateRefundNo, lockOpenSession, round2 } from '@/lib/cashier'
import { NO_OPEN_TILL, NO_OPEN_TILL_REFUND_MESSAGE, refundNeedsOpenTill } from '@/lib/till'
import { z } from 'zod'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { knownErrorResponse } from '@/lib/api-errors'
import {
  BillingRefusal,
  billingRefusalResponse,
  lockInvoice,
  settleInvoice,
} from '@/lib/invoice-settlement'

/**
 * POST /api/payments/[id]/refund — FR-014.
 *
 * "Record refund amount, method, reason, authorizer, and link to original
 * transaction." The previous version recorded amount, date and reason by
 * overwriting fields on the payment itself. That lost three things:
 *
 *  - the authoriser, so no one was accountable for money leaving
 *  - the method, so a card payment refunded in cash left the drawer short with
 *    nothing to explain it
 *  - any second refund, because `refundAmount` being set at all was treated as
 *    "already refunded" — a partial refund could never be followed by another
 *
 * A refund is now its own row linked to the payment. The legacy fields on
 * Payment are kept up to date as the running total so existing reads still
 * work. The invoice's paid amount and status are recounted from its payments
 * by `settleInvoice`, the same arithmetic every other money route uses.
 */

const refundSchema = z.object({
  refundAmount: z.number().positive('Refund amount must be greater than zero'),
  // Required, not optional: this is the field FR-014 exists for. The message
  // is attached to the type error as well as the length check, because a
  // missing field fails the type check first — and "expected string, received
  // undefined" tells the person at the front desk nothing.
  refundReason: z
    .string({ error: 'A reason for the refund is required' })
    .trim()
    .min(3, 'A reason for the refund is required')
    .max(1000),
  refundMethod: z.enum(PAYMENT_METHODS).optional(),
  transactionId: z.string().trim().max(120).optional().nullable(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('billing:refund')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = refundSchema.parse(await request.json())

    // Found outside the transaction only to learn which invoice to lock. Every
    // figure the refund depends on is read again once the lock is held.
    const located = await prisma.payment.findFirst({
      where: { id, hospitalId },
      select: { id: true, invoiceId: true },
    })
    if (!located) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    const outcome = await prisma.$transaction(async (tx) => {
      // The invoice row is the lock every movement of money on the invoice
      // takes, so two refunds of the same payment cannot both see it as
      // refundable, and a payment cannot land between this refund and the
      // recount below.
      await lockInvoice(tx, located.invoiceId, hospitalId)

      const payment = await tx.payment.findFirst({
        where: { id, hospitalId },
        include: { invoice: true, refunds: { select: { amount: true } } },
      })

      if (!payment) throw new BillingRefusal(404, 'Payment not found')

      if (payment.status === 'PENDING' || payment.status === 'FAILED') {
        throw new BillingRefusal(400, 'Only a settled payment can be refunded')
      }
      if (payment.status === 'CANCELLED') {
        throw new BillingRefusal(400, 'This payment was cancelled')
      }

      const alreadyRefunded = payment.refunds.reduce((sum, r) => sum + Number(r.amount), 0)
      const paymentAmount = Number(payment.amount)
      const remaining = round2(paymentAmount - alreadyRefunded)
      const refundAmount = round2(body.refundAmount)

      if (remaining <= 0) {
        throw new BillingRefusal(400, `${payment.paymentNo} has already been refunded in full`)
      }
      if (refundAmount > remaining) {
        throw new BillingRefusal(
          400,
          `Refund of ${refundAmount} exceeds the ${remaining} still refundable on ${payment.paymentNo}`
        )
      }

      // Money going out belongs to whichever till is open, so the closing
      // count sees the outflow. A cash refund needs one: it leaves the drawer,
      // and with no session to charge it to the next closing would come up
      // short with nothing on the record to say why (finding 38). A refund by
      // card, transfer, cheque or wallet does not touch the drawer, so it is
      // still recorded with no till open rather than holding up money owed to
      // a patient — see `refundNeedsOpenTill`. Read behind the same lock a
      // payment takes, so a closing cannot count the drawer mid-refund.
      const refundMethod = body.refundMethod ?? payment.paymentMethod
      const openSession = await lockOpenSession(tx, hospitalId, user.id)
      if (!openSession && refundNeedsOpenTill(refundMethod)) {
        throw new BillingRefusal(409, NO_OPEN_TILL_REFUND_MESSAGE, NO_OPEN_TILL)
      }

      const refundedTotal = round2(alreadyRefunded + refundAmount)
      const fullyRefunded = refundedTotal >= paymentAmount

      const refund = await tx.refund.create({
        data: {
          hospitalId,
          // Drawn inside the transaction, so a refund that fails after this
          // point gives its number back.
          refundNo: await generateRefundNo(hospitalId, tx),
          paymentId: payment.id,
          amount: refundAmount,
          // Defaults to however the money came in, which is the common case.
          refundMethod,
          reason: body.refundReason,
          authorisedById: user.id,
          cashierSessionId: openSession?.id ?? null,
          transactionId: body.transactionId || null,
        },
        include: {
          authorisedBy: { select: { id: true, name: true } },
          payment: { select: { id: true, paymentNo: true, amount: true } },
        },
      })

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          // Legacy mirror of the refund trail, kept for existing readers.
          refundAmount: refundedTotal,
          refundDate: new Date(),
          refundReason: body.refundReason,
        },
      })

      // Finding 39: the invoice's paid amount is recounted from its payments
      // less their refunds. It used to be the invoice's running total less
      // this refund, and after a duplicate payment was refunded the invoice
      // read REFUNDED with Rs 0 paid while the other payment stood.
      const settlement = await settleInvoice(tx, payment.invoice)

      return {
        payment,
        refund,
        refundAmount,
        refundedTotal,
        fullyRefunded,
        paymentAmount,
        openSession,
        settlement,
      }
    })

    const { payment, refund, refundAmount, refundedTotal, fullyRefunded, paymentAmount } = outcome

    // §10 asks for refunds in the audit history by name. The Refund row carries
    // the detail; this is what makes it show up alongside every other change to
    // the clinic's money in one chronological list.
    await recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.REFUND_ISSUED,
      entityType: 'Payment',
      entityId: payment.id,
      oldValues: { status: payment.status, refundedTotal: refundedTotal - refundAmount },
      newValues: {
        refundNo: refund.refundNo,
        paymentNo: payment.paymentNo,
        amount: refundAmount,
        method: refund.refundMethod,
        reason: body.refundReason,
        invoiceId: payment.invoiceId,
        invoiceStatus: outcome.settlement.status,
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json(
      {
        success: true,
        message: fullyRefunded
          ? 'Refund processed; the payment is now fully refunded'
          : `Refund processed; ${round2(paymentAmount - refundedTotal)} remains refundable`,
        refund,
        remainingRefundable: round2(paymentAmount - refundedTotal),
        cashierSessionNo: outcome.openSession?.sessionNo ?? null,
      },
      { status: 201 }
    )
  } catch (err) {
    // The schema's own messages are written for the desk; zod's field prefix
    // would only get in the way of them.
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid refund' },
        { status: 400 }
      )
    }
    const known = billingRefusalResponse(err) ?? knownErrorResponse(err)
    if (known) return known
    console.error('Error processing refund:', err)
    return NextResponse.json({ error: 'Failed to process refund' }, { status: 500 })
  }
}
