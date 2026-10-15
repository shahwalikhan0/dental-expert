import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { ASSISTANT_WHERE } from '@/lib/clinicians'

/**
 * GET — the dental assistants who can be put on a booking.
 *
 * The "Assisted by" picker on the appointment forms reads this, so it offers
 * exactly the people the appointment routes accept: `ASSISTANT_WHERE` is the
 * rule `findAssistant` checks a submitted id against. A list built on a
 * looser rule would offer somebody the save then refuses.
 */
export async function GET() {
  const { error, hospitalId } = await requirePermission('appointments:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const assistants = await prisma.staff.findMany({
      where: { hospitalId, ...ASSISTANT_WHERE },
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
      },
      orderBy: { firstName: 'asc' },
    })

    return NextResponse.json({ assistants })
  } catch (error) {
    console.error('Error fetching assistants:', error)
    return NextResponse.json({ error: 'Failed to fetch assistants' }, { status: 500 })
  }
}
