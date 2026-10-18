import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { clinicTimezone, dayRangeIn, localDay, wallClockIn } from '@/lib/appointment-time'
import { collectionTotals } from '@/lib/collections'
import { invoicedLines, outstandingTotals } from '@/lib/invoiced'
import { money } from '@/lib/invoice-figures'
import { subjectName } from '@/lib/visitors'
import { holderCan } from '@/lib/rbac'
import { knownErrorResponse } from '@/lib/api-errors'

// Helper function to convert BigInt to Number in query results
function convertBigIntToNumber(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (obj instanceof Date) return obj // Preserve Date objects
  if (typeof obj === 'bigint') return Number(obj)
  if (Array.isArray(obj)) return obj.map(convertBigIntToNumber)
  if (typeof obj === 'object') {
    const converted: any = {}
    for (const key in obj) {
      converted[key] = convertBigIntToNumber(obj[key])
    }
    return converted
  }
  return obj
}

/** `YYYY-MM-DD` for a calendar day, letting the day or month run over. */
function ymdOf(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

/**
 * A chart's series with every day or month in it, not only the ones that had
 * takings. The SQL returns rows only where money moved, so a quiet week drew
 * one dot and no line (bug report, item 4 of the visual pass).
 */
function fillSeries(keys: string[], rows: Array<{ key: string; revenue: unknown }>) {
  const byKey = new Map(rows.map((row) => [row.key, money(row.revenue)]))
  return keys.map((key) => ({ key, revenue: byKey.get(key) ?? 0 }))
}

// GET /api/dashboard/stats - Get dashboard statistics
export async function GET(req: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('reports:operational')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /**
   * Revenue and money owed are billing figures, and the dashboard is opened by
   * everybody with `reports:operational` — the dental assistant and the lab
   * side included, who hold no billing permission and were shown this month's
   * takings and the clinic's receivables on their front page (bug report
   * 12 Oct, finding 41). For them the money is left out of the answer, not
   * merely hidden by the page: the API is what a curious person reads.
   */
  const showsMoney = holderCan({ role: user.role, clinicalRole: user.clinicalRole }, 'billing:read')

  /**
   * The same for stock. Item names and levels were returned to every role and
   * the card linked to stock alerts that Front Desk cannot open (bug report
   * 16 Oct, finding 11); without `inventory:read` they are not fetched.
   */
  const showsStock = holderCan(
    { role: user.role, clinicalRole: user.clinicalRole },
    'inventory:read'
  )

  try {
    const now = new Date()

    // Day and month boundaries on the clinic's calendar. These were `date-fns`
    // calls against the *server's* midnight, which on a host in UTC puts the
    // first five hours of a Karachi clinic's day into yesterday's figures.
    const timezone = await clinicTimezone(prisma, hospitalId)
    const today = localDay(now, timezone)
    const { gte: todayStart, lt: todayEnd } = dayRangeIn(today, timezone)
    const year = Number(today.slice(0, 4))
    const month = Number(today.slice(5, 7))
    const date = Number(today.slice(8, 10))

    // Every bound is a clinic midnight and every upper bound exclusive (`lt`).
    // `monthEnd` is the first instant of next month: it used to be compared
    // with `lte`, counting that instant into this month (review 6.9), and the
    // previous month ended at `subDays(monthStart, 1)` with `lte`, which left
    // its whole last day out and overstated growth.
    const monthStart = dayRangeIn(ymdOf(year, month, 1), timezone).gte
    const monthEnd = dayRangeIn(ymdOf(year, month + 1, 1), timezone).gte
    const prevMonthStart = dayRangeIn(ymdOf(year, month - 1, 1), timezone).gte
    const sevenDays = Array.from({ length: 7 }, (_, i) => ymdOf(year, month, date - 6 + i))
    const last7DaysStart = dayRangeIn(sevenDays[0], timezone).gte
    const sixMonths = Array.from({ length: 6 }, (_, i) => ymdOf(year, month - 5 + i, 1).slice(0, 7))
    const last6MonthsStart = dayRangeIn(`${sixMonths[0]}-01`, timezone).gte

    // Fetch all statistics in parallel with error handling
    let results
    try {
      results = await Promise.all([
        // Total patients
        prisma.patient.count({
          where: { isActive: true, hospitalId },
        }),

        // New patients this month
        prisma.patient.count({
          where: {
            isActive: true,
            hospitalId,
            createdAt: {
              gte: monthStart,
              lt: monthEnd,
            },
          },
        }),

        // Today's appointments
        prisma.appointment.count({
          where: {
            hospitalId,
            startsAt: {
              gte: todayStart,
              lt: todayEnd,
            },
          },
        }),

        // This month's appointments
        prisma.appointment.count({
          where: {
            hospitalId,
            startsAt: {
              gte: monthStart,
              lt: monthEnd,
            },
          },
        }),

        // Still to come today. The page shows this beside today's count, and
        // it counted every booked appointment on any later day as well (bug
        // report 16 Oct, finding 27).
        prisma.appointment.count({
          where: {
            hospitalId,
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            startsAt: {
              gte: now,
              lt: todayEnd,
            },
          },
        }),

        // Completed appointments today
        prisma.appointment.count({
          where: {
            hospitalId,
            status: 'COMPLETED',
            startsAt: {
              gte: todayStart,
              lt: todayEnd,
            },
          },
        }),

        // Collected this month, today, last month and ever: settled payments
        // less refunds, by the day the money moved, on the clinic's calendar —
        // the figure Billing → Total Collected shows (lib/collections.ts).
        // These were dated by `Payment.createdAt`, so a payment entered today
        // for yesterday counted today here and yesterday on the billing screen.
        showsMoney ? collectionTotals(hospitalId, { gte: monthStart, lt: monthEnd }) : null,
        showsMoney ? collectionTotals(hospitalId, { gte: todayStart, lt: todayEnd }) : null,
        showsMoney ? collectionTotals(hospitalId, { gte: prevMonthStart, lt: monthStart }) : null,
        showsMoney ? collectionTotals(hospitalId, {}) : null,

        // Outstanding: the balances of owed invoices (lib/invoice-figures.ts).
        // This summed invoice *totals* of PENDING and PARTIALLY_PAID only, so a
        // half-paid 10,000 bill counted 10,000 and an OVERDUE one nothing.
        showsMoney ? outstandingTotals(hospitalId) : null,

        // Collected per clinic day for the last seven days. Grouped in the
        // clinic's zone: `DATE("createdAt")` was the database's UTC day, which
        // moved an evening's takings in Karachi onto the next morning, and it
        // dated by entry rather than by `paymentDate`. The statuses are
        // SETTLED_PAYMENT_STATUSES (lib/cashier.ts); refunds come off on the
        // day the money went back, as in `collectionTotals`.
        showsMoney
          ? prisma.$queryRaw<Array<{ key: string; revenue: unknown }>>`
        SELECT "key", SUM("amount")::numeric(12,2) AS "revenue" FROM (
          SELECT to_char(("paymentDate" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS "key",
                 amount AS "amount"
          FROM "Payment"
          WHERE "paymentDate" >= ${last7DaysStart}
            AND "paymentDate" < ${todayEnd}
            AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
            AND "hospitalId" = ${hospitalId}
          UNION ALL
          SELECT to_char(("refundedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS "key",
                 -amount AS "amount"
          FROM "Refund"
          WHERE "refundedAt" >= ${last7DaysStart}
            AND "refundedAt" < ${todayEnd}
            AND "hospitalId" = ${hospitalId}
        ) movements
        GROUP BY "key"
      `
          : [],

        // The same by clinic month, for this month and the five before it.
        showsMoney
          ? prisma.$queryRaw<Array<{ key: string; revenue: unknown }>>`
        SELECT "key", SUM("amount")::numeric(12,2) AS "revenue" FROM (
          SELECT to_char(("paymentDate" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM') AS "key",
                 amount AS "amount"
          FROM "Payment"
          WHERE "paymentDate" >= ${last6MonthsStart}
            AND "paymentDate" < ${monthEnd}
            AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
            AND "hospitalId" = ${hospitalId}
          UNION ALL
          SELECT to_char(("refundedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM') AS "key",
                 -amount AS "amount"
          FROM "Refund"
          WHERE "refundedAt" >= ${last6MonthsStart}
            AND "refundedAt" < ${monthEnd}
            AND "hospitalId" = ${hospitalId}
        ) movements
        GROUP BY "key"
      `
          : [],

        // Appointments by status
        prisma.appointment.groupBy({
          by: ['status'],
          _count: {
            status: true,
          },
          where: {
            hospitalId,
            startsAt: {
              gte: monthStart,
              lt: monthEnd,
            },
          },
        }),

        // Top procedures this month: how often each was done, and what was
        // invoiced for it. The money used to be Σ `Treatment.cost` over every
        // treatment started this month — planned and cancelled ones included,
        // at list price, billed or not — and the count included those too.
        prisma.treatment.groupBy({
          by: ['procedureId'],
          where: {
            hospitalId,
            createdAt: { gte: monthStart, lt: monthEnd },
            status: { in: ['IN_PROGRESS', 'COMPLETED'] },
          },
          _count: { _all: true },
        }),
        showsMoney ? invoicedLines(hospitalId, { gte: monthStart, lt: monthEnd }) : [],

        // Recent appointments (next 5)
        prisma.appointment.findMany({
          where: {
            hospitalId,
            startsAt: {
              gte: now,
            },
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
          },
          include: {
            // A walk-in has a visitor and no patient, so the subject of an
            // appointment has to be asked for both ways. Fetching only the
            // patient made the whole dashboard 500 as soon as the next five
            // appointments included one walk-in.
            patient: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
            visitor: {
              select: {
                name: true,
              },
            },
            doctor: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            startsAt: 'asc',
          },
          take: 5,
        }),

        // Low stock items (using raw query to compare fields)
        showsStock
          ? prisma.$queryRaw`
        SELECT
          id,
          name,
          "currentStock",
          "minimumStock",
          unit
        FROM "InventoryItem"
        WHERE "currentStock" <= "minimumStock"
        AND "minimumStock" > 0
        AND "isActive" = true
        AND "hospitalId" = ${hospitalId}
        ORDER BY ("minimumStock" - "currentStock") DESC
        LIMIT 10
      `
          : [],
      ])
    } catch (queryError: any) {
      console.error('Database query error:', {
        message: queryError.message,
        stack: queryError.stack,
        code: queryError.code,
      })
      // Rethrown as it was, so the handler below can still recognise it.
      throw queryError
    }

    const [
      totalPatients,
      newPatientsThisMonth,
      todayAppointments,
      thisMonthAppointments,
      pendingAppointments,
      completedAppointmentsToday,
      monthCollected,
      todayCollected,
      prevMonthCollected,
      allCollected,
      outstanding,
      rawLast7DaysRevenue,
      rawLast6MonthsRevenue,
      appointmentsByStatus,
      procedureCounts,
      monthLines,
      recentAppointments,
      rawLowStockItems,
    ] = results

    const lowStockItems = convertBigIntToNumber(rawLowStockItems)

    // Every day and month present, keyed as the page has always read them.
    const last7DaysRevenue = fillSeries(sevenDays, rawLast7DaysRevenue).map(({ key, revenue }) => ({
      date: key,
      revenue,
    }))
    const last6MonthsRevenue = fillSeries(sixMonths, rawLast6MonthsRevenue).map(
      ({ key, revenue }) => ({ month: key, revenue })
    )

    // The five most done this month, with what was invoiced for each.
    const invoicedByProcedure = new Map<string, number>()
    for (const line of monthLines) {
      if (!line.procedure) continue
      invoicedByProcedure.set(
        line.procedure.id,
        money((invoicedByProcedure.get(line.procedure.id) ?? 0) + line.amount)
      )
    }
    const top = [...procedureCounts].sort((a, b) => b._count._all - a._count._all).slice(0, 5)
    const procedureNames = new Map(
      top.length > 0
        ? (
            await prisma.procedure.findMany({
              where: { id: { in: top.map((row) => row.procedureId) } },
              select: { id: true, name: true },
            })
          ).map((procedure) => [procedure.id, procedure.name])
        : []
    )
    const topProcedures = top.map((row) => ({
      name: procedureNames.get(row.procedureId) ?? 'Unknown procedure',
      count: row._count._all,
      revenue: invoicedByProcedure.get(row.procedureId) ?? 0,
    }))

    // Calculate growth percentages. Last month runs up to, not including, the
    // first instant of this one.
    const [prevMonthPatients, prevMonthAppointments] = await Promise.all([
      prisma.patient.count({
        where: {
          isActive: true,
          hospitalId,
          createdAt: { gte: prevMonthStart, lt: monthStart },
        },
      }),
      prisma.appointment.count({
        where: {
          hospitalId,
          startsAt: { gte: prevMonthStart, lt: monthStart },
        },
      }),
    ])

    const thisMonthNet = monthCollected?.net ?? 0
    const prevMonthNet = prevMonthCollected?.net ?? 0

    const revenueGrowth = prevMonthNet ? ((thisMonthNet - prevMonthNet) / prevMonthNet) * 100 : 0

    const patientGrowth = prevMonthPatients
      ? ((newPatientsThisMonth - prevMonthPatients) / prevMonthPatients) * 100
      : 0

    const appointmentGrowth = prevMonthAppointments
      ? ((thisMonthAppointments - prevMonthAppointments) / prevMonthAppointments) * 100
      : 0

    // Format response
    const stats = {
      // Tells the page which cards it has figures for, so it can leave the
      // money cards out rather than show "Rs 0" to somebody who may not see.
      showsMoney,
      showsStock,
      overview: {
        totalPatients,
        newPatientsThisMonth,
        patientGrowth: parseFloat(patientGrowth.toFixed(1)),
        todayAppointments,
        thisMonthAppointments,
        appointmentGrowth: parseFloat(appointmentGrowth.toFixed(1)),
        pendingAppointments,
        completedAppointmentsToday,
        // The field names are the page's; what they hold is now Collected
        // (cash in, net of refunds) and Outstanding (balances owed).
        ...(showsMoney && {
          thisMonthRevenue: thisMonthNet,
          todayRevenue: todayCollected?.net ?? 0,
          revenueGrowth: parseFloat(revenueGrowth.toFixed(1)),
          pendingPayments: outstanding?.outstanding ?? 0,
          totalRevenue: allCollected?.net ?? 0,
        }),
      },
      charts: {
        last7DaysRevenue: showsMoney ? last7DaysRevenue : [],
        last6MonthsRevenue: showsMoney ? last6MonthsRevenue : [],
        appointmentsByStatus: appointmentsByStatus.map((item: any) => ({
          status: item.status,
          count: item._count.status,
        })),
        // How often each procedure was done is operational; what it earned is
        // not, so the count stays and the invoiced column goes.
        topProcedures: showsMoney
          ? topProcedures
          : topProcedures.map(({ revenue: _revenue, ...rest }) => rest),
      },
      recentActivity: {
        upcomingAppointments: recentAppointments.map((apt) => ({
          id: apt.id,
          patientName: subjectName(apt),
          doctorName: apt.doctor
            ? `${apt.doctor.firstName} ${apt.doctor.lastName}`
            : 'Not assigned',
          ...wallClockIn(apt.startsAt, timezone),
          date: apt.startsAt,
          type: apt.appointmentType,
          status: apt.status,
        })),
        lowStockItems,
      },
    }

    return NextResponse.json({
      success: true,
      data: stats,
    })
  } catch (error: any) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Dashboard stats error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      meta: error.meta,
    })
    return NextResponse.json({ error: 'Failed to fetch dashboard statistics' }, { status: 500 })
  }
}
