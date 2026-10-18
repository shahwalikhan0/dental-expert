import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { clinicTimezone, dayRangeIn, localDay, withWallClock } from '@/lib/appointment-time'
import { averageWait, waitingFor } from '@/lib/appointment-wait'
import { readAppointmentSettings } from '@/lib/appointment-settings'
import { knownErrorResponse } from '@/lib/api-errors'

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
    const [timezone, settings] = await Promise.all([
      clinicTimezone(prisma, hospitalId),
      readAppointmentSettings(prisma, hospitalId),
    ])
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
        // Whether a bill for the visit still stands (review 4.3), so the
        // queue can offer "Create invoice" on a finished visit that has none
        // and not on one already billed. A cancelled invoice does not count.
        _count: {
          select: { invoices: { where: { status: { not: 'CANCELLED' } } } },
        },
      },
      orderBy: { startsAt: 'asc' },
    })

    /**
     * How long each patient has waited, in minutes.
     *
     * For somebody still in the waiting room it is how long they have been
     * sitting there so far — now minus check-in. For somebody already called
     * in it is the wait recorded at that moment. It used to be how late they
     * had arrived, written at check-in (bug report 12 Oct, finding 32), so a
     * patient who walked in an hour late and was seen at once showed an hour,
     * and one who had sat there all morning showed nothing.
     */
    const now = new Date()
    const appointments = rows.map(({ _count, ...a }) => ({
      ...withWallClock(a, timezone),
      waitMinutes: a.status === 'CHECKED_IN' ? waitingFor(a.checkedInAt, now) : a.waitTime,
      invoiced: _count.invoices > 0,
    }))

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
      // How long the people in the waiting room right now have been there,
      // on average.
      avgWaitTime:
        waiting.length > 0
          ? Math.round(waiting.reduce((acc, a) => acc + (a.waitMinutes ?? 0), 0) / waiting.length)
          : 0,
      // And how long those called in today waited, check-in to call-in.
      avgSeenWaitTime: averageWait(appointments),
    }

    return NextResponse.json({
      appointments,
      day,
      // The day book draws its rows at the clinic's slot length, so a cell is
      // a time the booking form will actually offer.
      slotMinutes: settings.slotDuration,
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
    const known = knownErrorResponse(error)
    if (known) return known
    console.error("Error fetching today's appointments:", error)
    return NextResponse.json({ error: "Failed to fetch today's appointments" }, { status: 500 })
  }
}
