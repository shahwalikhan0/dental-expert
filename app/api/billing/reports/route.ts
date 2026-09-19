import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { getDateRangeFromPreset } from '@/lib/billing-utils'
import { collectionTotals, dayKeyOf } from '@/lib/collections'
import { SETTLED_PAYMENT_STATUSES } from '@/lib/cashier'
import { clinicTimezone } from '@/lib/appointment-time'

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

    // Determine date range
    let startDate: Date
    let endDate: Date

    if (dateFrom && dateTo) {
      startDate = new Date(dateFrom)
      endDate = new Date(dateTo)
      endDate.setHours(23, 59, 59, 999)
    } else {
      const range = getDateRangeFromPreset(preset)
      startDate = range.startDate
      endDate = range.endDate
    }

    switch (reportType) {
      case 'summary':
        return await getSummaryReport(startDate, endDate, hospitalId)
      case 'revenue':
        return await getRevenueReport(startDate, endDate, hospitalId)
      case 'payments':
        return await getPaymentsReport(startDate, endDate, hospitalId)
      case 'outstanding':
        return await getOutstandingReport(hospitalId)
      case 'procedure_revenue':
        return await getProcedureRevenueReport(startDate, endDate, hospitalId)
      case 'doctor_revenue':
        return await getDoctorRevenueReport(startDate, endDate, hospitalId)
      case 'daily_collection':
        return await getDailyCollectionReport(startDate, endDate, hospitalId)
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

// Summary Report
async function getSummaryReport(startDate: Date, endDate: Date, hospitalId: string) {
  const dateFilter = {
    gte: startDate,
    lte: endDate,
  }

  const [invoiceSummary, collected, outstandingSummary] = await Promise.all([
    // Invoice summary
    prisma.invoice.aggregate({
      where: { hospitalId, createdAt: dateFilter },
      _sum: { totalAmount: true, discountAmount: true },
      _count: true,
    }),
    // What was actually taken, net of anything handed back — see lib/collections.ts.
    collectionTotals(hospitalId, dateFilter),
    // Outstanding summary
    prisma.invoice.aggregate({
      where: {
        hospitalId,
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      _sum: { balanceAmount: true },
      _count: true,
    }),
  ])

  // Invoice status breakdown
  const invoiceStatusBreakdown = await prisma.invoice.groupBy({
    by: ['status'],
    where: { hospitalId, createdAt: dateFilter },
    _sum: { totalAmount: true },
    _count: true,
  })

  return NextResponse.json({
    period: { startDate, endDate },
    summary: {
      totalBilled: invoiceSummary._sum.totalAmount || 0,
      totalDiscounts: invoiceSummary._sum.discountAmount || 0,
      invoiceCount: invoiceSummary._count,
      totalCollected: collected.net,
      totalReceived: collected.received,
      totalRefunded: collected.refunded,
      paymentCount: collected.paymentCount,
      refundCount: collected.refundCount,
      totalOutstanding: outstandingSummary._sum.balanceAmount || 0,
      outstandingInvoices: outstandingSummary._count,
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

// Revenue Report
async function getRevenueReport(startDate: Date, endDate: Date, hospitalId: string) {
  // Get daily revenue data
  const invoices = await prisma.invoice.findMany({
    where: {
      hospitalId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      status: { not: 'CANCELLED' },
    },
    select: {
      createdAt: true,
      totalAmount: true,
      paidAmount: true,
      discountAmount: true,
      taxAmount: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // Group by date
  const dailyRevenue: Record<
    string,
    {
      date: string
      billed: number
      collected: number
      discount: number
      tax: number
      count: number
    }
  > = {}

  invoices.forEach((invoice) => {
    const dateKey = invoice.createdAt.toISOString().split('T')[0]
    if (!dailyRevenue[dateKey]) {
      dailyRevenue[dateKey] = {
        date: dateKey,
        billed: 0,
        collected: 0,
        discount: 0,
        tax: 0,
        count: 0,
      }
    }
    dailyRevenue[dateKey].billed += Number(invoice.totalAmount)
    dailyRevenue[dateKey].collected += Number(invoice.paidAmount)
    dailyRevenue[dateKey].discount += Number(invoice.discountAmount)
    dailyRevenue[dateKey].tax += Number(invoice.taxAmount)
    dailyRevenue[dateKey].count += 1
  })

  // Calculate totals
  const totals = {
    totalBilled: 0,
    totalCollected: 0,
    totalDiscount: 0,
    totalTax: 0,
    invoiceCount: 0,
  }

  Object.values(dailyRevenue).forEach((day) => {
    totals.totalBilled += day.billed
    totals.totalCollected += day.collected
    totals.totalDiscount += day.discount
    totals.totalTax += day.tax
    totals.invoiceCount += day.count
  })

  return NextResponse.json({
    period: { startDate, endDate },
    dailyData: Object.values(dailyRevenue),
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

// Outstanding Report
async function getOutstandingReport(hospitalId: string) {
  const outstandingInvoices = await prisma.invoice.findMany({
    where: {
      hospitalId,
      status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      balanceAmount: { gt: 0 },
    },
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

  // Calculate aging buckets
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const aging = {
    current: { amount: 0, count: 0 }, // Not yet due
    days1_30: { amount: 0, count: 0 }, // 1-30 days overdue
    days31_60: { amount: 0, count: 0 }, // 31-60 days overdue
    days61_90: { amount: 0, count: 0 }, // 61-90 days overdue
    over90: { amount: 0, count: 0 }, // Over 90 days overdue
  }

  outstandingInvoices.forEach((invoice) => {
    const balance = Number(invoice.balanceAmount)
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : new Date(invoice.createdAt)
    dueDate.setHours(0, 0, 0, 0)

    const daysDiff = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

    if (daysDiff <= 0) {
      aging.current.amount += balance
      aging.current.count += 1
    } else if (daysDiff <= 30) {
      aging.days1_30.amount += balance
      aging.days1_30.count += 1
    } else if (daysDiff <= 60) {
      aging.days31_60.amount += balance
      aging.days31_60.count += 1
    } else if (daysDiff <= 90) {
      aging.days61_90.amount += balance
      aging.days61_90.count += 1
    } else {
      aging.over90.amount += balance
      aging.over90.count += 1
    }
  })

  const totalOutstanding = outstandingInvoices.reduce(
    (sum, inv) => sum + Number(inv.balanceAmount),
    0
  )

  return NextResponse.json({
    invoices: outstandingInvoices,
    aging,
    totals: {
      totalOutstanding,
      invoiceCount: outstandingInvoices.length,
    },
  })
}

// Procedure Revenue Report
async function getProcedureRevenueReport(startDate: Date, endDate: Date, hospitalId: string) {
  const treatments = await prisma.treatment.findMany({
    where: {
      hospitalId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      status: { in: ['COMPLETED', 'IN_PROGRESS'] },
    },
    include: {
      procedure: {
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
        },
      },
    },
  })

  // Group by procedure
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

  treatments.forEach((treatment) => {
    if (!treatment.procedure) return

    const procId = treatment.procedure.id
    if (!byProcedure[procId]) {
      byProcedure[procId] = {
        procedureId: procId,
        code: treatment.procedure.code,
        name: treatment.procedure.name,
        category: treatment.procedure.category,
        totalRevenue: 0,
        count: 0,
        avgRevenue: 0,
      }
    }
    byProcedure[procId].totalRevenue += Number(treatment.cost || 0)
    byProcedure[procId].count += 1
  })

  // Calculate averages
  Object.values(byProcedure).forEach((proc) => {
    proc.avgRevenue = proc.count > 0 ? proc.totalRevenue / proc.count : 0
  })

  // Group by category
  const byCategory: Record<
    string,
    {
      category: string
      totalRevenue: number
      count: number
    }
  > = {}

  Object.values(byProcedure).forEach((proc) => {
    const cat = proc.category
    if (!byCategory[cat]) {
      byCategory[cat] = { category: cat, totalRevenue: 0, count: 0 }
    }
    byCategory[cat].totalRevenue += proc.totalRevenue
    byCategory[cat].count += proc.count
  })

  // Sort by revenue
  const proceduresList = Object.values(byProcedure).sort((a, b) => b.totalRevenue - a.totalRevenue)

  const totalRevenue = proceduresList.reduce((sum, p) => sum + p.totalRevenue, 0)
  const totalTreatments = proceduresList.reduce((sum, p) => sum + p.count, 0)

  return NextResponse.json({
    period: { startDate, endDate },
    byProcedure: proceduresList,
    byCategory: Object.values(byCategory).sort((a, b) => b.totalRevenue - a.totalRevenue),
    totals: {
      totalRevenue,
      totalTreatments,
    },
  })
}

// Doctor Revenue Report
async function getDoctorRevenueReport(startDate: Date, endDate: Date, hospitalId: string) {
  const treatments = await prisma.treatment.findMany({
    where: {
      hospitalId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      status: { in: ['COMPLETED', 'IN_PROGRESS'] },
    },
    include: {
      doctor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          specialization: true,
        },
      },
      procedure: {
        select: {
          name: true,
          category: true,
        },
      },
    },
  })

  // Group by doctor
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

  treatments.forEach((treatment) => {
    if (!treatment.doctor) return

    const docId = treatment.doctor.id
    const docName = `${treatment.doctor.firstName} ${treatment.doctor.lastName}`

    if (!byDoctor[docId]) {
      byDoctor[docId] = {
        doctorId: docId,
        name: docName,
        specialization: treatment.doctor.specialization,
        totalRevenue: 0,
        treatmentCount: 0,
        avgPerTreatment: 0,
        procedures: {},
      }
    }

    byDoctor[docId].totalRevenue += Number(treatment.cost || 0)
    byDoctor[docId].treatmentCount += 1

    if (treatment.procedure) {
      const procName = treatment.procedure.name
      byDoctor[docId].procedures[procName] = (byDoctor[docId].procedures[procName] || 0) + 1
    }
  })

  // Calculate averages and format procedures
  const doctorsList = Object.values(byDoctor)
    .map((doc) => {
      doc.avgPerTreatment = doc.treatmentCount > 0 ? doc.totalRevenue / doc.treatmentCount : 0

      // Get top 5 procedures
      const topProcedures = Object.entries(doc.procedures)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }))

      return {
        ...doc,
        topProcedures,
      }
    })
    .sort((a, b) => b.totalRevenue - a.totalRevenue)

  const totalRevenue = doctorsList.reduce((sum, d) => sum + d.totalRevenue, 0)
  const totalTreatments = doctorsList.reduce((sum, d) => sum + d.treatmentCount, 0)

  return NextResponse.json({
    period: { startDate, endDate },
    byDoctor: doctorsList,
    totals: {
      totalRevenue,
      totalTreatments,
      doctorCount: doctorsList.length,
    },
  })
}

// Daily Collection Report
async function getDailyCollectionReport(startDate: Date, endDate: Date, hospitalId: string) {
  const timezone = await clinicTimezone(prisma, hospitalId)
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
