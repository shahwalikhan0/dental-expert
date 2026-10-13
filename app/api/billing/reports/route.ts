import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { dateRangeFromDays, getDateRangeFromPreset } from '@/lib/billing-utils'
import { collectionTotals, dayKeyOf } from '@/lib/collections'
import { SETTLED_PAYMENT_STATUSES } from '@/lib/cashier'
import { clinicTimezone, localDay } from '@/lib/appointment-time'
import {
  billedAt,
  billedInvoiceWhere,
  daysPastDue,
  money,
  owedInvoiceWhere,
} from '@/lib/invoice-figures'
import { billedTotals, invoicedLines, outstandingTotals } from '@/lib/invoiced'
import { AGEING_BUCKETS, ageingBucket, type AgeingBucketKey } from '@/lib/ageing'

const DAY = /^\d{4}-\d{2}-\d{2}/

// GET - Generate billing reports
export async function GET(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('reports:financial')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const reportType = searchParams.get('type') || 'summary'
    const preset = searchParams.get('preset') || 'this_month'
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    // Every window and every day key on the clinic's calendar. The presets were
    // the server's midnight, a custom range started at UTC midnight and ended
    // at the server's 23:59, and the revenue report keyed days by UTC — three
    // different edges to one day on one screen.
    const timezone = await clinicTimezone(prisma, hospitalId)

    let startDate: Date
    let endDate: Date

    if (dateFrom && dateTo) {
      if (!DAY.test(dateFrom) || !DAY.test(dateTo)) {
        return NextResponse.json(
          { error: 'dateFrom and dateTo must be dates such as 2026-10-14.' },
          { status: 400 }
        )
      }
      const range = dateRangeFromDays(dateFrom.slice(0, 10), dateTo.slice(0, 10), timezone)
      startDate = range.startDate
      endDate = range.endDate
    } else {
      const range = getDateRangeFromPreset(preset, timezone)
      startDate = range.startDate
      endDate = range.endDate
    }

    switch (reportType) {
      case 'summary':
        return await getSummaryReport(startDate, endDate, hospitalId)
      case 'revenue':
        return await getRevenueReport(startDate, endDate, hospitalId, timezone)
      case 'payments':
        return await getPaymentsReport(startDate, endDate, hospitalId)
      case 'outstanding':
        return await getOutstandingReport(hospitalId, timezone)
      case 'procedure_revenue':
        return await getProcedureRevenueReport(startDate, endDate, hospitalId)
      case 'doctor_revenue':
        return await getDoctorRevenueReport(startDate, endDate, hospitalId)
      case 'daily_collection':
        return await getDailyCollectionReport(startDate, endDate, hospitalId, timezone)
      default:
        return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
    }
  } catch (error) {
    console.error('Error generating report:', error)
    return NextResponse.json(
      {
        error: 'Failed to generate report',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * Summary: Billed, Collected and Outstanding, by the definitions in
 * lib/invoice-figures.ts.
 *
 * Total Billed used to be every invoice *created* in the window, drafts and
 * cancelled ones included — 16,500 for four invoices of which 13,000 had
 * been billed (review §3.2) — and the collection rate on the overview divided
 * cash by that.
 */
async function getSummaryReport(startDate: Date, endDate: Date, hospitalId: string) {
  const window = { gte: startDate, lte: endDate }

  const [billed, collected, outstanding, invoiceStatusBreakdown] = await Promise.all([
    billedTotals(hospitalId, window),
    // What was actually taken, net of anything handed back — see lib/collections.ts.
    collectionTotals(hospitalId, window),
    // Owed now, whenever it was billed.
    outstandingTotals(hospitalId),
    // Every invoice of the period by status, drafts included — they are a
    // status like any other here. Issued invoices are dated as Billed dates
    // them, so the issued rows add up to Total Billed; a draft has no issue
    // date and is placed by when it was started.
    prisma.invoice.groupBy({
      by: ['status'],
      where: {
        hospitalId,
        OR: [{ issuedAt: window }, { issuedAt: null, createdAt: window }],
      },
      _sum: { totalAmount: true },
      _count: true,
    }),
  ])

  return NextResponse.json({
    period: { startDate, endDate },
    summary: {
      totalBilled: billed.billed,
      totalDiscounts: billed.discounts,
      invoiceCount: billed.invoiceCount,
      totalCollected: collected.net,
      totalReceived: collected.received,
      totalRefunded: collected.refunded,
      paymentCount: collected.paymentCount,
      refundCount: collected.refundCount,
      totalOutstanding: outstanding.outstanding,
      outstandingInvoices: outstanding.invoiceCount,
    },
    breakdowns: {
      byPaymentMethod: collected.byMethod.map((row) => ({
        method: row.method,
        amount: row.net,
        received: row.received,
        refunded: row.refunded,
        count: row.count,
      })),
      byInvoiceStatus: invoiceStatusBreakdown.map((item) => ({
        status: item.status,
        amount: item._sum.totalAmount || 0,
        count: item._count,
      })),
    },
  })
}

/**
 * Revenue by clinic day: what was billed and what was collected.
 *
 * "Collected" here was `invoice.paidAmount` of the invoices *raised* that day
 * — a cohort figure under the name of the cash figure, so this report and the
 * summary above it disagreed on both lines. It is the cash collected that day
 * now, net of refunds, the same as the summary and the daily collection sheet.
 * Billed excludes drafts as well as cancelled invoices, and is dated by issue.
 */
async function getRevenueReport(
  startDate: Date,
  endDate: Date,
  hospitalId: string,
  timezone: string
) {
  const window = { gte: startDate, lte: endDate }

  const [invoices, payments, refunds] = await Promise.all([
    prisma.invoice.findMany({
      where: { hospitalId, ...billedInvoiceWhere(window) },
      select: {
        createdAt: true,
        issuedAt: true,
        totalAmount: true,
        discountAmount: true,
        taxAmount: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        hospitalId,
        paymentDate: window,
        status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
      },
      select: { paymentDate: true, amount: true },
    }),
    prisma.refund.findMany({
      where: { hospitalId, refundedAt: window },
      select: { refundedAt: true, amount: true },
    }),
  ])

  interface Day {
    date: string
    billed: number
    collected: number
    discount: number
    tax: number
    count: number
  }
  const dailyRevenue: Record<string, Day> = {}
  const dayOf = (at: Date): Day => {
    const key = dayKeyOf(at, timezone)
    dailyRevenue[key] ??= { date: key, billed: 0, collected: 0, discount: 0, tax: 0, count: 0 }
    return dailyRevenue[key]
  }

  for (const invoice of invoices) {
    const day = dayOf(billedAt(invoice))
    day.billed = money(day.billed + money(invoice.totalAmount))
    day.discount = money(day.discount + money(invoice.discountAmount))
    day.tax = money(day.tax + money(invoice.taxAmount))
    day.count += 1
  }
  for (const payment of payments) {
    const day = dayOf(payment.paymentDate)
    day.collected = money(day.collected + money(payment.amount))
  }
  for (const refund of refunds) {
    const day = dayOf(refund.refundedAt)
    day.collected = money(day.collected - money(refund.amount))
  }

  const days = Object.values(dailyRevenue).sort((a, b) => a.date.localeCompare(b.date))

  const totals = {
    totalBilled: money(days.reduce((sum, day) => sum + day.billed, 0)),
    totalCollected: money(days.reduce((sum, day) => sum + day.collected, 0)),
    totalDiscount: money(days.reduce((sum, day) => sum + day.discount, 0)),
    totalTax: money(days.reduce((sum, day) => sum + day.tax, 0)),
    invoiceCount: invoices.length,
  }

  return NextResponse.json({
    period: { startDate, endDate },
    dailyData: days,
    totals,
  })
}

// Payments Report
async function getPaymentsReport(startDate: Date, endDate: Date, hospitalId: string) {
  const payments = await prisma.payment.findMany({
    where: {
      hospitalId,
      paymentDate: {
        gte: startDate,
        lte: endDate,
      },
      // A payment that has been refunded in part or in full is still a payment
      // that was taken. Filtering it out here is what made a refunded day read
      // as a day with no takings at all.
      status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
    },
    include: {
      invoice: {
        select: {
          invoiceNo: true,
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
    orderBy: { paymentDate: 'desc' },
  })

  const collected = await collectionTotals(hospitalId, { gte: startDate, lte: endDate })

  return NextResponse.json({
    period: { startDate, endDate },
    payments,
    byMethod: collected.byMethod.map((row) => ({
      method: row.method,
      total: row.net,
      received: row.received,
      refunded: row.refunded,
      count: row.count,
    })),
    totals: {
      totalAmount: collected.net,
      totalReceived: collected.received,
      totalRefunded: collected.refunded,
      totalCount: collected.paymentCount,
      refundCount: collected.refundCount,
    },
  })
}

/**
 * Outstanding, aged.
 *
 * Owed invoices by the shared rule — a refunded invoice is not a debt, an
 * OVERDUE one is — in the buckets every ageing screen uses, counted in days
 * past the due date on the clinic's calendar. This screen and the overview's
 * Claims Aging called an invoice raised yesterday with no due date "1–30 days
 * overdue" while Receivables called it current (bug report item 5).
 */
async function getOutstandingReport(hospitalId: string, timezone: string) {
  const outstandingInvoices = await prisma.invoice.findMany({
    where: { hospitalId, ...owedInvoiceWhere() },
    include: {
      patient: {
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
    },
    orderBy: [{ dueDate: 'asc' }, { balanceAmount: 'desc' }],
  })

  const todayYmd = localDay(new Date(), timezone)

  const aging = Object.fromEntries(
    AGEING_BUCKETS.map((bucket) => [bucket.key, { amount: 0, count: 0 }])
  ) as Record<AgeingBucketKey, { amount: number; count: number }>

  const invoices = outstandingInvoices.map((invoice) => {
    const daysLate = daysPastDue(invoice, todayYmd, timezone)
    const bucket = aging[ageingBucket(daysLate)]
    bucket.amount = money(bucket.amount + money(invoice.balanceAmount))
    bucket.count += 1
    return { ...invoice, daysOverdue: Math.max(0, daysLate) }
  })

  return NextResponse.json({
    invoices,
    aging,
    totals: {
      totalOutstanding: money(invoices.reduce((sum, inv) => sum + money(inv.balanceAmount), 0)),
      invoiceCount: invoices.length,
    },
  })
}

/**
 * Invoiced by procedure: invoice lines, less their share of the discount, on
 * invoices issued in the window and neither draft nor cancelled.
 *
 * This was Σ `Treatment.cost` of treatments started in the window — list
 * price, billed or not, discount ignored. The JSON keeps its `totalRevenue`
 * names for the screens that read it; what they hold is the invoiced amount,
 * before tax. Lines that bill no treatment (a product, a manual charge) have
 * no procedure and are reported apart as `otherInvoiced`.
 */
async function getProcedureRevenueReport(startDate: Date, endDate: Date, hospitalId: string) {
  const lines = await invoicedLines(hospitalId, { gte: startDate, lte: endDate })

  const byProcedure: Record<
    string,
    {
      procedureId: string
      code: string
      name: string
      category: string
      totalRevenue: number
      count: number
      avgRevenue: number
    }
  > = {}
  let otherInvoiced = 0

  for (const line of lines) {
    if (!line.procedure) {
      otherInvoiced = money(otherInvoiced + line.amount)
      continue
    }
    const proc = (byProcedure[line.procedure.id] ??= {
      procedureId: line.procedure.id,
      code: line.procedure.code,
      name: line.procedure.name,
      category: line.procedure.category,
      totalRevenue: 0,
      count: 0,
      avgRevenue: 0,
    })
    proc.totalRevenue = money(proc.totalRevenue + line.amount)
    proc.count += 1
  }

  Object.values(byProcedure).forEach((proc) => {
    proc.avgRevenue = proc.count > 0 ? money(proc.totalRevenue / proc.count) : 0
  })

  const byCategory: Record<string, { category: string; totalRevenue: number; count: number }> = {}
  Object.values(byProcedure).forEach((proc) => {
    const cat = (byCategory[proc.category] ??= {
      category: proc.category,
      totalRevenue: 0,
      count: 0,
    })
    cat.totalRevenue = money(cat.totalRevenue + proc.totalRevenue)
    cat.count += proc.count
  })

  const proceduresList = Object.values(byProcedure).sort((a, b) => b.totalRevenue - a.totalRevenue)

  return NextResponse.json({
    period: { startDate, endDate },
    byProcedure: proceduresList,
    byCategory: Object.values(byCategory).sort((a, b) => b.totalRevenue - a.totalRevenue),
    totals: {
      totalRevenue: money(proceduresList.reduce((sum, p) => sum + p.totalRevenue, 0)),
      totalTreatments: proceduresList.reduce((sum, p) => sum + p.count, 0),
      otherInvoiced,
    },
  })
}

/**
 * Invoiced by doctor: the same lines as by procedure, attributed to the
 * doctor on the treatment each line bills. `treatmentCount` is how many
 * treatments of theirs were billed in the window.
 */
async function getDoctorRevenueReport(startDate: Date, endDate: Date, hospitalId: string) {
  const lines = await invoicedLines(hospitalId, { gte: startDate, lte: endDate })

  const byDoctor: Record<
    string,
    {
      doctorId: string
      name: string
      specialization: string | null
      totalRevenue: number
      treatmentCount: number
      avgPerTreatment: number
      procedures: Record<string, number>
    }
  > = {}
  let unattributed = 0

  for (const line of lines) {
    if (!line.doctor) {
      unattributed = money(unattributed + line.amount)
      continue
    }
    const doc = (byDoctor[line.doctor.id] ??= {
      doctorId: line.doctor.id,
      name: `${line.doctor.firstName} ${line.doctor.lastName}`,
      specialization: line.doctor.specialization,
      totalRevenue: 0,
      treatmentCount: 0,
      avgPerTreatment: 0,
      procedures: {},
    })
    doc.totalRevenue = money(doc.totalRevenue + line.amount)
    doc.treatmentCount += 1
    if (line.procedure) {
      doc.procedures[line.procedure.name] = (doc.procedures[line.procedure.name] || 0) + 1
    }
  }

  const doctorsList = Object.values(byDoctor)
    .map(({ procedures, ...doc }) => ({
      ...doc,
      avgPerTreatment: doc.treatmentCount > 0 ? money(doc.totalRevenue / doc.treatmentCount) : 0,
      // Top 5 procedures
      topProcedures: Object.entries(procedures)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)

  return NextResponse.json({
    period: { startDate, endDate },
    byDoctor: doctorsList,
    totals: {
      totalRevenue: money(doctorsList.reduce((sum, d) => sum + d.totalRevenue, 0)),
      totalTreatments: doctorsList.reduce((sum, d) => sum + d.treatmentCount, 0),
      doctorCount: doctorsList.length,
      unattributed,
    },
  })
}

// Daily Collection Report
async function getDailyCollectionReport(
  startDate: Date,
  endDate: Date,
  hospitalId: string,
  timezone: string
) {
  const window = { gte: startDate, lte: endDate }

  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: {
        hospitalId,
        paymentDate: window,
        status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
      },
      include: {
        invoice: {
          select: {
            invoiceNo: true,
            patient: {
              select: { patientId: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { paymentDate: 'asc' },
    }),
    prisma.refund.findMany({
      where: { hospitalId, refundedAt: window },
      include: {
        payment: {
          select: {
            paymentNo: true,
            invoice: {
              select: {
                invoiceNo: true,
                patient: {
                  select: { patientId: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
      orderBy: { refundedAt: 'asc' },
    }),
  ])

  interface Day {
    date: string
    cash: number
    card: number
    bankTransfer: number
    cheque: number
    wallet: number
    online: number
    received: number
    refunded: number
    total: number
    count: number
    payments: {
      paymentNo: string
      amount: number
      method: string
      invoiceNo: string
      patient: string
      refund?: boolean
      reason?: string
    }[]
  }

  const dailyCollection: Record<string, Day> = {}

  // A day is the clinic's day, not the host's. Grouping on the UTC calendar put
  // an evening payment in Karachi onto the following day's sheet, which is the
  // sheet the cashier had already closed.
  const dayOf = (at: Date): Day => {
    const key = dayKeyOf(at, timezone)
    dailyCollection[key] ??= {
      date: key,
      cash: 0,
      card: 0,
      bankTransfer: 0,
      cheque: 0,
      wallet: 0,
      online: 0,
      received: 0,
      refunded: 0,
      total: 0,
      count: 0,
      payments: [],
    }
    return dailyCollection[key]
  }

  const METHOD_COLUMN = {
    CASH: 'cash',
    CARD: 'card',
    BANK_TRANSFER: 'bankTransfer',
    CHEQUE: 'cheque',
    WALLET: 'wallet',
    ONLINE: 'online',
  } as const

  const patientName = (p: { firstName: string; lastName: string } | null | undefined) =>
    p ? `${p.firstName} ${p.lastName}` : 'Unknown'

  for (const payment of payments) {
    const day = dayOf(payment.paymentDate)
    const amount = Number(payment.amount)
    const column = METHOD_COLUMN[payment.paymentMethod]
    if (column) day[column] += amount
    day.received += amount
    day.total += amount
    day.count += 1
    day.payments.push({
      paymentNo: payment.paymentNo,
      amount,
      method: payment.paymentMethod,
      invoiceNo: payment.invoice.invoiceNo,
      patient: patientName(payment.invoice.patient),
    })
  }

  // Refunds land on the day the money left, under the method it left by, and
  // reduce that method's column. Anything else and the sheet will not agree
  // with the drawer.
  for (const refund of refunds) {
    const day = dayOf(refund.refundedAt)
    const amount = Number(refund.amount)
    const column = METHOD_COLUMN[refund.refundMethod]
    if (column) day[column] -= amount
    day.refunded += amount
    day.total -= amount
    day.payments.push({
      paymentNo: refund.refundNo,
      amount: -amount,
      method: refund.refundMethod,
      invoiceNo: refund.payment.invoice.invoiceNo,
      patient: patientName(refund.payment.invoice.patient),
      refund: true,
      reason: refund.reason,
    })
  }

  const days = Object.values(dailyCollection).sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    period: { startDate, endDate },
    dailyData: days,
    totals: {
      totalCollection: days.reduce((sum, day) => sum + day.total, 0),
      totalReceived: days.reduce((sum, day) => sum + day.received, 0),
      totalRefunded: days.reduce((sum, day) => sum + day.refunded, 0),
      totalPayments: payments.length,
      totalRefunds: refunds.length,
      daysWithCollection: days.length,
    },
  })
}
