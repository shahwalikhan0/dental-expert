import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { clinicTimezone, localDay } from '@/lib/appointment-time'
import { seenCounts } from '@/lib/schedule'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 31

/**
 * GET — patients seen per hour, per day and per clinician.
 *
 * `from` (`YYYY-MM-DD`, default the clinic's today) and `days` (1 to 31,
 * default 1): one day for the day view, seven from the week's first day for
 * the week view. See lib/schedule.ts for what counts as seen.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const params = new URL(request.url).searchParams
    const requested = params.get('from') ?? ''
    if (requested && !DAY.test(requested)) {
      return NextResponse.json({ error: 'Give the first day as YYYY-MM-DD' }, { status: 400 })
    }
    const days = Number(params.get('days') ?? 1)
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      return NextResponse.json({ error: `Ask for between 1 and ${MAX_DAYS} days` }, { status: 400 })
    }
    const timezone = await clinicTimezone(prisma, hospitalId)
    const from = requested || localDay(new Date(), timezone)
    return NextResponse.json(await seenCounts(prisma, hospitalId, from, days, timezone))
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error counting patients seen:', error)
    return NextResponse.json({ error: 'Failed to count patients seen' }, { status: 500 })
  }
}
