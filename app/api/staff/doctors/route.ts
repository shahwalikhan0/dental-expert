import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { DENTIST_WHERE } from '@/lib/clinicians'

/**
 * GET — the dentists, for every dentist picker.
 *
 * DENTIST_WHERE rather than `user.role`, so a dentist whose DOCTOR role is the
 * second, clinical one (an owner-dentist set up as Clinic Manager) is offered
 * here as well as on the schedule and by the server's own checks (bug report
 * 16 Oct, finding 19).
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('appointments:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const doctors = await prisma.staff.findMany({
      where: { hospitalId, ...DENTIST_WHERE },
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        specialization: true,
        phone: true,
        email: true,
      },
      orderBy: { firstName: 'asc' },
    })

    return NextResponse.json({ doctors })
  } catch (error) {
    console.error('Error fetching doctors:', error)
    return NextResponse.json({ error: 'Failed to fetch doctors' }, { status: 500 })
  }
}
