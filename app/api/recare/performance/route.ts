import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { recallPerformance } from '@/lib/recall'
import { getDateRangeFromPreset } from '@/lib/billing-utils'
import { clinicTimezone } from '@/lib/appointment-time'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/recare/performance — did working the list bring anybody back?
 *
 * Coverage (contacted ÷ due) says whether the clinic is working its list at
 * all; the booking rate (booked ÷ contacted) says whether the message is worth
 * sending. A practice that improves one without the other has learned
 * something either way.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('reports:operational')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const preset = searchParams.get('range') ?? 'this_month'

    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const range =
      from && to
        ? { startDate: new Date(from), endDate: new Date(to) }
        : // "This month" on the clinic's calendar, not the server's.
          getDateRangeFromPreset(preset, await clinicTimezone(prisma, hospitalId))

    const data = await recallPerformance(hospitalId, {
      gte: range.startDate,
      lte: range.endDate,
    })

    return NextResponse.json({
      ...data,
      range: { from: range.startDate.toISOString(), to: range.endDate.toISOString() },
    })
  } catch (cause) {
    console.error('Recall performance error:', cause)
    return NextResponse.json({ error: 'Failed to build the recall report' }, { status: 500 })
  }
}
