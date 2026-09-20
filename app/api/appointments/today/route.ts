import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { clinicTimezone, dayRangeIn, localDay, withWallClock } from '@/lib/appointment-time'

/**
 * GET — the day, for the queue screen.
 *
 * `date` reads a different day, which is what a calendar needs; without it the
 * answer is the clinic's today.
 *
 * Those waiting come back in token order, not appointment order. The token is
 * arrival order, and arrival order is who gets called next — a waiting room
 * sorted by who was *booked* first calls the person who has been sitting there
 * longest second.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const doctorId = searchParams.get('doctorId') || ''
    const requestedDate = searchParams.get('date') || ''

    // "Today" is the clinic's today. On a host running in UTC, a Karachi
    // clinic's morning belongs to the server's previous day for its first five
    // hours, and the queue used to empty itself at 05:00 local.
    const timezone = await clinicTimezone(prisma, hospitalId)
    const day = requestedDate || localDay(new Date(), timezone)
    const where: any = {
      hospitalId,
      startsAt: dayRangeIn(day, timezone),
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
        visitor: {
          select: { id: true, name: true, phone: true, convertedPatientId: true },
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
    // Waiting is a queue, so it is ordered by the number people were given at
    // the door. Everything else stays in appointment order.
    const byToken = (a: { tokenNumber: string | null }, b: { tokenNumber: string | null }) =>
      (a.tokenNumber ?? '').localeCompare(b.tokenNumber ?? '')

    const waiting = appointments.filter((a) => a.status === 'CHECKED_IN').sort(byToken)
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
      day,
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
