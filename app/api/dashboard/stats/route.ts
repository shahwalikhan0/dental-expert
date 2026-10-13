import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { subDays, subMonths } from 'date-fns'
import { clinicTimezone, dayRangeIn, localDay, wallClockIn } from '@/lib/appointment-time'
import { SETTLED_PAYMENT_STATUSES } from '@/lib/cashier'
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

  try {
    const now = new Date()

    // Day and month boundaries on the clinic's calendar. These were `date-fns`
    // calls against the *server's* midnight, which on a host in UTC puts the
    // first five hours of a Karachi clinic's day into yesterday's figures.
    const timezone = await clinicTimezone(prisma, hospitalId)
    const today = localDay(now, timezone)
    const { gte: todayStart, lt: todayEnd } = dayRangeIn(today, timezone)
    const firstOfMonth = `${today.slice(0, 7)}-01`
    const daysInMonth = new Date(
      Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)
    ).getUTCDate()
    const { gte: monthStart, lt: monthEnd } = dayRangeIn(firstOfMonth, timezone, daysInMonth)
    const last7DaysStart = subDays(now, 6)
    const last6MonthsStart = subMonths(monthStart, 5)

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
              lte: monthEnd,
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

        // Pending appointments (upcoming)
        prisma.appointment.count({
          where: {
            hospitalId,
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            startsAt: {
              gte: now,
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

        // This month's revenue
        prisma.payment.aggregate({
          where: {
            hospitalId,
            createdAt: {
              gte: monthStart,
              lte: monthEnd,
            },
            status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
          },
          _sum: {
            amount: true,
          },
        }),

        // Today's revenue
        prisma.payment.aggregate({
          where: {
            hospitalId,
            createdAt: {
              gte: todayStart,
              lte: todayEnd,
            },
            status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
          },
          _sum: {
            amount: true,
          },
        }),

        // Pending payments
        prisma.invoice.aggregate({
          where: {
            hospitalId,
            status: { in: ['PENDING', 'PARTIALLY_PAID'] },
          },
          _sum: {
            totalAmount: true,
          },
        }),

        // Total revenue (all time)
        prisma.payment.aggregate({
          where: {
            hospitalId,
            status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
          },
          _sum: {
            amount: true,
          },
        }),

        // Last 7 days revenue (daily breakdown)
        // Takings less refunds, by day. A refund is dated by when the money
        // went back, which is the day whose total it should reduce.
        prisma.$queryRaw`
        SELECT "date", SUM("revenue")::numeric(10,2) AS "revenue" FROM (
          SELECT DATE("createdAt") AS "date", SUM(amount) AS "revenue"
          FROM "Payment"
          WHERE "createdAt" >= ${last7DaysStart}
            AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
            AND "hospitalId" = ${hospitalId}
          GROUP BY DATE("createdAt")
          UNION ALL
          SELECT DATE("refundedAt") AS "date", -SUM(amount) AS "revenue"
          FROM "Refund"
          WHERE "refundedAt" >= ${last7DaysStart}
            AND "hospitalId" = ${hospitalId}
          GROUP BY DATE("refundedAt")
        ) movements
        GROUP BY "date"
        ORDER BY "date" ASC
      `,

        // Last 6 months revenue (monthly breakdown)
        prisma.$queryRaw`
        SELECT "month", SUM("revenue")::numeric(10,2) AS "revenue" FROM (
          SELECT to_char("createdAt", 'YYYY-MM') AS "month", SUM(amount) AS "revenue"
          FROM "Payment"
          WHERE "createdAt" >= ${last6MonthsStart}
            AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
            AND "hospitalId" = ${hospitalId}
          GROUP BY to_char("createdAt", 'YYYY-MM')
          UNION ALL
          SELECT to_char("refundedAt", 'YYYY-MM') AS "month", -SUM(amount) AS "revenue"
          FROM "Refund"
          WHERE "refundedAt" >= ${last6MonthsStart}
            AND "hospitalId" = ${hospitalId}
          GROUP BY to_char("refundedAt", 'YYYY-MM')
        ) movements
        GROUP BY "month"
        ORDER BY "month" ASC
      `,

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

        // Top 5 procedures this month
        prisma.$queryRaw`
        SELECT
          p.name,
          COUNT(*)::bigint as "count",
          COALESCE(SUM(t.cost), 0)::numeric(10,2) as "revenue"
        FROM "Treatment" t
        JOIN "Procedure" p ON t."procedureId" = p.id
        WHERE t."createdAt" >= ${monthStart}
        AND t."createdAt" <= ${monthEnd}
        AND t."hospitalId" = ${hospitalId}
        GROUP BY p.id, p.name
        ORDER BY "count" DESC
        LIMIT 5
      `,

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
        prisma.$queryRaw`
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
      `,
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

    // Destructure results and convert BigInt values
    const [
      totalPatients,
      newPatientsThisMonth,
      todayAppointments,
      thisMonthAppointments,
      pendingAppointments,
      completedAppointmentsToday,
      thisMonthRevenue,
      todayRevenue,
      pendingPayments,
      totalRevenue,
      rawLast7DaysRevenue,
      rawLast6MonthsRevenue,
      appointmentsByStatus,
      rawTopProcedures,
      recentAppointments,
      rawLowStockItems,
    ] = results

    // Convert BigInt values from raw SQL queries
    const last7DaysRevenue = convertBigIntToNumber(rawLast7DaysRevenue)
    const last6MonthsRevenue = convertBigIntToNumber(rawLast6MonthsRevenue)
    const topProcedures = convertBigIntToNumber(rawTopProcedures)
    const lowStockItems = convertBigIntToNumber(rawLowStockItems)

    // Refunds never came off any of these figures. A day on which the clinic
    // took 5,000 and handed 2,000 back reported 5,000 — and once the refund
    // moved the payment to PARTIALLY_REFUNDED, the status filter above dropped
    // it entirely and the same day reported nothing. Both are fixed here: the
    // filter counts settled payments, and what went back is taken off.
    const [monthRefunds, todayRefunds, allRefunds] = await Promise.all([
      prisma.refund.aggregate({
        where: { hospitalId, refundedAt: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true },
      }),
      prisma.refund.aggregate({
        where: { hospitalId, refundedAt: { gte: todayStart, lte: todayEnd } },
        _sum: { amount: true },
      }),
      prisma.refund.aggregate({ where: { hospitalId }, _sum: { amount: true } }),
    ])

    const netOf = (
      received: { _sum: { amount: unknown } },
      refunded: { _sum: { amount: unknown } }
    ) => Number(received._sum.amount || 0) - Number(refunded._sum.amount || 0)

    // Calculate growth percentages
    const prevMonthStart = subMonths(monthStart, 1)
    const prevMonthEnd = subDays(monthStart, 1)

    const [prevMonthRevenue, prevMonthPatients, prevMonthAppointments] = await Promise.all([
      prisma.payment.aggregate({
        where: {
          hospitalId,
          createdAt: {
            gte: prevMonthStart,
            lte: prevMonthEnd,
          },
          status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
        },
        _sum: {
          amount: true,
        },
      }),
      prisma.patient.count({
        where: {
          isActive: true,
          hospitalId,
          createdAt: {
            gte: prevMonthStart,
            lte: prevMonthEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          hospitalId,
          startsAt: {
            gte: prevMonthStart,
            lte: prevMonthEnd,
          },
        },
      }),
    ])

    const prevMonthRefunds = await prisma.refund.aggregate({
      where: { hospitalId, refundedAt: { gte: prevMonthStart, lte: prevMonthEnd } },
      _sum: { amount: true },
    })

    const thisMonthNet = netOf(thisMonthRevenue, monthRefunds)
    const prevMonthNet = netOf(prevMonthRevenue, prevMonthRefunds)

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
      overview: {
        totalPatients,
        newPatientsThisMonth,
        patientGrowth: parseFloat(patientGrowth.toFixed(1)),
        todayAppointments,
        thisMonthAppointments,
        appointmentGrowth: parseFloat(appointmentGrowth.toFixed(1)),
        pendingAppointments,
        completedAppointmentsToday,
        ...(showsMoney && {
          thisMonthRevenue: thisMonthNet,
          todayRevenue: netOf(todayRevenue, todayRefunds),
          revenueGrowth: parseFloat(revenueGrowth.toFixed(1)),
          pendingPayments: Number(pendingPayments._sum.totalAmount || 0),
          totalRevenue: netOf(totalRevenue, allRefunds),
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
        // not, so the count stays and the revenue column goes.
        topProcedures: showsMoney
          ? topProcedures
          : topProcedures.map(({ revenue: _revenue, ...rest }: Record<string, unknown>) => rest),
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
