import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { PAYMENT_METHODS, generateRefundNo, getOpenSession, round2 } from '@/lib/cashier'
import { z } from 'zod'

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
 * work.
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

    const payment = await prisma.payment.findFirst({
      where: { id, hospitalId },
      include: { invoice: true, refunds: { select: { amount: true } } },
    })

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (payment.status === 'PENDING' || payment.status === 'FAILED') {
      return NextResponse.json({ error: 'Only a settled payment can be refunded' }, { status: 400 })
    }
    if (payment.status === 'CANCELLED') {
      return NextResponse.json({ error: 'This payment was cancelled' }, { status: 400 })
    }

    const alreadyRefunded = payment.refunds.reduce((sum, r) => sum + Number(r.amount), 0)
    const paymentAmount = Number(payment.amount)
    const remaining = round2(paymentAmount - alreadyRefunded)
    const refundAmount = round2(body.refundAmount)

    if (remaining <= 0) {
      return NextResponse.json(
        { error: `${payment.paymentNo} has already been refunded in full` },
        { status: 400 }
      )
    }
    if (refundAmount > remaining) {
      return NextResponse.json(
        {
          error: `Refund of ${refundAmount} exceeds the ${remaining} still refundable on ${payment.paymentNo}`,
        },
        { status: 400 }
      )
    }

    // Money going out belongs to whichever till is open, so the closing count
    // sees the outflow. Refunds outside an open session are still recorded —
    // they simply do not land in anyone's drawer count.
    const openSession = await getOpenSession(hospitalId)

    const refundedTotal = round2(alreadyRefunded + refundAmount)
    const fullyRefunded = refundedTotal >= paymentAmount

    const newPaidAmount = round2(Number(payment.invoice.paidAmount) - refundAmount)
    const newBalanceAmount = round2(Number(payment.invoice.totalAmount) - newPaidAmount)
    let invoiceStatus = payment.invoice.status
    if (newPaidAmount <= 0) {
      invoiceStatus = 'REFUNDED'
    } else if (newBalanceAmount > 0) {
      invoiceStatus = 'PARTIALLY_PAID'
    }

    const [refund] = await prisma.$transaction([
      prisma.refund.create({
        data: {
          hospitalId,
          refundNo: await generateRefundNo(hospitalId),
          paymentId: payment.id,
          amount: refundAmount,
          // Defaults to however the money came in, which is the common case.
          refundMethod: body.refundMethod ?? payment.paymentMethod,
          reason: body.refundReason,
          authorisedById: user.id,
          cashierSessionId: openSession?.id ?? null,
          transactionId: body.transactionId || null,
        },
        include: {
          authorisedBy: { select: { id: true, name: true } },
          payment: { select: { id: true, paymentNo: true, amount: true } },
        },
      }),
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          // Legacy mirror of the refund trail, kept for existing readers.
          refundAmount: refundedTotal,
          refundDate: new Date(),
          refundReason: body.refundReason,
        },
      }),
      prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          paidAmount: newPaidAmount,
          balanceAmount: newBalanceAmount,
          status: invoiceStatus,
        },
      }),
    ])

    return NextResponse.json(
      {
        success: true,
        message: fullyRefunded
          ? 'Refund processed; the payment is now fully refunded'
          : `Refund processed; ${round2(paymentAmount - refundedTotal)} remains refundable`,
        refund,
        remainingRefundable: round2(paymentAmount - refundedTotal),
        cashierSessionNo: openSession?.sessionNo ?? null,
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid refund' },
        { status: 400 }
      )
    }
    console.error('Error processing refund:', err)
    return NextResponse.json({ error: 'Failed to process refund' }, { status: 500 })
  }
}
