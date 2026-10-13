import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DENTIST_WHERE } from '@/lib/clinicians'

/**
 * GET: Public endpoint — list active doctors for a hospital by slug.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    const hospital = await prisma.hospital.findUnique({
      where: { slug },
      select: { id: true, name: true, patientPortalEnabled: true },
    })

    if (!hospital) {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
    }

    if (!hospital.patientPortalEnabled) {
      return NextResponse.json({ error: 'Online booking is not enabled' }, { status: 403 })
    }

    const doctors = await prisma.staff.findMany({
      // The same people the desk can book — see lib/clinicians.ts. The account
      // being active matters too: a deactivated dentist's staff row can outlive
      // their sign-in.
      where: { hospitalId: hospital.id, ...DENTIST_WHERE },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        specialization: true,
      },
      orderBy: { firstName: 'asc' },
    })

    return NextResponse.json({ doctors, hospitalName: hospital.name })
  } catch (err: unknown) {
    console.error('Public doctors error:', err)
    return NextResponse.json({ error: 'Failed to fetch doctors' }, { status: 500 })
  }
}
