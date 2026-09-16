import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { clinicTimezone, dayRangeIn, localDay, withWallClock } from '@/lib/appointment-time'

// GET - Get today's appointments for queue management
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const doctorId = searchParams.get('doctorId') || ''

    // "Today" is the clinic's today. On a host running in UTC, a Karachi
    // clinic's morning belongs to the server's previous day for its first five
    // hours, and the queue used to empty itself at 05:00 local.
    const timezone = await clinicTimezone(prisma, hospitalId)
    const where: any = {
      hospitalId,
      startsAt: dayRangeIn(localDay(new Date(), timezone), timezone),
    }

    if (doctorId) {
      where.doctorId = doctorId
    }

    const rows = await prisma.appointment.findMany({
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
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
      orderBy: { startsAt: 'asc' },
    })

    const appointments = rows.map((a) => withWallClock(a, timezone))

    // Group appointments by status for queue view
    const waiting = appointments.filter((a) => a.status === 'CHECKED_IN')
    const inProgress = appointments.filter((a) => a.status === 'IN_PROGRESS')
    const upcoming = appointments.filter((a) => ['SCHEDULED', 'CONFIRMED'].includes(a.status))
    const completed = appointments.filter((a) => a.status === 'COMPLETED')
    const noShow = appointments.filter((a) => a.status === 'NO_SHOW')
    const cancelled = appointments.filter((a) => a.status === 'CANCELLED')

    // Calculate stats
    const stats = {
      total: appointments.length,
      waiting: waiting.length,
      inProgress: inProgress.length,
      upcoming: upcoming.length,
      completed: completed.length,
      noShow: noShow.length,
      cancelled: cancelled.length,
      avgWaitTime:
        waiting.length > 0
          ? Math.round(waiting.reduce((acc, a) => acc + (a.waitTime || 0), 0) / waiting.length)
          : 0,
    }

    return NextResponse.json({
      appointments,
      queue: {
        waiting,
        inProgress,
        upcoming,
        completed,
        noShow,
        cancelled,
      },
      stats,
    })
  } catch (error) {
    console.error("Error fetching today's appointments:", error)
    return NextResponse.json({ error: "Failed to fetch today's appointments" }, { status: 500 })
  }
}
