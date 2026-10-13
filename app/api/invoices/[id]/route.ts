import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { discountNeedsApproval, getDiscountApprovalThreshold } from '@/lib/cashier'
import { calculateInvoiceTotals, discountProblem, resolveTaxRate } from '@/lib/billing-utils'
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
import {
  concessionOf,
  parseInvoiceLines,
  productLineProblem,
  treatmentIdsOf,
  treatmentPriceShortfall,
  type InvoiceLine,
} from '@/lib/invoice-lines'
import { dueDateOn, dueDateRefusal, dueDayFrom } from '@/lib/invoice-dates'
import { issueInvoice } from '@/lib/invoice-issue'
import { returnInvoiceStock } from '@/lib/invoice-stock'
import { DEFAULT_TIMEZONE, localDay } from '@/lib/appointment-time'

/**
 * Everything the invoice screen shows, read the same way by the GET and by
 * the answer to an edit.
 */
const INVOICE_DETAIL = {
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
      // A child's bill is paid by the parent (invoice review 4.7).
      guarantor: {
        select: { id: true, patientId: true, firstName: true, lastName: true, phone: true },
      },
    },
  },
  // The visit this bill is for, when it was raised from one (review 4.3).
  appointment: {
    select: {
      id: true,
      appointmentNo: true,
      startsAt: true,
      doctor: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      treatment: {
        select: {
          id: true,
          treatmentNo: true,
          toothNumbers: true,
          // The treatment's own price, so a line charged below it can be shown.
          cost: true,
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
      inventoryItem: { select: { id: true, name: true, sku: true, unit: true } },
    },
  },
  payments: {
    orderBy: {
      paymentDate: 'desc',
    },
    include: {
      // Shown as negative rows under their payment, so the history adds up to
      // "Paid" — which is net of them (review 3.3).
      refunds: {
        select: {
          id: true,
          refundNo: true,
          amount: true,
          refundMethod: true,
          refundedAt: true,
          reason: true,
        },
        orderBy: { refundedAt: 'asc' },
      },
    },
  },
  discountRequestedBy: { select: { id: true, name: true } },
  discountApprovedBy: { select: { id: true, name: true } },
} satisfies Prisma.InvoiceInclude

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
      include: INVOICE_DETAIL,
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // The clinic's letterhead for the printed invoice, carried here as the
    // payment GET carries it for the receipt: /api/settings/clinic needs
    // `settings:read`, which the desk printing the invoice does not hold. The
    // registration numbers are printed when the invoice charges tax.
    const clinic = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: {
        name: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        taxRegistrationNo: true,
        nationalTaxNo: true,
        taxLabel: true,
        // For the overdue label: "today" is the clinic's day, not the server's.
        timezone: true,
      },
    })

    return NextResponse.json({ ...invoice, clinic })
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
 *
 * DRAFT → PENDING is issuing, which is more than a status: see
 * lib/invoice-issue.ts.
 */
const MANUAL_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['OVERDUE', 'CANCELLED'],
  PARTIALLY_PAID: ['OVERDUE', 'CANCELLED'],
  // Only once nothing is held: an invoice for nothing (PAID at zero), or one
  // whose payments have all gone back (REFUNDED). `cancellationRefusal`
  // refuses either while money is still held — the same rule as DELETE.
  PAID: ['CANCELLED'],
  OVERDUE: ['CANCELLED'],
  CANCELLED: [],
  REFUNDED: ['CANCELLED'],
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

/**
 * PUT - Update an invoice, issue it, or cancel it.
 *
 * What may change depends on whether the invoice has been issued:
 *
 *  - A DRAFT is still being prepared: lines, discount, reason, due date, notes
 *    and terms may all change, and its figures are priced at the clinic's
 *    current tax rate.
 *  - An issued invoice is a document the patient has. Its lines and discount
 *    are fixed (invoice review 6.2) — the API used to let them be rewritten on
 *    a PENDING invoice while the edit screen said it could not be done. Only
 *    the notes, the terms and the due date (not before the issue day) change.
 *    To change what is owed: a payment, a refund, or cancel and raise again.
 *
 * Cancelling needs `billing:void`, as DELETE does (review 6.1). With only
 * `billing:write`, reception could cancel through this route what the screen's
 * Cancel would have refused them.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('billing:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    // `taxRate` is not read (finding 14): it is the clinic's, and is resolved
    // here for a draft and again when the invoice is issued.
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

    if (status === 'CANCELLED' && !holderCan(user, 'billing:void')) {
      return NextResponse.json(
        { error: 'Cancelling an invoice needs the billing:void permission' },
        { status: 403 }
      )
    }

    let parsedLines: InvoiceLine[] | undefined
    if (items !== undefined) {
      const parsed = parseInvoiceLines(items)
      if (parsed.error !== undefined) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      parsedLines = parsed.lines
    }

    const clinic = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { taxEnabled: true, taxRate: true, timezone: true },
    })
    const timezone = clinic?.timezone || DEFAULT_TIMEZONE
    const today = localDay(new Date(), timezone)

    const requestedDueDay = dueDayFrom(dueDate, timezone)
    if (requestedDueDay === null) {
      return NextResponse.json({ error: 'The due date is not a valid date' }, { status: 400 })
    }

    // The fields that make up what is owed — and the reason for a discount,
    // which belongs with it. Changeable on a draft only.
    const changesMoney =
      items !== undefined || discountType !== undefined || discountValue !== undefined
    const draftOnly = changesMoney || discountReason !== undefined

    const threshold = await getDiscountApprovalThreshold(hospitalId)

    const result = await prisma.$transaction(async (tx) => {
      // Held until the edit is written, so a payment cannot land between the
      // checks below and the lines being replaced.
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

      // A paid, refunded or cancelled invoice is a closed document. The one
      // thing left to do with a paid-at-zero or fully refunded one is cancel it.
      if (
        ['PAID', 'REFUNDED', 'CANCELLED'].includes(existingInvoice.status) &&
        !(status === 'CANCELLED' && existingInvoice.status !== 'CANCELLED')
      ) {
        throw new BillingRefusal(400, 'Cannot edit a paid, refunded or cancelled invoice')
      }

      // Lines and discount are a draft's (review 6.2). This also covers "no
      // edits once money is taken": a draft cannot take a payment.
      if (draftOnly && existingInvoice.status !== 'DRAFT') {
        throw new BillingRefusal(
          409,
          `${existingInvoice.invoiceNo} has been issued, so its lines and discount can no longer be changed — only its notes, terms and due date. To change what is owed, cancel it and raise a new one.`
        )
      }

      let updateData: Prisma.InvoiceUncheckedUpdateInput = {}
      if (notes !== undefined) updateData.notes = notes
      if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions
      if (discountReason !== undefined) {
        updateData.discountReason = discountReason ? String(discountReason).trim() || null : null
      }

      // Due date. An issued invoice keeps one, on or after the day it was
      // issued. A draft's is checked against today only when it changes — an
      // old draft re-saved with its old date is caught when it is issued.
      if (dueDate !== undefined) {
        const currentDay = existingInvoice.dueDate
          ? localDay(existingInvoice.dueDate, timezone)
          : undefined
        if (existingInvoice.status === 'DRAFT') {
          if (requestedDueDay && requestedDueDay !== currentDay) {
            const refusal = dueDateRefusal(requestedDueDay, today)
            if (refusal) throw new BillingRefusal(400, refusal)
          }
          updateData.dueDate = requestedDueDay ? dueDateOn(requestedDueDay) : null
        } else {
          if (!requestedDueDay) {
            throw new BillingRefusal(400, 'An issued invoice keeps a due date; choose one')
          }
          const issueDay = localDay(existingInvoice.issuedAt ?? existingInvoice.createdAt, timezone)
          const refusal = dueDateRefusal(requestedDueDay, issueDay)
          if (refusal) throw new BillingRefusal(400, refusal)
          if (requestedDueDay !== currentDay) updateData.dueDate = dueDateOn(requestedDueDay)
        }
      }

      let approvalStatus = existingInvoice.discountApprovalStatus
      let lineAmounts: number[] = []

      if (changesMoney) {
        const lines: Array<Omit<InvoiceLine, 'description'> & { description: string }> =
          parsedLines ??
          existingInvoice.items.map((item) => ({
            treatmentId: item.treatmentId,
            inventoryItemId: item.inventoryItemId,
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

        // A draft is priced at the clinic's rate today, the rate it will be
        // issued at, so the draft on screen is the bill that goes out.
        const taxRate = resolveTaxRate(clinic)
        const totals = calculateInvoiceTotals(lines, nextType, nextValue, taxRate)
        const discountRefusal = discountProblem(totals.subtotal, nextType, nextValue)
        if (discountRefusal) throw new BillingRefusal(400, discountRefusal)
        lineAmounts = totals.lines.map((line) => line.amount)

        if (parsedLines) {
          const treatmentIds = treatmentIdsOf(parsedLines)
          await lockTreatments(tx, treatmentIds)
          const treatmentRefusal = await treatmentBillingProblem(tx, {
            hospitalId,
            patientId: existingInvoice.patientId,
            treatmentIds,
            invoiceId: id,
          })
          if (treatmentRefusal) throw new BillingRefusal(409, treatmentRefusal)
          const productRefusal = await productLineProblem(tx, hospitalId, parsedLines)
          if (productRefusal) throw new BillingRefusal(400, productRefusal)
        }

        // FR-013 again. The approval belonged to the concession it was given
        // for — the discount plus any treatment priced below its price — and a
        // different one needs its own decision. Without this a draft approved
        // at 10% could be edited to 60% and issued (finding 18). Compared as a
        // share of the bill too, not just as an amount: Rs 2,000 approved off
        // Rs 20,000 stayed approved when the lines were cut to Rs 2,100
        // (review 6.2).
        const [before, after] = await Promise.all([
          treatmentPriceShortfall(tx, hospitalId, existingInvoice.items),
          treatmentPriceShortfall(tx, hospitalId, lines),
        ])
        const was = concessionOf(
          Number(existingInvoice.discountAmount ?? 0),
          before.total,
          Number(existingInvoice.subtotal ?? 0)
        )
        const now = concessionOf(totals.discountAmount, after.total, totals.subtotal)
        const redecide = now.amount !== was.amount || now.percent > was.percent + 0.005

        if (redecide) {
          if (discountNeedsApproval(now.amount, threshold)) {
            const reason =
              discountReason !== undefined ? discountReason : existingInvoice.discountReason
            if (!reason || String(reason).trim().length < 3) {
              throw new BillingRefusal(
                400,
                after.total > 0
                  ? `A concession of ${now.amount} (discount ${totals.discountAmount}, treatments below their price ${after.total}) is above the ${threshold} approval threshold and needs a reason`
                  : `A discount of ${now.amount} is above the ${threshold} approval threshold and needs a reason`
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
          taxRate,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          // A draft, so nothing has been paid.
          paidAmount: 0,
          balanceAmount: totals.totalAmount,
        }
      }

      let issuing = false
      let cancelling = false

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
          cancelling = true
          updateData.status = status
        } else if (existingInvoice.status === 'DRAFT' && status === 'PENDING') {
          issuing = true
        } else {
          updateData.status = status
        }
      }

      if (parsedLines) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } })
        await tx.invoiceItem.createMany({
          data: parsedLines.map((line, index) => ({
            invoiceId: id,
            treatmentId: line.treatmentId,
            inventoryItemId: line.inventoryItemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: lineAmounts[index],
            taxable: line.taxable,
          })),
        })
      }

      // Products it sold go back on the shelf. A draft never took any.
      if (cancelling && existingInvoice.status !== 'DRAFT') {
        await returnInvoiceStock(tx, {
          hospitalId,
          invoiceId: id,
          invoiceNo: existingInvoice.invoiceNo,
          userId: user?.id ?? null,
        })
      }

      if (issuing) {
        // The edit first, then the issue reads the invoice back — so what is
        // issued, priced and taken from stock is exactly what was just saved.
        if (Object.keys(updateData).length > 0) {
          await tx.invoice.update({ where: { id, hospitalId }, data: updateData })
        }
        await issueInvoice(tx, { invoiceId: id, hospitalId, userId: user?.id ?? null })
        const invoice = await tx.invoice.findUnique({
          where: { id, hospitalId },
          include: INVOICE_DETAIL,
        })
        if (!invoice) throw new BillingRefusal(404, 'Invoice not found')
        return { before: existingInvoice, invoice }
      }

      const invoice = await tx.invoice.update({
        where: { id, hospitalId },
        data: updateData,
        include: INVOICE_DETAIL,
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
 * that money is refunded (finding 17); one whose payments have all been
 * refunded (REFUNDED, nothing held) can be cancelled. Products it sold go back
 * into stock.
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

      // Products it sold go back on the shelf. A draft never took any.
      if (existingInvoice.status !== 'DRAFT') {
        await returnInvoiceStock(tx, {
          hospitalId,
          invoiceId: id,
          invoiceNo: existingInvoice.invoiceNo,
          userId: user?.id ?? null,
        })
      }

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
