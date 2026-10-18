import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import {
  generateInvoiceNo,
  calculateInvoiceTotals,
  discountProblem,
  resolveTaxRate,
} from '@/lib/billing-utils'
import { DiscountApprovalStatus, DiscountType, InvoiceStatus, PaymentMethod } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { overdueInvoiceWhere } from '@/lib/invoice-figures'
import { clinicTimezone, dayRangeIn } from '@/lib/appointment-time'
import { discountNeedsApproval, getDiscountApprovalThreshold } from '@/lib/cashier'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import {
  BillingRefusal,
  billingRefusalResponse,
  lockTreatments,
  treatmentBillingProblem,
} from '@/lib/invoice-settlement'
import {
  concessionOf,
  parseInvoiceLines,
  productLineProblem,
  treatmentIdsOf,
  treatmentPriceShortfall,
} from '@/lib/invoice-lines'
import { addDays, dueDateOn, dueDateRefusal, dueDayFrom } from '@/lib/invoice-dates'
import { DEFAULT_TIMEZONE, localDay } from '@/lib/appointment-time'

// GET - List invoices with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const patientId = searchParams.get('patientId') || ''
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const paymentMethod = searchParams.get('paymentMethod') || ''
    const overdue = searchParams.get('overdue') === 'true'

    const skip = (page - 1) * limit

    // Every filter is one more condition ANDed onto the rest. The overdue
    // filter used to *replace* `where.status`, so "Overdue only" with a
    // status chosen silently ignored the status.
    const conditions: Prisma.InvoiceWhereInput[] = []
    const where: Prisma.InvoiceWhereInput = { hospitalId, AND: conditions }

    // The clinic's calendar, for the date filters and for "overdue".
    const timezone = await clinicTimezone(prisma, hospitalId)
    const today = localDay(new Date(), timezone)

    if (search) {
      conditions.push({
        OR: [
          { invoiceNo: { contains: search, mode: 'insensitive' } },
          { patient: { firstName: { contains: search, mode: 'insensitive' } } },
          { patient: { lastName: { contains: search, mode: 'insensitive' } } },
          { patient: { patientId: { contains: search, mode: 'insensitive' } } },
          { patient: { phone: { contains: search, mode: 'insensitive' } } },
        ],
      })
    }

    if (status) {
      if (!isEnumMember(InvoiceStatus, status)) return enumRefusal('status', status, InvoiceStatus)
      conditions.push({ status })
    }

    if (patientId) {
      conditions.push({ patientId })
    }

    /**
     * From/To are clinic days, matched against the day an invoice was
     * *issued* — the date Billed figures use, so filtering October here lists
     * the invoices behind October's Billed total. A draft has no issue date
     * yet and is found by the day it was started. This compared `createdAt`
     * with UTC midnight at one end and the server's 23:59 at the other.
     */
    if (dateFrom || dateTo) {
      for (const [name, value] of [
        ['dateFrom', dateFrom],
        ['dateTo', dateTo],
      ] as const) {
        if (value && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
          return NextResponse.json(
            { error: `${name} must be a date such as 2026-10-14.` },
            { status: 400 }
          )
        }
      }
      const window: { gte?: Date; lt?: Date } = {}
      if (dateFrom) window.gte = dayRangeIn(dateFrom.slice(0, 10), timezone).gte
      if (dateTo) window.lt = dayRangeIn(dateTo.slice(0, 10), timezone).lt
      conditions.push({
        OR: [{ issuedAt: window }, { issuedAt: null, createdAt: window }],
      })
    }

    // Overdue by the one rule (lib/invoice-figures.ts): still owed, and due
    // before today on the clinic's calendar. Status OVERDUE is owed like
    // PENDING; this used to drop it, and to miss every invoice without a due
    // date.
    if (overdue) {
      conditions.push(overdueInvoiceWhere(today, timezone))
    }

    // If filtering by payment method, we need to join with payments
    if (paymentMethod) {
      if (!isEnumMember(PaymentMethod, paymentMethod)) {
        return enumRefusal('paymentMethod', paymentMethod, PaymentMethod)
      }
      conditions.push({ payments: { some: { paymentMethod } } })
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
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
            select: {
              id: true,
              paymentNo: true,
              amount: true,
              paymentMethod: true,
              paymentDate: true,
              status: true,
            },
            orderBy: {
              paymentDate: 'desc',
            },
          },
          _count: {
            select: {
              payments: true,
              items: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ])

    return NextResponse.json({
      invoices,
      // So the list can say "3 days overdue" by the same rule and calendar as
      // the filter, rather than by the browser's clock.
      today,
      timezone,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching invoices:', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
}

// POST - Create new invoice
export async function POST(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('billing:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    // `taxRate` and `status` are deliberately not read from the body (bug
    // report 12 Oct, findings 14 and 15). A negative rate cut any bill without
    // reaching discount approval, and an invoice could be created PAID with
    // nothing paid. The rate is the clinic's; a new invoice is a DRAFT, and
    // issuing it is the PUT that checks the discount approval on the way.
    const {
      patientId,
      appointmentId,
      items,
      discountType = 'FIXED',
      discountValue = 0,
      discountReason,
      dueDate,
      notes,
      termsAndConditions,
      paymentTermDays = 0,
    } = body

    // Validate required fields
    if (!patientId) {
      return NextResponse.json({ error: 'Patient is required' }, { status: 400 })
    }

    const parsed = parseInvoiceLines(items)
    if (parsed.error !== undefined) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const lines = parsed.lines

    if (!isEnumMember(DiscountType, discountType)) {
      return enumRefusal('discountType', discountType, DiscountType)
    }

    const termDays = Number(paymentTermDays ?? 0)
    if (!Number.isInteger(termDays) || termDays < 0) {
      return NextResponse.json(
        { error: 'Payment terms must be a whole number of days' },
        { status: 400 }
      )
    }

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId, hospitalId },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }
    // Finding 22: a deactivated patient was still invoiced (201). Their record
    // is closed; a bill raised against it lands on nobody's list.
    if (patient.isActive === false) {
      return NextResponse.json(
        { error: 'This patient is inactive. Reactivate them before raising an invoice.' },
        { status: 409 }
      )
    }

    // The visit this bill is for (invoice review 4.3). Same clinic and the
    // same patient: an appointment id is a link a screen passes along, and a
    // stale one must not tie one patient's bill to another patient's visit.
    if (appointmentId) {
      const appointment = await prisma.appointment.findFirst({
        where: { id: String(appointmentId), hospitalId },
        select: { patientId: true },
      })
      if (!appointment) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
      }
      if (appointment.patientId !== patientId) {
        return NextResponse.json(
          {
            error: 'That appointment is another patient’s, so it cannot be linked to this invoice',
          },
          { status: 409 }
        )
      }
    }

    // The clinic's rate, for the draft's figures. It is resolved again when
    // the invoice is issued (lib/invoice-issue.ts), so a draft started before
    // a change of rate is issued at the rate in force on the day.
    const clinic = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { taxEnabled: true, taxRate: true, timezone: true },
    })
    const taxRate = resolveTaxRate(clinic)
    const timezone = clinic?.timezone || DEFAULT_TIMEZONE
    const today = localDay(new Date(), timezone)

    const calculatedTotals = calculateInvoiceTotals(
      lines,
      discountType as DiscountType,
      Number(discountValue),
      taxRate
    )
    const discountRefusal = discountProblem(calculatedTotals.subtotal, discountType, discountValue)
    if (discountRefusal) {
      return NextResponse.json({ error: discountRefusal }, { status: 400 })
    }

    // Due date: one typed, or the terms counted from today. "Due on receipt"
    // (no terms) is left blank on the draft and set to the day it is issued.
    // A date before today is refused: an invoice cannot fall due before it is
    // raised (invoice review 6.6).
    let calculatedDueDate: Date | null = null
    const typedDueDay = dueDayFrom(dueDate, timezone)
    if (typedDueDay === null) {
      return NextResponse.json({ error: 'The due date is not a valid date' }, { status: 400 })
    }
    if (typedDueDay) {
      const refusal = dueDateRefusal(typedDueDay, today)
      if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })
      calculatedDueDate = dueDateOn(typedDueDay)
    } else if (termDays > 0) {
      calculatedDueDate = dueDateOn(addDays(today, termDays))
    }

    const productRefusal = await productLineProblem(prisma, hospitalId, lines)
    if (productRefusal) {
      return NextResponse.json({ error: productRefusal }, { status: 400 })
    }

    const threshold = await getDiscountApprovalThreshold(hospitalId)
    const treatmentIds = treatmentIdsOf(lines)

    // One transaction from the treatment check to the insert. The treatments
    // are locked so two desks cannot both bill the same visit (finding 13),
    // and the invoice number is drawn inside it, so a request refused here
    // rolls its number back rather than leaving a gap (finding 68).
    const { invoice, approval, shortfall } = await prisma.$transaction(async (tx) => {
      await lockTreatments(tx, treatmentIds)
      const treatmentRefusal = await treatmentBillingProblem(tx, {
        hospitalId,
        patientId,
        treatmentIds,
      })
      if (treatmentRefusal) throw new BillingRefusal(409, treatmentRefusal)

      // FR-013 — "Require reason and approval for discounts above a
      // configurable threshold." What counts is everything the patient is let
      // off: the discount, plus any treatment priced below its own price
      // (invoice review 4.1). Over the threshold it needs a reason, and
      // someone holding `billing:discount` to stand behind it — someone other
      // than whoever raised it. It is recorded PENDING whoever asks, a manager
      // or the administrator included (finding 10, 16 Oct), and the invoice
      // cannot leave DRAFT until another approver decides through the
      // discount-approval route.
      const shortfall = await treatmentPriceShortfall(tx, hospitalId, lines)
      const concession = concessionOf(
        calculatedTotals.discountAmount,
        shortfall.total,
        calculatedTotals.subtotal
      )

      const approval: {
        discountApprovalStatus: DiscountApprovalStatus
        discountRequestedById: string | null
        discountApprovedById: string | null
        discountDecidedAt: Date | null
      } = {
        discountApprovalStatus: 'NOT_REQUIRED',
        discountRequestedById: null,
        discountApprovedById: null,
        discountDecidedAt: null,
      }

      if (discountNeedsApproval(concession.amount, threshold)) {
        if (!discountReason || String(discountReason).trim().length < 3) {
          throw new BillingRefusal(
            400,
            shortfall.total > 0
              ? `A concession of ${concession.amount} (discount ${calculatedTotals.discountAmount}, treatments below their price ${shortfall.total}) is above the ${threshold} approval threshold and needs a reason`
              : `A discount of ${concession.amount} is above the ${threshold} approval threshold and needs a reason`
          )
        }

        approval.discountRequestedById = user?.id ?? null
        approval.discountApprovalStatus = 'PENDING'
      }

      const invoiceNo = await generateInvoiceNo(tx, hospitalId)

      const invoice = await tx.invoice.create({
        data: {
          hospitalId,
          invoiceNo,
          patientId,
          appointmentId: appointmentId ? String(appointmentId) : null,
          dueDate: calculatedDueDate,
          subtotal: calculatedTotals.subtotal,
          discountType: discountType as DiscountType,
          discountValue: Number(discountValue),
          discountAmount: calculatedTotals.discountAmount,
          taxableAmount: calculatedTotals.taxableAmount,
          taxRate,
          taxAmount: calculatedTotals.taxAmount,
          totalAmount: calculatedTotals.totalAmount,
          paidAmount: 0,
          balanceAmount: calculatedTotals.totalAmount,
          status: 'DRAFT',
          discountReason: discountReason ? String(discountReason).trim() : null,
          ...approval,
          notes,
          termsAndConditions,
          items: {
            // The amount from the same arithmetic as the totals, so the lines
            // add up to the subtotal to the paisa.
            create: lines.map((line, index) => ({
              treatmentId: line.treatmentId,
              inventoryItemId: line.inventoryItemId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: calculatedTotals.lines[index].amount,
              taxable: line.taxable,
            })),
          },
        },
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
              inventoryItem: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      })
      return { invoice, approval, shortfall }
    })

    await recordAudit({
      hospitalId,
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.INVOICE_CREATED,
      entityType: 'Invoice',
      entityId: invoice.id,
      newValues: {
        invoiceNo: invoice.invoiceNo,
        patientId,
        appointmentId: appointmentId || null,
        subtotal: calculatedTotals.subtotal,
        discountType,
        discountValue: Number(discountValue),
        discountAmount: calculatedTotals.discountAmount,
        // Treatments billed below their price: the record that a concession
        // was given on the price rather than through the discount field.
        ...(shortfall.total > 0
          ? {
              priceShortfall: shortfall.total,
              belowPrice: shortfall.lines.map(
                (l) => `${l.treatmentNo}: ${l.charged} of ${l.price}`
              ),
            }
          : {}),
        discountApprovalStatus: approval.discountApprovalStatus,
        taxRate,
        totalAmount: calculatedTotals.totalAmount,
        items: lines.length,
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    const known = billingRefusalResponse(error) ?? knownErrorResponse(error)
    if (known) return known
    console.error('Error creating invoice:', error)
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }
}
