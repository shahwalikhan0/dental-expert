import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { clinicTimezone, withWallClock } from '@/lib/appointment-time'
import { issueToken } from '@/lib/tokens'

/**
 * POST — the patient has arrived.
 *
 * This is where a token is minted. Not at booking: a number handed out three
 * weeks ahead records the order bookings were made in, which is not the order
 * anybody will be seen in. Arrival order is the queue the clinic actually runs,
 * so arrival is what issues the number.
 *
 * Checking in twice does not issue a second token. The desk clicking the button
 * again because the first click did not visibly do anything must not renumber
 * somebody who is already sitting in the waiting room.
 */

/** Two receptionists pressing the button in the same second. */
const MAX_TOKEN_ATTEMPTS = 5

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('appointments:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const timezone = await clinicTimezone(prisma, hospitalId)

    const appointment = await prisma.appointment.findFirst({
      where: { id, hospitalId },
      select: { id: true, status: true, startsAt: true, tokenNumber: true },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    if (!['SCHEDULED', 'CONFIRMED'].includes(appointment.status)) {
      return NextResponse.json(
        { error: `Cannot check in appointment with status: ${appointment.status}` },
        { status: 400 }
      )
    }

    const checkedInAt = new Date()

    // How late the patient is. This used to rebuild the moment out of a date
    // column and an `HH:MM` string using `setHours`, which applies the
    // *server's* timezone — so on a host in UTC every Karachi patient looked
    // five hours late.
    const waitTime = Math.max(
      0,
      Math.round((checkedInAt.getTime() - appointment.startsAt.getTime()) / 60000)
    )

    const include = {
      patient: {
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
      visitor: { select: { id: true, name: true, phone: true } },
      doctor: { select: { id: true, firstName: true, lastName: true } },
    }

    // `tokenNumber` is unique per clinic, so two check-ins racing for the same
    // number cannot both succeed: the loser hits the unique index and asks for
    // the next one. Retrying beats serialising every arrival behind a lock —
    // the collision is rare and the retry is one more read.
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
      const tokenNumber =
        appointment.tokenNumber ?? (await issueToken(prisma, hospitalId, timezone, checkedInAt))

      try {
        const updated = await prisma.appointment.update({
          where: { id },
          data: {
            status: 'CHECKED_IN',
            checkedInAt,
            waitTime,
            tokenNumber,
            tokenIssuedAt: appointment.tokenNumber ? undefined : checkedInAt,
          },
          include,
        })

        return NextResponse.json(withWallClock(updated, timezone))
      } catch (err) {
        const raced =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          !appointment.tokenNumber
        if (!raced) throw err
      }
    }

    // Five collisions in a row is not contention, it is something wrong.
    return NextResponse.json(
      { error: 'Could not issue a token — please try again' },
      { status: 503 }
    )
  } catch (error) {
    console.error('Error checking in appointment:', error)
    return NextResponse.json({ error: 'Failed to check in' }, { status: 500 })
  }
}
