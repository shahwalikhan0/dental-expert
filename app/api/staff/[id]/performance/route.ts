import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { knownErrorResponse } from '@/lib/api-errors'
import { averageWait } from '@/lib/appointment-wait'
import { requirePermission } from '@/lib/api-helpers'
import { parseRange } from '@/lib/attendance'
import { personalRecord } from '@/lib/attendance-records'
import { localDay, clinicTimezone, dayRangeIn } from '@/lib/appointment-time'
import { invoicedLines } from '@/lib/invoiced'
import { money } from '@/lib/invoice-figures'

// GET - Get staff member's performance statistics
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('staff:hr')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // The period is a run of clinic days, this month to today by default. The
    // dates were parsed as UTC midnights and compared with `lte`, which left
    // the whole last day out and started the first five hours late in Karachi
    // (bug report 16 Oct, finding 12). Now each bound is a clinic midnight and
    // the end is the start of the day after, exclusive — as on the reports.
    const timezone = await clinicTimezone(prisma, hospitalId)
    const today = localDay(new Date(), timezone)
    const range = parseRange(startDate, endDate, today)
    if ('error' in range) {
      return NextResponse.json({ error: range.error }, { status: 400 })
    }
    const window = {
      gte: dayRangeIn(range.from, timezone).gte,
      lt: dayRangeIn(range.to, timezone).lt,
    }

    // Get staff info - scoped to hospital
    const staff = await prisma.staff.findFirst({
      where: { id, hospitalId },
      include: {
        user: {
          select: {
            role: true,
          },
        },
      },
    })

    if (!staff) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    // Get appointments stats
    const appointments = await prisma.appointment.findMany({
      where: {
        hospitalId,
        doctorId: id,
        startsAt: window,
      },
      select: {
        id: true,
        status: true,
        startsAt: true,
        waitTime: true,
      },
    })

    const appointmentStats = {
      total: appointments.length,
      completed: appointments.filter((a) => a.status === 'COMPLETED').length,
      cancelled: appointments.filter((a) => a.status === 'CANCELLED').length,
      noShow: appointments.filter((a) => a.status === 'NO_SHOW').length,
      // Check-in until called in, over this dentist's patients who were
      // called in — the same figure Reports → Operational shows. This skipped
      // a wait of 0, the best case, and read `waitTime` when it still held how
      // late the patient had arrived (bug report 12 Oct, finding 32).
      avgWaitTime: averageWait(appointments),
    }

    // Get treatments stats
    const treatments = await prisma.treatment.findMany({
      where: {
        hospitalId,
        doctorId: id,
        createdAt: window,
      },
      select: {
        id: true,
        status: true,
        procedure: {
          select: {
            category: true,
            name: true,
          },
        },
      },
    })

    const treatmentStats = {
      total: treatments.length,
      completed: treatments.filter((t) => t.status === 'COMPLETED').length,
      inProgress: treatments.filter((t) => t.status === 'IN_PROGRESS').length,
      cancelled: treatments.filter((t) => t.status === 'CANCELLED').length,
    }

    // Revenue is what was invoiced for this dentist's treatments in the
    // period, as Reports → Staff productivity counts it (lib/invoiced.ts). It
    // was the list price of every treatment completed, billed or not.
    const lines = (await invoicedLines(hospitalId, window)).filter((line) => line.doctor?.id === id)
    const totalRevenue = money(lines.reduce((sum, line) => sum + line.amount, 0))
    const treatmentsBilled = new Set(lines.map((line) => line.treatmentId)).size

    // Procedure breakdown: how many were completed, and what was invoiced.
    const procedureBreakdown: Record<string, { count: number; revenue: number }> = {}
    const categoryRow = (category: string) =>
      (procedureBreakdown[category] ??= { count: 0, revenue: 0 })
    for (const t of treatments) {
      if (t.status === 'COMPLETED') categoryRow(t.procedure.category).count++
    }
    for (const line of lines) {
      if (!line.procedure) continue
      const row = categoryRow(line.procedure.category)
      row.revenue = money(row.revenue + line.amount)
    }

    // Get unique patients treated
    const uniquePatients = await prisma.treatment.groupBy({
      by: ['patientId'],
      where: {
        hospitalId,
        doctorId: id,
        createdAt: window,
        status: 'COMPLETED',
      },
    })

    // Get prescriptions count
    const prescriptionsCount = await prisma.prescription.count({
      where: {
        hospitalId,
        doctorId: id,
        createdAt: window,
      },
    })

    // From the attendance register — the same figures the person's attendance
    // record shows. The page used to read an `attendance` block this route
    // stopped sending when the old attendance model went (39fdd2e), and
    // crashed on every open. Null when the person has never signed in (they
    // are not on the register).
    const record = await personalRecord(hospitalId, staff.userId, range.from, range.to)
    const attendance = record
      ? {
          userId: staff.userId,
          present: record.summary.present,
          late: record.summary.late,
          absent: record.summary.absent,
          totalAbsent: record.summary.totalAbsent,
          unmarked: record.summary.unmarked,
          rate: record.summary.rate,
        }
      : null

    return NextResponse.json({
      attendance,
      staff: {
        id: staff.id,
        employeeId: staff.employeeId,
        name: `${staff.firstName} ${staff.lastName}`,
        role: staff.user.role,
        specialization: staff.specialization,
      },
      period: {
        start: range.from,
        end: range.to,
      },
      appointments: appointmentStats,
      treatments: treatmentStats,
      revenue: {
        total: totalRevenue,
        averagePerTreatment: treatmentsBilled > 0 ? Math.round(totalRevenue / treatmentsBilled) : 0,
      },
      procedureBreakdown: Object.entries(procedureBreakdown).map(([category, data]) => ({
        category,
        ...data,
      })),
      patientsTreated: uniquePatients.length,
      prescriptionsWritten: prescriptionsCount,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching performance:', error)
    return NextResponse.json({ error: 'Failed to fetch performance statistics' }, { status: 500 })
  }
}
