import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { localDay } from '@/lib/appointment-time'
import { bookableDays, readBookingSettings } from '@/lib/booking/rules'
import { DENTIST_WHERE } from '@/lib/clinicians'

/**
 * GET /api/public/[slug]/booking — everything the booking page needs to render.
 *
 * One request rather than three, because this is the first thing a patient's
 * phone loads and each round trip on a bad connection is a second of blank
 * screen.
 *
 * What it will not return is as deliberate as what it will. No email address,
 * no patient counts, no staff beyond the dentists' names and specialities, no
 * indication of how busy the clinic is. Everything here is what a clinic prints
 * on a signboard.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    const hospital = await prisma.hospital.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        logo: true,
        phone: true,
        address: true,
        city: true,
        timezone: true,
        isActive: true,
        patientPortalEnabled: true,
      },
    })

    // The same 404 for "no such clinic" and "deactivated clinic". Telling them
    // apart would confirm which slugs exist.
    if (!hospital || !hospital.isActive) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (!hospital.patientPortalEnabled) {
      return NextResponse.json(
        {
          clinic: { name: hospital.name, logo: hospital.logo, phone: hospital.phone },
          bookingEnabled: false,
        },
        { status: 200 }
      )
    }

    // The same dentists the slots and booking routes accept, a second,
    // clinical DOCTOR role included (bug report 16 Oct, finding 19).
    const dentists = await prisma.staff.findMany({
      where: { hospitalId: hospital.id, ...DENTIST_WHERE },
      select: { id: true, firstName: true, lastName: true, specialization: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })

    const settings = await readBookingSettings(prisma, hospital.id)
    const days = bookableDays(settings, (at) => localDay(at, hospital.timezone))

    return NextResponse.json({
      clinic: {
        name: hospital.name,
        logo: hospital.logo,
        phone: hospital.phone,
        address: [hospital.address, hospital.city].filter(Boolean).join(', ') || null,
        timezone: hospital.timezone,
      },
      bookingEnabled: true,
      dentists: dentists.map((dentist) => ({
        id: dentist.id,
        name: `Dr. ${dentist.firstName} ${dentist.lastName}`.trim(),
        specialization: dentist.specialization,
      })),
      window: {
        first: days.first,
        last: days.last,
        minimumNoticeHours: settings.minimumNoticeHours,
      },
    })
  } catch (error) {
    console.error('Public booking config failed:', error)
    return NextResponse.json({ error: 'Failed to load the clinic' }, { status: 500 })
  }
}
