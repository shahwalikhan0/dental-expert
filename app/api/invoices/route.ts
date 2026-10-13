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
import { discountNeedsApproval, getDiscountApprovalThreshold } from '@/lib/cashier'
import { holderCan } from '@/lib/rbac'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import {
  BillingRefusal,
  billingRefusalResponse,
  lockTreatments,
  treatmentBillingProblem,
} from '@/lib/invoice-settlement'

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

    // Build where clause
    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { invoiceNo: { contains: search, mode: 'insensitive' } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { patientId: { contains: search, mode: 'insensitive' } } },
        { patient: { phone: { contains: search, mode: 'insensitive' } } },
      ]
    }

    if (status) {
      if (!isEnumMember(InvoiceStatus, status)) return enumRefusal('status', status, InvoiceStatus)
      where.status = status
    }

    if (patientId) {
      where.patientId = patientId
    }

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom)
      }
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        where.createdAt.lte = endDate
      }
    }

    if (overdue) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      where.dueDate = { lt: today }
      where.status = { in: ['PENDING', 'PARTIALLY_PAID'] }
    }

    // If filtering by payment method, we need to join with payments
    if (paymentMethod) {
      if (!isEnumMember(PaymentMethod, paymentMethod)) {
        return enumRefusal('paymentMethod', paymentMethod, PaymentMethod)
      }
      where.payments = {
        some: {
          paymentMethod: paymentMethod,
        },
      }
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

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }

    if (!isEnumMember(DiscountType, discountType)) {
      return enumRefusal('discountType', discountType, DiscountType)
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

    // The clinic's rate, stamped onto the invoice below so that a later change
    // to the clinic's rate cannot alter an invoice already issued.
    const clinic = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { taxEnabled: true, taxRate: true },
    })
    const taxRate = resolveTaxRate(clinic)

    // Validate items
    for (const item of items) {
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

    const subtotal = items.reduce(
      (sum: number, item: any) => sum + Number(item.quantity) * Number(item.unitPrice),
      0
    )
    const discountRefusal = discountProblem(subtotal, discountType, discountValue)
    if (discountRefusal) {
      return NextResponse.json({ error: discountRefusal }, { status: 400 })
    }

    // Calculate totals
    const calculatedTotals = calculateInvoiceTotals(
      items.map((item: any) => ({
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxable: item.taxable !== false,
      })),
      discountType as DiscountType,
      Number(discountValue),
      taxRate
    )

    // FR-013 — "Require reason and approval for discounts above a configurable
    // threshold." A discount over the threshold needs a reason, and someone
    // holding `billing:discount` to stand behind it. Reception raises invoices
    // but does not hold that capability, so their request is recorded PENDING
    // and a manager decides; the invoice cannot leave DRAFT until they do.
    const discountAmount = Number(calculatedTotals.discountAmount)
    const threshold = await getDiscountApprovalThreshold(hospitalId)
    const needsApproval = discountNeedsApproval(discountAmount, threshold)

    let discountApprovalStatus: DiscountApprovalStatus = 'NOT_REQUIRED'
    let discountApprovedById: string | null = null
    let discountRequestedById: string | null = null
    let discountDecidedAt: Date | null = null

    if (needsApproval) {
      if (!discountReason || String(discountReason).trim().length < 3) {
        return NextResponse.json(
          {
            error: `A discount of ${discountAmount} is above the ${threshold} approval threshold and needs a reason`,
          },
          { status: 400 }
        )
      }

      discountRequestedById = user?.id ?? null

      if (holderCan(user, 'billing:discount')) {
        discountApprovalStatus = 'APPROVED'
        discountApprovedById = user?.id ?? null
        discountDecidedAt = new Date()
      } else {
        discountApprovalStatus = 'PENDING'
      }
    }

    // Calculate due date
    const invoiceDate = new Date()
    let calculatedDueDate: Date | null = null
    if (dueDate) {
      calculatedDueDate = new Date(dueDate)
      if (Number.isNaN(calculatedDueDate.getTime())) {
        return NextResponse.json({ error: 'The due date is not a valid date' }, { status: 400 })
      }
    } else if (Number(paymentTermDays) > 0) {
      calculatedDueDate = new Date(invoiceDate)
      calculatedDueDate.setDate(calculatedDueDate.getDate() + Number(paymentTermDays))
    }

    const treatmentIds: string[] = items
      .map((item: any) => item.treatmentId)
      .filter((treatmentId: unknown): treatmentId is string => !!treatmentId)

    // One transaction from the treatment check to the insert. The treatments
    // are locked so two desks cannot both bill the same visit (finding 13),
    // and the invoice number is drawn inside it, so a request refused here
    // rolls its number back rather than leaving a gap (finding 68).
    const invoice = await prisma.$transaction(async (tx) => {
      await lockTreatments(tx, treatmentIds)
      const treatmentRefusal = await treatmentBillingProblem(tx, {
        hospitalId,
        patientId,
        treatmentIds,
      })
      if (treatmentRefusal) throw new BillingRefusal(409, treatmentRefusal)

      const invoiceNo = await generateInvoiceNo(tx, hospitalId)

      return tx.invoice.create({
        data: {
          hospitalId,
          invoiceNo,
          patientId,
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
          discountReason: discountReason || null,
          discountApprovalStatus,
          discountRequestedById,
          discountApprovedById,
          discountDecidedAt,
          notes,
          termsAndConditions,
          items: {
            create: items.map((item: any) => ({
              treatmentId: item.treatmentId || null,
              description: item.description,
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              amount: Number(item.quantity) * Number(item.unitPrice),
              taxable: item.taxable !== false,
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
            },
          },
        },
      })
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
        subtotal: calculatedTotals.subtotal,
        discountType,
        discountValue: Number(discountValue),
        discountAmount: calculatedTotals.discountAmount,
        discountApprovalStatus,
        taxRate,
        totalAmount: calculatedTotals.totalAmount,
        items: items.length,
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
