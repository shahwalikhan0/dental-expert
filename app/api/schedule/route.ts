import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { clinicTimezone, localDay } from '@/lib/appointment-time'
import { clinicSchedule } from '@/lib/schedule'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 7

function addDays(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + by)
  return date.toISOString().slice(0, 10)
}

/**
 * GET — every clinician's day as slots: free, booked, blocked or gone.
 *
 * `day` (`YYYY-MM-DD`) reads another day; without it the answer is the
 * clinic's today. `days` (1 to 7, default 1) reads that many days from it,
 * for the week view. See lib/schedule.ts.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const params = new URL(request.url).searchParams
    const requested = params.get('day') ?? ''
    if (requested && !DAY.test(requested)) {
      return NextResponse.json({ error: 'Give the day as YYYY-MM-DD' }, { status: 400 })
    }
    const days = Number(params.get('days') ?? 1)
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      return NextResponse.json({ error: `Ask for between 1 and ${MAX_DAYS} days` }, { status: 400 })
    }
    const timezone = await clinicTimezone(prisma, hospitalId)
    const first = requested || localDay(new Date(), timezone)
    const schedules = await Promise.all(
      Array.from({ length: days }, (_, index) =>
        clinicSchedule(prisma, hospitalId, addDays(first, index), timezone)
      )
    )
    return NextResponse.json({ today: schedules[0].today, schedules })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error building the schedule:', error)
    return NextResponse.json({ error: 'Failed to load the schedule' }, { status: 500 })
  }
}
