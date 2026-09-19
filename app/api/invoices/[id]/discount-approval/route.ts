import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { z } from 'zod'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

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
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('billing:discount')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = decisionSchema.parse(await req.json())

    const invoice = await prisma.invoice.findFirst({
      where: { id, hospitalId },
      select: {
        id: true,
        invoiceNo: true,
        discountAmount: true,
        discountApprovalStatus: true,
        discountRequestedById: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.discountApprovalStatus !== 'PENDING') {
      return NextResponse.json(
        {
          error:
            invoice.discountApprovalStatus === 'NOT_REQUIRED'
              ? `${invoice.invoiceNo} has no discount needing approval`
              : `The discount on ${invoice.invoiceNo} was already ${invoice.discountApprovalStatus.toLowerCase()}`,
        },
        { status: 409 }
      )
    }

    // The person who asked for the discount must not be the one approving it,
    // even where they hold the capability — that is the whole point of FR-013.
    if (invoice.discountRequestedById && invoice.discountRequestedById === user.id) {
      return NextResponse.json(
        { error: 'A discount cannot be approved by the person who requested it' },
        { status: 403 }
      )
    }

    if (body.decision === 'REJECT' && !body.note) {
      return NextResponse.json(
        { error: 'A note is required when rejecting a discount' },
        { status: 400 }
      )
    }

    const updated = await prisma.invoice.update({
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

    // The decision is on the invoice already. It goes here too because the
    // audit screen is where somebody looks for "what was approved this month,
    // and by whom" — a question the invoice cannot answer on its own.
    await recordAudit({
      hospitalId,
      userId: user.id,
      action:
        body.decision === 'APPROVE'
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
