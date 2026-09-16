import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { clinicTimezone, withWallClock } from '@/lib/appointment-time'

// POST - Check in patient for appointment
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('appointments:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const appointment = await prisma.appointment.findFirst({
      where: { id, hospitalId },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Validate appointment status for check-in
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

    const updatedAppointment = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'CHECKED_IN',
        checkedInAt,
        waitTime,
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
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    })

    const timezone = await clinicTimezone(prisma, hospitalId)
    return NextResponse.json(withWallClock(updatedAppointment, timezone))
  } catch (error) {
    console.error('Error checking in appointment:', error)
    return NextResponse.json({ error: 'Failed to check in' }, { status: 500 })
  }
}
