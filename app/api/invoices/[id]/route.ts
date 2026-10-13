import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import {
  SETTLED_PAYMENT_STATUSES,
  discountNeedsApproval,
  getDiscountApprovalThreshold,
} from '@/lib/cashier'
import { calculateInvoiceTotals, discountProblem } from '@/lib/billing-utils'
import { DiscountType, InvoiceStatus } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { holderCan } from '@/lib/rbac'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'
import {
  BillingRefusal,
  billingRefusalResponse,
  lockInvoice,
  lockTreatments,
  netPaid,
  treatmentBillingProblem,
  type PaymentForSettlement,
} from '@/lib/invoice-settlement'

// GET - Get single invoice with full details
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const invoice = await prisma.invoice.findUnique({
      where: { id, hospitalId },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            address: true,
            city: true,
            state: true,
            postalCode: true,
          },
        },
        items: {
          include: {
            treatment: {
              select: {
                id: true,
                treatmentNo: true,
                toothNumbers: true,
                procedure: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    category: true,
                  },
                },
                doctor: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
        payments: {
          orderBy: {
            paymentDate: 'desc',
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    return NextResponse.json(invoice)
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching invoice:', error)
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 })
  }
}

/**
 * The statuses a person may move an invoice to by hand.
 *
 * PAID, PARTIALLY_PAID and REFUNDED are missing on purpose: they describe the
 * invoice's money, and are set by recording a payment or a refund — never by
 * an edit (bug report 12 Oct, finding 15). An invoice marked PAID by hand with
 * nothing paid was "Paid" on its own screen and owed in receivables.
 */
const MANUAL_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['OVERDUE', 'CANCELLED'],
  PARTIALLY_PAID: ['OVERDUE', 'CANCELLED'],
  PAID: [],
  OVERDUE: ['CANCELLED'],
  CANCELLED: [],
  REFUNDED: [],
}

const MONEY_STATUSES: InvoiceStatus[] = ['PAID', 'PARTIALLY_PAID', 'REFUNDED']

/** What is audited about an invoice, flattened so `diffValues` can compare it. */
function auditView(invoice: {
  status: string
  subtotal: unknown
  discountType: string | null
  discountValue: unknown
  discountAmount: unknown
  discountApprovalStatus: string
  taxRate: unknown
  totalAmount: unknown
  dueDate: Date | null
  notes: string | null
}) {
  return {
    status: invoice.status,
    subtotal: Number(invoice.subtotal ?? 0),
    discountType: invoice.discountType,
    discountValue: Number(invoice.discountValue ?? 0),
    discountAmount: Number(invoice.discountAmount ?? 0),
    discountApprovalStatus: invoice.discountApprovalStatus,
    taxRate: Number(invoice.taxRate ?? 0),
    totalAmount: Number(invoice.totalAmount ?? 0),
    dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : null,
    notes: invoice.notes ?? null,
  }
}

/**
 * Why an invoice cannot be cancelled, or null.
 *
 * Money received and not handed back must go back first (finding 17).
 * Cancelling around it left Rs 4,800 recorded as paid on an invoice that
 * receivables no longer counted, with no refund and no credit anywhere — money
 * the clinic held and could not account for.
 */
function cancellationRefusal(invoice: {
  invoiceNo: string
  status: InvoiceStatus
  payments: PaymentForSettlement[]
}): BillingRefusal | null {
  if (invoice.status === 'CANCELLED') {
    return new BillingRefusal(409, `${invoice.invoiceNo} is already cancelled`)
  }
  const paid = netPaid(invoice.payments)
  if (paid > 0) {
    return new BillingRefusal(
      409,
      `${invoice.invoiceNo} has ${paid} paid against it. Refund the payments first, then cancel it.`
    )
  }
  return null
}

// PUT - Update invoice
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('billing:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    // `taxRate` is not read: the rate stamped on the invoice when it was raised
    // came from the clinic's settings, and an edit keeps it (finding 14).
    const {
      items,
      discountType,
      discountValue,
      discountReason,
      dueDate,
      notes,
      termsAndConditions,
      status,
    } = body

    if (status !== undefined && status !== null && !isEnumMember(InvoiceStatus, status)) {
      return enumRefusal('status', status, InvoiceStatus)
    }
    if (discountType !== undefined && discountType !== null) {
      if (!isEnumMember(DiscountType, discountType)) {
        return enumRefusal('discountType', discountType, DiscountType)
      }
    }
    if (items !== undefined && (!Array.isArray(items) || items.length === 0)) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }
    for (const item of items ?? []) {
      const quantity = Number(item?.quantity)
      const unitPrice = Number(item?.unitPrice)
      if (
        !item?.description ||
        !Number.isInteger(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        return NextResponse.json(
          {
            error:
              'Invalid item data. Description, quantity (>0), and unit price (>=0) are required',
          },
          { status: 400 }
        )
      }
    }
    if (dueDate && Number.isNaN(new Date(dueDate).getTime())) {
      return NextResponse.json({ error: 'The due date is not a valid date' }, { status: 400 })
    }

    const threshold = await getDiscountApprovalThreshold(hospitalId)

    const result = await prisma.$transaction(async (tx) => {
      // Held until the edit is written, so a payment cannot land between the
      // "no money taken yet" check below and the lines being replaced.
      await lockInvoice(tx, id, hospitalId)

      const existingInvoice = await tx.invoice.findUnique({
        where: { id, hospitalId },
        include: {
          items: true,
          payments: {
            select: {
              amount: true,
              status: true,
              refundAmount: true,
              refunds: { select: { amount: true } },
            },
          },
        },
      })

      if (!existingInvoice) throw new BillingRefusal(404, 'Invoice not found')

      // A paid, refunded or cancelled invoice is a closed document.
      if (['PAID', 'REFUNDED', 'CANCELLED'].includes(existingInvoice.status)) {
        throw new BillingRefusal(400, 'Cannot edit a paid, refunded or cancelled invoice')
      }

      // Don't allow editing what is owed once money has been taken against the
      // invoice. `COMPLETED` alone was not the right test: refunding part of a
      // payment moves it to PARTIALLY_REFUNDED, which would have unlocked the
      // line items of an invoice that had been paid and partly refunded — the
      // one case where the figures most need to stay put.
      const settledPayments = (existingInvoice.payments ?? []).filter((p) =>
        (SETTLED_PAYMENT_STATUSES as readonly string[]).includes(p.status)
      )
      const changesMoney =
        items !== undefined || discountType !== undefined || discountValue !== undefined
      if (settledPayments.length > 0 && changesMoney) {
        throw new BillingRefusal(
          400,
          'Cannot edit invoice items or the discount after payments have been made'
        )
      }

      let updateData: Prisma.InvoiceUncheckedUpdateInput = {}
      if (notes !== undefined) updateData.notes = notes
      if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions
      if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null
      if (discountReason !== undefined) updateData.discountReason = discountReason || null

      let approvalStatus = existingInvoice.discountApprovalStatus

      if (changesMoney) {
        const lines: any[] =
          items ??
          existingInvoice.items.map((item) => ({
            treatmentId: item.treatmentId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            taxable: item.taxable,
          }))
        const nextType = (discountType ?? existingInvoice.discountType ?? 'FIXED') as DiscountType
        const nextValue =
          discountValue !== undefined && discountValue !== null
            ? Number(discountValue)
            : Number(existingInvoice.discountValue ?? 0)

        const subtotal = lines.reduce(
          (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
          0
        )
        const discountRefusal = discountProblem(subtotal, nextType, nextValue)
        if (discountRefusal) throw new BillingRefusal(400, discountRefusal)

        const totals = calculateInvoiceTotals(
          lines.map((item) => ({
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxable: item.taxable !== false,
          })),
          nextType,
          nextValue,
          Number(existingInvoice.taxRate ?? 0)
        )

        // FR-013 again. The approval belonged to the discount it was given
        // for; a different discount needs its own decision. Without this a
        // draft approved at 10% could be edited to 60% and issued (finding 18).
        if (totals.discountAmount !== Number(existingInvoice.discountAmount ?? 0)) {
          if (discountNeedsApproval(totals.discountAmount, threshold)) {
            const reason =
              discountReason !== undefined ? discountReason : existingInvoice.discountReason
            if (!reason || String(reason).trim().length < 3) {
              throw new BillingRefusal(
                400,
                `A discount of ${totals.discountAmount} is above the ${threshold} approval threshold and needs a reason`
              )
            }
            if (holderCan(user, 'billing:discount')) {
              approvalStatus = 'APPROVED'
              updateData = {
                ...updateData,
                discountApprovalStatus: 'APPROVED',
                discountRequestedById: user?.id ?? null,
                discountApprovedById: user?.id ?? null,
                discountDecidedAt: new Date(),
                discountDecisionNote: null,
              }
            } else {
              if (existingInvoice.status !== 'DRAFT') {
                throw new BillingRefusal(
                  409,
                  'A discount that needs approval can only be set while the invoice is a draft'
                )
              }
              approvalStatus = 'PENDING'
              updateData = {
                ...updateData,
                discountApprovalStatus: 'PENDING',
                discountRequestedById: user?.id ?? null,
                discountApprovedById: null,
                discountDecidedAt: null,
                discountDecisionNote: null,
              }
            }
          } else {
            approvalStatus = 'NOT_REQUIRED'
            updateData = {
              ...updateData,
              discountApprovalStatus: 'NOT_REQUIRED',
              discountRequestedById: null,
              discountApprovedById: null,
              discountDecidedAt: null,
              discountDecisionNote: null,
            }
          }
        }

        updateData = {
          ...updateData,
          subtotal: totals.subtotal,
          discountType: nextType,
          discountValue: nextValue,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          // No settled payment, so nothing has been paid.
          paidAmount: 0,
          balanceAmount: totals.totalAmount,
        }

        if (items !== undefined) {
          const treatmentIds: string[] = items
            .map((item: any) => item.treatmentId)
            .filter((treatmentId: unknown): treatmentId is string => !!treatmentId)
          await lockTreatments(tx, treatmentIds)
          const treatmentRefusal = await treatmentBillingProblem(tx, {
            hospitalId,
            patientId: existingInvoice.patientId,
            treatmentIds,
            invoiceId: id,
          })
          if (treatmentRefusal) throw new BillingRefusal(409, treatmentRefusal)

          await tx.invoiceItem.deleteMany({ where: { invoiceId: id } })
          await tx.invoiceItem.createMany({
            data: items.map((item: any) => ({
              invoiceId: id,
              treatmentId: item.treatmentId || null,
              description: item.description,
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              amount: Number(item.quantity) * Number(item.unitPrice),
              taxable: item.taxable !== false,
            })),
          })
        }
      }

      if (status && status !== existingInvoice.status) {
        if (MONEY_STATUSES.includes(status)) {
          throw new BillingRefusal(
            400,
            `${status} is set by recording payments and refunds, not by editing the invoice`
          )
        }

        // FR-013: an unapproved discount must not reach the patient, and a
        // rejected one must be changed before it does. Cancelling stays open —
        // an invoice stuck waiting on an approval nobody intends to give still
        // has to be disposable.
        if (
          (approvalStatus === 'PENDING' || approvalStatus === 'REJECTED') &&
          status !== 'DRAFT' &&
          status !== 'CANCELLED'
        ) {
          throw new BillingRefusal(
            409,
            approvalStatus === 'PENDING'
              ? `The discount on this invoice is still awaiting approval, so it cannot be moved to ${status}`
              : `The discount on this invoice was rejected. Change it before moving the invoice to ${status}`
          )
        }

        if (!MANUAL_TRANSITIONS[existingInvoice.status].includes(status)) {
          throw new BillingRefusal(
            400,
            `Cannot transition from ${existingInvoice.status} to ${status}`
          )
        }

        if (status === 'CANCELLED') {
          const refusal = cancellationRefusal(existingInvoice)
          if (refusal) throw refusal
        }

        updateData.status = status
      }

      const invoice = await tx.invoice.update({
        where: { id, hospitalId },
        data: updateData,
        include: {
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
          items: {
            include: {
              treatment: {
                select: {
                  id: true,
                  treatmentNo: true,
                  procedure: {
                    select: {
                      name: true,
                      code: true,
                    },
                  },
                },
              },
            },
          },
          payments: {
            orderBy: {
              paymentDate: 'desc',
            },
          },
        },
      })

      return { before: existingInvoice, invoice }
    })

    const { before, invoice } = result
    const diff = diffValues(auditView(before), auditView({ ...before, ...invoice }))
    if (diff.changed.length > 0 || items !== undefined) {
      await recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action:
          invoice.status === 'CANCELLED' && before.status !== 'CANCELLED'
            ? AUDIT_ACTIONS.INVOICE_CANCELLED
            : AUDIT_ACTIONS.INVOICE_UPDATED,
        entityType: 'Invoice',
        entityId: id,
        oldValues: diff.before,
        newValues: {
          invoiceNo: before.invoiceNo,
          ...diff.after,
          ...(items !== undefined ? { items: items.length } : {}),
        },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json(invoice)
  } catch (error) {
    const known = billingRefusalResponse(error) ?? knownErrorResponse(error)
    if (known) return known
    console.error('Error updating invoice:', error)
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
  }
}

/**
 * DELETE - Cancel an invoice.
 *
 * Nothing is deleted any more (finding 68). An invoice with no payments used
 * to be removed with its lines, which left a gap in the numbering and no
 * record of why. It is now CANCELLED and kept, lines and all: the number stays
 * accounted for, and its treatments become billable again because the billed
 * rule ignores cancelled invoices. One with money still on it is refused until
 * that money is refunded (finding 17).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, user } = await requirePermission('billing:void')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const { before, invoice } = await prisma.$transaction(async (tx) => {
      // A payment taken while this runs would otherwise land on an invoice
      // that is being cancelled.
      await lockInvoice(tx, id, hospitalId)

      const existingInvoice = await tx.invoice.findUnique({
        where: { id, hospitalId },
        include: {
          payments: {
            select: {
              amount: true,
              status: true,
              refundAmount: true,
              refunds: { select: { amount: true } },
            },
          },
        },
      })

      if (!existingInvoice) throw new BillingRefusal(404, 'Invoice not found')

      const refusal = cancellationRefusal(existingInvoice)
      if (refusal) throw refusal

      const invoice = await tx.invoice.update({
        where: { id, hospitalId },
        data: { status: 'CANCELLED' },
      })
      return { before: existingInvoice, invoice }
    })

    await recordAudit({
      hospitalId,
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.INVOICE_CANCELLED,
      entityType: 'Invoice',
      entityId: id,
      oldValues: { status: before.status },
      newValues: {
        invoiceNo: before.invoiceNo,
        status: 'CANCELLED',
        totalAmount: Number(before.totalAmount ?? 0),
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({
      message: `${before.invoiceNo} cancelled`,
      invoice,
    })
  } catch (error) {
    const known = billingRefusalResponse(error) ?? knownErrorResponse(error)
    if (known) return known
    console.error('Error cancelling invoice:', error)
    return NextResponse.json({ error: 'Failed to cancel invoice' }, { status: 500 })
  }
}
