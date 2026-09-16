import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { subDays, subMonths } from 'date-fns'
import { clinicTimezone, dayRangeIn, localDay, wallClockIn } from '@/lib/appointment-time'

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
  const { error, hospitalId } = await requirePermission('reports:operational')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
            status: 'COMPLETED',
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
            status: 'COMPLETED',
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
            status: 'COMPLETED',
          },
          _sum: {
            amount: true,
          },
        }),

        // Last 7 days revenue (daily breakdown)
        prisma.$queryRaw`
        SELECT
          DATE("createdAt") as "date",
          COALESCE(SUM(amount), 0)::numeric(10,2) as "revenue"
        FROM "Payment"
        WHERE "createdAt" >= ${last7DaysStart}
        AND status = 'COMPLETED'
        AND "hospitalId" = ${hospitalId}
        GROUP BY DATE("createdAt")
        ORDER BY "date" ASC
      `,

        // Last 6 months revenue (monthly breakdown)
        prisma.$queryRaw`
        SELECT
          to_char("createdAt", 'YYYY-MM') as "month",
          COALESCE(SUM(amount), 0)::numeric(10,2) as "revenue"
        FROM "Payment"
        WHERE "createdAt" >= ${last6MonthsStart}
        AND status = 'COMPLETED'
        AND "hospitalId" = ${hospitalId}
        GROUP BY to_char("createdAt", 'YYYY-MM')
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
            patient: {
              select: {
                firstName: true,
                lastName: true,
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
      throw new Error(`Database query failed: ${queryError.message}`)
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
          status: 'COMPLETED',
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

    const revenueGrowth = prevMonthRevenue._sum.amount
      ? ((Number(thisMonthRevenue._sum.amount || 0) - Number(prevMonthRevenue._sum.amount)) /
          Number(prevMonthRevenue._sum.amount)) *
        100
      : 0

    const patientGrowth = prevMonthPatients
      ? ((newPatientsThisMonth - prevMonthPatients) / prevMonthPatients) * 100
      : 0

    const appointmentGrowth = prevMonthAppointments
      ? ((thisMonthAppointments - prevMonthAppointments) / prevMonthAppointments) * 100
      : 0

    // Format response
    const stats = {
      overview: {
        totalPatients,
        newPatientsThisMonth,
        patientGrowth: parseFloat(patientGrowth.toFixed(1)),
        todayAppointments,
        thisMonthAppointments,
        appointmentGrowth: parseFloat(appointmentGrowth.toFixed(1)),
        pendingAppointments,
        completedAppointmentsToday,
        thisMonthRevenue: Number(thisMonthRevenue._sum.amount || 0),
        todayRevenue: Number(todayRevenue._sum.amount || 0),
        revenueGrowth: parseFloat(revenueGrowth.toFixed(1)),
        pendingPayments: Number(pendingPayments._sum.totalAmount || 0),
        totalRevenue: Number(totalRevenue._sum.amount || 0),
      },
      charts: {
        last7DaysRevenue,
        last6MonthsRevenue,
        appointmentsByStatus: appointmentsByStatus.map((item: any) => ({
          status: item.status,
          count: item._count.status,
        })),
        topProcedures,
      },
      recentActivity: {
        upcomingAppointments: recentAppointments.map((apt: any) => ({
          id: apt.id,
          patientName: `${apt.patient.firstName} ${apt.patient.lastName}`,
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
    console.error('Dashboard stats error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      meta: error.meta,
    })
    return NextResponse.json(
      {
        error: 'Failed to fetch dashboard statistics',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      { status: 500 }
    )
  }
}
