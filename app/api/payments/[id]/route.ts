import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { PaymentStatus } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { SETTLED_PAYMENT_STATUSES, lockOpenSession } from '@/lib/cashier'
import { NO_OPEN_TILL, NO_OPEN_TILL_MESSAGE } from '@/lib/till'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import {
  BillingRefusal,
  billingRefusalResponse,
  lockInvoice,
  readSettlement,
  settleInvoice,
} from '@/lib/invoice-settlement'

// GET - Get single payment details
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const payment = await prisma.payment.findUnique({
      where: { id, hospitalId },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true,
            status: true,
            patient: {
              select: {
                id: true,
                patientId: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
        // What has already gone back, so a refund screen can show the running
        // total rather than offering the full amount a second time.
        refunds: {
          select: {
            id: true,
            refundNo: true,
            amount: true,
            refundMethod: true,
            reason: true,
            refundedAt: true,
            authorisedBy: { select: { id: true, name: true } },
          },
          orderBy: { refundedAt: 'desc' },
        },
      },
    })

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // The clinic's letterhead, for the receipt. Carried here rather than left to
    // the receipt screen to fetch from /api/settings/clinic, which needs
    // `settings:read` — a capability a cashier has no other reason to hold, and
    // should not have to hold in order to hand somebody a receipt.
    const clinic = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { name: true, address: true, city: true, phone: true, email: true },
    })

    return NextResponse.json({ ...payment, clinic })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching payment:', error)
    return NextResponse.json({ error: 'Failed to fetch payment' }, { status: 500 })
  }
}

// PUT - Update payment (mainly for notes or settling a pending payment)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('billing:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { notes, status } = body

    if (status !== undefined && status !== null && !isEnumMember(PaymentStatus, status)) {
      return enumRefusal('status', status, PaymentStatus)
    }

    const located = await prisma.payment.findUnique({
      where: { id, hospitalId },
      select: { id: true, invoiceId: true },
    })
    if (!located) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    const { payment, before, completed } = await prisma.$transaction(async (tx) => {
      // Completing a pending payment moves the invoice's money, so it takes
      // the same lock as taking a payment does.
      await lockInvoice(tx, located.invoiceId, hospitalId)

      const existingPayment = await tx.payment.findUnique({
        where: { id, hospitalId },
        include: {
          invoice: true,
        },
      })

      if (!existingPayment) throw new BillingRefusal(404, 'Payment not found')

      const updateData: Prisma.PaymentUncheckedUpdateInput = {}

      // Allow updating notes
      if (notes !== undefined) {
        updateData.notes = notes
      }

      let completed = false

      // Handle status changes (mainly for pending payments)
      if (status && status !== existingPayment.status) {
        if (existingPayment.status !== 'PENDING') {
          throw new BillingRefusal(
            400,
            existingPayment.status === 'COMPLETED'
              ? 'Cannot change status of a completed payment. Use refund instead.'
              : `Cannot change payment status from ${existingPayment.status} to ${status}`
          )
        }
        if (status !== 'COMPLETED' && status !== 'CANCELLED' && status !== 'FAILED') {
          throw new BillingRefusal(
            400,
            `Cannot change payment status from ${existingPayment.status} to ${status}`
          )
        }

        updateData.status = status

        if (status === 'COMPLETED') {
          // The same rules as taking the payment fresh: the invoice must be
          // issued, its discount decided, and the money not more than it owes.
          const invoice = existingPayment.invoice
          if (['DRAFT', 'CANCELLED', 'REFUNDED'].includes(invoice.status)) {
            throw new BillingRefusal(
              409,
              `A payment cannot be completed on a ${invoice.status.toLowerCase()} invoice`
            )
          }
          if (
            invoice.discountApprovalStatus === 'PENDING' ||
            invoice.discountApprovalStatus === 'REJECTED'
          ) {
            throw new BillingRefusal(
              409,
              'The discount on this invoice has not been approved, so the payment cannot be completed'
            )
          }
          const current = await readSettlement(tx, invoice)
          if (Number(existingPayment.amount) > current.balanceAmount) {
            throw new BillingRefusal(
              400,
              `Payment amount (${Number(existingPayment.amount)}) exceeds balance (${current.balanceAmount})`
            )
          }

          // Money received now belongs to the till open now, and with no till
          // open it belongs to none — so, as when taking a payment fresh, it is
          // refused until one is opened (finding 38). It goes into the till
          // open now even if it was once attached to another: the money is
          // arriving in today's drawer, and a session closed since was counted
          // without it.
          const openSession = await lockOpenSession(tx, hospitalId, user?.id)
          if (!openSession) {
            throw new BillingRefusal(409, NO_OPEN_TILL_MESSAGE, NO_OPEN_TILL)
          }
          updateData.cashierSessionId = openSession.id
          completed = true
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw new BillingRefusal(400, 'No valid fields to update')
      }

      const payment = await tx.payment.update({
        where: { id, hospitalId },
        data: updateData,
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNo: true,
              totalAmount: true,
              paidAmount: true,
              balanceAmount: true,
              status: true,
            },
          },
        },
      })

      if (!completed) return { payment, before: existingPayment, completed }

      // The invoice in the response is the one as recounted, not as it was
      // read a moment before the recount.
      const settlement = await settleInvoice(tx, existingPayment.invoice)
      return {
        payment: { ...payment, invoice: { ...payment.invoice, ...settlement } },
        before: existingPayment,
        completed,
      }
    })

    if (completed) {
      await recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.PAYMENT_RECORDED,
        entityType: 'Payment',
        entityId: payment.id,
        oldValues: { status: before.status },
        newValues: {
          paymentNo: payment.paymentNo,
          invoiceId: before.invoiceId,
          amount: Number(payment.amount),
          method: payment.paymentMethod,
          status: 'COMPLETED',
          cashierSessionId: payment.cashierSessionId ?? null,
        },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json(payment)
  } catch (error) {
    const known = billingRefusalResponse(error) ?? knownErrorResponse(error)
    if (known) return known
    console.error('Error updating payment:', error)
    return NextResponse.json({ error: 'Failed to update payment' }, { status: 500 })
  }
}

// DELETE - Delete a payment that never settled
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('billing:void')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Check if payment exists
    const existingPayment = await prisma.payment.findUnique({
      where: { id, hospitalId },
    })

    if (!existingPayment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Only a payment that never brought money in can go. A completed one is
    // refunded instead; so is one already refunded in part or in full, whose
    // refund rows are the record of money leaving and must keep their payment.
    if ((SETTLED_PAYMENT_STATUSES as readonly string[]).includes(existingPayment.status)) {
      return NextResponse.json(
        { error: 'Cannot delete a completed payment. Use refund instead.' },
        { status: 400 }
      )
    }

    // Delete the payment
    await prisma.payment.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Payment deleted successfully' })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting payment:', error)
    return NextResponse.json({ error: 'Failed to delete payment' }, { status: 500 })
  }
}
