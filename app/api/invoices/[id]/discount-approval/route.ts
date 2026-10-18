import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { z } from 'zod'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { BillingRefusal, billingRefusalResponse, lockInvoice } from '@/lib/invoice-settlement'
import { otherDiscountApproverExists } from '@/lib/cashier'

/**
 * POST /api/invoices/[id]/discount-approval — the second half of FR-013.
 *
 * Reception can raise an invoice carrying a discount but cannot approve it:
 * `billing:discount` belongs to ADMIN and CLINIC_MANAGER alone, which is the
 * separation FR-013 asks for. This is where that decision is recorded, with
 * the approver named on the invoice.
 *
 * Rejecting does not silently strip the discount. The invoice stays as it was,
 * marked REJECTED with a note, so whoever raised it can see why and correct it
 * deliberately rather than finding the figure changed under them.
 */

const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(1000).optional().nullable(),
  // The discount the approver was looking at. If it has changed since, the
  // decision is about a different discount and is refused (review 4.8).
  expectedDiscountAmount: z.number().nonnegative().optional().nullable(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('billing:discount')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = decisionSchema.parse(await req.json())

    if (body.decision === 'REJECT' && !body.note) {
      return NextResponse.json(
        { error: 'A note is required when rejecting a discount' },
        { status: 400 }
      )
    }

    // Under the invoice's row lock, so the discount cannot be edited between
    // the check below and the decision being written.
    const outcome = await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, id, hospitalId)
      const invoice = await tx.invoice.findFirst({
        where: { id, hospitalId },
        select: {
          id: true,
          invoiceNo: true,
          discountAmount: true,
          discountApprovalStatus: true,
          discountRequestedById: true,
        },
      })

      if (!invoice) throw new BillingRefusal(404, 'Invoice not found')

      if (invoice.discountApprovalStatus !== 'PENDING') {
        throw new BillingRefusal(
          409,
          invoice.discountApprovalStatus === 'NOT_REQUIRED'
            ? `${invoice.invoiceNo} has no discount needing approval`
            : `The discount on ${invoice.invoiceNo} was already ${invoice.discountApprovalStatus.toLowerCase()}`
        )
      }

      if (
        body.expectedDiscountAmount != null &&
        Math.abs(Number(invoice.discountAmount) - body.expectedDiscountAmount) > 0.005
      ) {
        throw new BillingRefusal(
          409,
          `The discount on ${invoice.invoiceNo} has changed since you opened it. Reload the invoice and decide again.`
        )
      }

      // The person who asked for the discount must not be the one approving it,
      // even where they hold the capability — that is the whole point of FR-013.
      //
      // One exception, so a practice with a single approver is not left with
      // discounts nobody can ever decide (finding 10, 16 Oct): when nobody else
      // in the clinic holds `billing:discount`, the requester may approve their
      // own, but only with a note saying why, and it is recorded as a
      // self-approval so an auditor can find every one. To withdraw their own
      // request they edit the discount, as before.
      const ownRequest =
        !!invoice.discountRequestedById && invoice.discountRequestedById === user.id
      const selfApproved =
        ownRequest &&
        body.decision === 'APPROVE' &&
        !(await otherDiscountApproverExists(tx, hospitalId, user.id))
      if (ownRequest && !selfApproved) {
        throw new BillingRefusal(
          403,
          'A discount cannot be approved by the person who requested it'
        )
      }
      if (selfApproved && !body.note) {
        throw new BillingRefusal(
          400,
          'You are the only approver in the clinic, so approving your own discount needs a note saying why'
        )
      }

      const updated = await tx.invoice.update({
        where: { id },
        data: {
          discountApprovalStatus: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          discountApprovedById: user.id,
          discountDecidedAt: new Date(),
          discountDecisionNote: body.note || null,
        },
        include: {
          discountApprovedBy: { select: { id: true, name: true } },
          discountRequestedBy: { select: { id: true, name: true } },
        },
      })
      return { invoice, updated, selfApproved }
    })
    const { invoice, updated, selfApproved } = outcome

    // The decision is on the invoice already. It goes here too because the
    // audit screen is where somebody looks for "what was approved this month,
    // and by whom" — a question the invoice cannot answer on its own.
    await recordAudit({
      hospitalId,
      userId: user.id,
      action: selfApproved
        ? AUDIT_ACTIONS.DISCOUNT_SELF_APPROVED
        : body.decision === 'APPROVE'
          ? AUDIT_ACTIONS.DISCOUNT_APPROVED
          : AUDIT_ACTIONS.DISCOUNT_REJECTED,
      entityType: 'Invoice',
      entityId: invoice.id,
      oldValues: { discountApprovalStatus: invoice.discountApprovalStatus },
      newValues: {
        invoiceNo: invoice.invoiceNo,
        discountAmount: Number(invoice.discountAmount),
        decision: body.decision,
        note: body.note ?? null,
        requestedById: invoice.discountRequestedById,
        ...(selfApproved ? { selfApproved: true, reason: 'No other approver in the clinic' } : {}),
      },
      ...requestContext(req.headers),
    })

    return NextResponse.json({
      success: true,
      message:
        body.decision === 'APPROVE'
          ? `Discount on ${invoice.invoiceNo} approved; the invoice can now be issued`
          : `Discount on ${invoice.invoiceNo} rejected; the invoice stays in draft`,
      data: updated,
    })
  } catch (err) {
    const refusal = billingRefusalResponse(err)
    if (refusal) return refusal
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid decision' },
        { status: 400 }
      )
    }
    console.error('Discount approval error:', err)
    return NextResponse.json({ error: 'Failed to record the decision' }, { status: 500 })
  }
}
