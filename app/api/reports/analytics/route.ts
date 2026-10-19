import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { knownErrorResponse } from '@/lib/api-errors'
import { averageWait } from '@/lib/appointment-wait'
import { differenceInDays } from 'date-fns'
import { clinicTimezone } from '@/lib/appointment-time'
import { dateRangeFromDays, getDateRangeFromPreset } from '@/lib/billing-utils'
import { collectionTotals, dayKeyOf } from '@/lib/collections'
import { SETTLED_PAYMENT_STATUSES } from '@/lib/cashier'
import { billedAt, billedInvoiceWhere, money } from '@/lib/invoice-figures'
import { billedTotals, invoicedLines, outstandingTotals } from '@/lib/invoiced'
import { holderCan } from '@/lib/rbac'
// `2026-10` as `Oct 26` — the shared one, so the financial trend and the
// dashboard's collections axis cannot disagree about `Sep` and `Sept`.
import { monthLabel } from '@/lib/dates'

/** The age buckets, in the order an age axis has to show them. */
const AGE_GROUPS = ['0-17', '18-29', '30-44', '45-59', '60+', 'Unknown'] as const

// Patient Analytics
async function getPatientAnalytics(dateFrom: Date, dateTo: Date, hospitalId: string) {
  // Get total patients in the date range
  const patientsInRange = await prisma.patient.findMany({
    where: {
      hospitalId,
      createdAt: {
        gte: dateFrom,
        lte: dateTo,
      },
      isActive: true,
    },
    select: {
      id: true,
      gender: true,
      dateOfBirth: true,
      referredBy: true,
      createdAt: true,
    },
  })

  // Get patients with repeat appointments
  const patientsWithMultipleAppointments = await prisma.patient.findMany({
    where: {
      hospitalId,
      appointments: {
        some: {
          createdAt: {
            gte: dateFrom,
            lte: dateTo,
          },
        },
      },
    },
    include: {
      _count: {
        select: {
          appointments: {
            where: {
              createdAt: {
                lte: dateTo,
              },
            },
          },
        },
      },
    },
  })

  const returningPatients = patientsWithMultipleAppointments.filter(
    (p) => p._count.appointments > 1
  ).length
  const newPatients = patientsInRange.length
  const totalPatients = Math.max(newPatients, patientsWithMultipleAppointments.length)

  // Calculate demographics
  const demographics = {
    male: patientsInRange.filter((p) => p.gender === 'MALE').length,
    female: patientsInRange.filter((p) => p.gender === 'FEMALE').length,
    other: patientsInRange.filter((p) => p.gender === 'OTHER').length,
  }

  // Calculate age groups
  const getAgeGroup = (dob: Date | null) => {
    if (!dob) return 'Unknown'
    const age = differenceInDays(new Date(), dob) / 365
    if (age < 18) return '0-17'
    if (age < 30) return '18-29'
    if (age < 45) return '30-44'
    if (age < 60) return '45-59'
    return '60+'
  }

  const ageGroupCounts = patientsInRange.reduce(
    (acc, p) => {
      const group = getAgeGroup(p.dateOfBirth)
      acc[group] = (acc[group] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  /**
   * In age order, not in the order the patients happened to arrive.
   *
   * These came straight off `Object.entries`, so the axis read 0-17, 30-44,
   * 18-29 — whichever bucket the first matching patient fell into came first.
   * An age distribution is a shape you read left to right; out of order it is
   * not one. Empty buckets are dropped so the axis does not carry gaps.
   */
  const ageGroups = AGE_GROUPS.filter((label) => ageGroupCounts[label]).map((label) => ({
    label,
    count: ageGroupCounts[label],
  }))

  // Calculate acquisition sources
  const sourceCounts = patientsInRange.reduce(
    (acc, p) => {
      const source = p.referredBy || 'Direct Walk-in'
      acc[source] = (acc[source] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  const acquisitionSources = Object.entries(sourceCounts).map(([source, count]) => ({
    source,
    count,
    percentage: totalPatients > 0 ? (count / totalPatients) * 100 : 0,
  }))

  // Calculate retention rate
  const retentionRate = totalPatients > 0 ? (returningPatients / totalPatients) * 100 : 0

  return {
    newPatients,
    returningPatients,
    totalPatients,
    retentionRate,
    demographics,
    ageGroups,
    acquisitionSources,
  }
}

// Clinical Analytics
async function getClinicalAnalytics(dateFrom: Date, dateTo: Date, hospitalId: string) {
  const treatments = await prisma.treatment.findMany({
    where: {
      hospitalId,
      createdAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    },
    include: {
      procedure: true,
    },
  })

  const totalTreatments = treatments.length
  const completedTreatments = treatments.filter((t) => t.status === 'COMPLETED').length
  const inProgressTreatments = treatments.filter((t) => t.status === 'IN_PROGRESS').length
  const completionRate = totalTreatments > 0 ? (completedTreatments / totalTreatments) * 100 : 0

  // Calculate average treatment duration
  const treatmentsWithDuration = treatments.filter((t) => t.startTime && t.endTime)
  const avgTreatmentDuration =
    treatmentsWithDuration.length > 0
      ? treatmentsWithDuration.reduce((sum, t) => {
          const duration =
            t.endTime && t.startTime
              ? (t.endTime.getTime() - t.startTime.getTime()) / (1000 * 60)
              : 0
          return sum + duration
        }, 0) / treatmentsWithDuration.length
      : 0

  // Get common procedures
  const procedureCounts = treatments.reduce(
    (acc, t) => {
      const procId = t.procedureId
      if (!acc[procId]) {
        acc[procId] = {
          procedureId: procId,
          name: t.procedure.name,
          code: t.procedure.code,
          count: 0,
          completed: 0,
        }
      }
      acc[procId].count++
      if (t.status === 'COMPLETED') {
        acc[procId].completed++
      }
      return acc
    },
    {} as Record<string, any>
  )

  const commonProcedures = Object.values(procedureCounts)
    .map((p: any) => ({
      ...p,
      successRate: p.count > 0 ? (p.completed / p.count) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Procedures by category
  const categoryCounts = treatments.reduce(
    (acc, t) => {
      const category = t.procedure.category
      acc[category] = (acc[category] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  const proceduresByCategory = Object.entries(categoryCounts).map(([category, count]) => ({
    category,
    count,
    percentage: totalTreatments > 0 ? (count / totalTreatments) * 100 : 0,
  }))

  return {
    totalTreatments,
    completedTreatments,
    inProgressTreatments,
    completionRate,
    avgTreatmentDuration: Math.round(avgTreatmentDuration),
    commonProcedures,
    proceduresByCategory,
  }
}

/**
 * Financial Analytics, on the same three figures as every other money screen.
 *
 * "Total Revenue" here was Σ totalAmount of every invoice *created* in the
 * period — drafts and cancelled bills included — while the dashboard's
 * "Revenue" was cash collected. Same word, Rs 500 on one screen and Rs 2,500
 * on the other (bug report item 6), and a −876% profit margin computed from
 * the bigger one. The payment-method split counted `status: 'COMPLETED'`
 * only, so a partly refunded payment vanished from it entirely.
 *
 *  - **Billed**: invoices issued in the period, not draft or cancelled.
 *  - **Collected**: cash in, net of refunds (lib/collections.ts).
 *  - **Outstanding**: owed now, whenever it was billed.
 *
 * Profit is cash: collected less stock purchases, both money that moved in
 * the period. Average bill is billed ÷ invoices billed; collection rate is
 * collected ÷ billed.
 */
async function getFinancialAnalytics(
  dateFrom: Date,
  dateTo: Date,
  hospitalId: string,
  timezone: string
) {
  const window = { gte: dateFrom, lte: dateTo }

  const [billed, collected, outstanding, billedInvoices, payments, refunds, purchases] =
    await Promise.all([
      billedTotals(hospitalId, window),
      collectionTotals(hospitalId, window),
      outstandingTotals(hospitalId),
      prisma.invoice.findMany({
        where: { hospitalId, ...billedInvoiceWhere(window) },
        select: { issuedAt: true, createdAt: true, totalAmount: true },
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
      // Expenses: stock bought in the period.
      prisma.stockTransaction.findMany({
        where: { hospitalId, type: 'PURCHASE', createdAt: window },
        select: { createdAt: true, totalPrice: true },
      }),
    ])

  const totalBilled = billed.billed
  const totalCollected = money(collected.net)
  const totalExpenses = money(purchases.reduce((sum, p) => sum + Number(p.totalPrice || 0), 0))
  const profit = money(totalCollected - totalExpenses)

  const profitMargin = totalCollected > 0 ? (profit / totalCollected) * 100 : 0
  const avgBillValue = billed.invoiceCount > 0 ? totalBilled / billed.invoiceCount : 0
  const collectionEfficiency = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0

  // By clinic month, so a payment late on the 31st in Karachi is October's.
  const monthly: Record<string, { billed: number; collected: number; expenses: number }> = {}
  const monthOf = (at: Date) => {
    const key = dayKeyOf(at, timezone).slice(0, 7)
    return (monthly[key] ??= { billed: 0, collected: 0, expenses: 0 })
  }
  for (const invoice of billedInvoices) {
    const month = monthOf(billedAt(invoice))
    month.billed = money(month.billed + money(invoice.totalAmount))
  }
  for (const payment of payments) {
    const month = monthOf(payment.paymentDate)
    month.collected = money(month.collected + money(payment.amount))
  }
  for (const refund of refunds) {
    const month = monthOf(refund.refundedAt)
    month.collected = money(month.collected - money(refund.amount))
  }
  for (const purchase of purchases) {
    const month = monthOf(purchase.createdAt)
    month.expenses = money(month.expenses + Number(purchase.totalPrice || 0))
  }

  const revenueByMonth = Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, data]) => ({
      month: monthLabel(key),
      billed: data.billed,
      collected: data.collected,
      expenses: data.expenses,
      profit: money(data.collected - data.expenses),
    }))

  // What each method actually brought in, net of what went back by it.
  const paymentMethodBreakdown = collected.byMethod.map((row) => ({
    method: row.method,
    amount: money(row.net),
    percentage: totalCollected > 0 ? (row.net / totalCollected) * 100 : 0,
  }))

  return {
    totalBilled,
    totalCollected,
    totalExpenses,
    profit,
    profitMargin,
    avgBillValue,
    collectionEfficiency,
    revenueByMonth,
    paymentMethodBreakdown,
    outstandingAmount: outstanding.outstanding,
    invoiceCount: billed.invoiceCount,
  }
}

// Operational Analytics
async function getOperationalAnalytics(
  dateFrom: Date,
  dateTo: Date,
  hospitalId: string,
  showsMoney: boolean
) {
  const appointments = await prisma.appointment.findMany({
    where: {
      hospitalId,
      startsAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    },
    include: {
      doctor: {
        include: {
          user: true,
        },
      },
    },
  })

  const totalAppointments = appointments.length
  const completedAppointments = appointments.filter((a) => a.status === 'COMPLETED').length
  const cancelledAppointments = appointments.filter((a) => a.status === 'CANCELLED').length
  const noShowCount = appointments.filter((a) => a.status === 'NO_SHOW').length
  const noShowRate = totalAppointments > 0 ? (noShowCount / totalAppointments) * 100 : 0
  const appointmentUtilization =
    totalAppointments > 0 ? (completedAppointments / totalAppointments) * 100 : 0

  // Average wait: check-in until called in, over patients who were called in.
  // `waitTime` used to be how late the patient arrived, written at check-in,
  // and was averaged over anybody who had ever checked in (bug report 12 Oct,
  // finding 32). See lib/appointment-wait.ts.
  const avgWaitTime = averageWait(appointments)

  // Staff productivity: appointments and completed treatments are the
  // clinical work; the money column is what was *invoiced* for their
  // treatments in the period (lib/invoiced.ts), not `Treatment.cost` at list
  // price, and it is called that on screen.
  const staffMap = new Map<
    string,
    {
      staffId: string
      name: string
      role: string
      appointmentsHandled: number
      treatmentsCompleted: number
      invoiced: number
    }
  >()
  const staffRow = (
    staffId: string,
    doctor: { firstName: string; lastName: string; role: string }
  ) => {
    let row = staffMap.get(staffId)
    if (!row) {
      row = {
        staffId,
        name: `${doctor.firstName} ${doctor.lastName}`,
        role: doctor.role,
        appointmentsHandled: 0,
        treatmentsCompleted: 0,
        invoiced: 0,
      }
      staffMap.set(staffId, row)
    }
    return row
  }

  for (const appointment of appointments) {
    staffRow(appointment.doctorId, {
      firstName: appointment.doctor.firstName,
      lastName: appointment.doctor.lastName,
      role: appointment.doctor.user.role,
    }).appointmentsHandled++
  }

  const treatments = await prisma.treatment.findMany({
    where: {
      hospitalId,
      status: 'COMPLETED',
      createdAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    },
    select: { doctorId: true },
  })

  for (const t of treatments) {
    const row = staffMap.get(t.doctorId)
    if (row) row.treatmentsCompleted++
  }

  if (showsMoney) {
    for (const line of await invoicedLines(hospitalId, { gte: dateFrom, lte: dateTo })) {
      if (!line.doctor) continue
      const row = staffRow(line.doctor.id, line.doctor)
      row.invoiced = money(row.invoiced + line.amount)
    }
  }

  // Money left out of the answer for a role that may not see it, as on the
  // dashboard (bug report 12 Oct, finding 41).
  const staffProductivity = Array.from(staffMap.values()).map(({ invoiced, ...row }) =>
    showsMoney ? { ...row, invoiced } : row
  )

  // Inventory turnover (simplified)
  const stockTransactions = await prisma.stockTransaction.findMany({
    where: {
      hospitalId,
      createdAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    },
  })

  const totalStockUsed = stockTransactions
    .filter((t) => ['SALE', 'CONSUMPTION'].includes(t.type))
    .reduce((sum, t) => sum + t.quantity, 0)

  const avgInventoryValue = await prisma.inventoryItem.aggregate({
    where: { hospitalId },
    _sum: {
      currentStock: true,
    },
  })

  const inventoryTurnover =
    (avgInventoryValue._sum.currentStock || 0) > 0
      ? totalStockUsed / (avgInventoryValue._sum.currentStock || 1)
      : 0

  // Low stock items
  const lowStockItems = await prisma.inventoryItem.count({
    where: {
      hospitalId,
      currentStock: {
        lte: prisma.inventoryItem.fields.reorderLevel,
      },
      isActive: true,
    },
  })

  return {
    totalAppointments,
    completedAppointments,
    cancelledAppointments,
    noShowCount,
    noShowRate,
    appointmentUtilization,
    avgWaitTime: Math.round(avgWaitTime),
    staffProductivity,
    inventoryTurnover,
    lowStockItems,
  }
}

export async function GET(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('reports:operational')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The operational reports are open to the chair-side and lab roles; the
  // money in them is not. Financial Analytics needs `reports:financial`, as
  // the billing reports do, and the invoiced column in staff productivity is
  // left out without it.
  const seesMoney = user
    ? holderCan({ role: user.role, clinicalRole: user.clinicalRole }, 'reports:financial')
    : false

  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'patient'
    const preset = searchParams.get('preset') || 'this_month'
    const dateFromParam = searchParams.get('dateFrom')
    const dateToParam = searchParams.get('dateTo')

    // The same windows as Billing → Reports, on the clinic's calendar. This
    // route had its own copy built on the server's midnight, with weeks from
    // Monday and current periods running to the end of the month, so "this
    // week" here and there were different weeks. A custom "to" date was
    // midnight at its *start*, leaving the last day out.
    const timezone = await clinicTimezone(prisma, hospitalId)

    let dateFrom: Date
    let dateTo: Date

    if (dateFromParam && dateToParam) {
      const range = dateRangeFromDays(
        dateFromParam.slice(0, 10),
        dateToParam.slice(0, 10),
        timezone
      )
      dateFrom = range.startDate
      dateTo = range.endDate
    } else {
      const range = getDateRangeFromPreset(preset, timezone)
      dateFrom = range.startDate
      dateTo = range.endDate
    }

    if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo must be dates such as 2026-10-14.' },
        { status: 400 }
      )
    }

    let data

    switch (type) {
      case 'patient':
        data = await getPatientAnalytics(dateFrom, dateTo, hospitalId)
        break
      case 'clinical':
        data = await getClinicalAnalytics(dateFrom, dateTo, hospitalId)
        break
      case 'financial':
        if (!seesMoney) {
          return NextResponse.json(
            { error: 'Financial analytics need the financial reports permission.' },
            { status: 403 }
          )
        }
        data = await getFinancialAnalytics(dateFrom, dateTo, hospitalId, timezone)
        break
      case 'operational':
        data = await getOperationalAnalytics(dateFrom, dateTo, hospitalId, seesMoney)
        break
      default:
        return NextResponse.json({ error: 'Invalid analytics type' }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Analytics API error:', error)
    return NextResponse.json({ error: 'Failed to fetch analytics data' }, { status: 500 })
  }
}
