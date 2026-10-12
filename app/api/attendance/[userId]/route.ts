import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { holderCan } from '@/lib/rbac'
import { clinicTimezone, localDay } from '@/lib/appointment-time'
import { parseRange } from '@/lib/attendance'
import { personalRecord } from '@/lib/attendance-records'

/**
 * GET /api/attendance/[userId] — one person's days, `?from=&to=`.
 *
 * Defaults to the week so far. Each day says who marked it and when, because
 * the conversation this screen exists for starts with "I was not absent on
 * the ninth" and the answer is on the row.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { error, hospitalId, user } = await requirePermission('attendance:read')
  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { userId } = await params
    const search = new URL(request.url).searchParams
    const today = localDay(new Date(), await clinicTimezone(prisma, hospitalId))
    const range = parseRange(search.get('from'), search.get('to'), today, 'week')
    if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 })

    const record = await personalRecord(hospitalId, userId, range.from, range.to)
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      ...record,
      from: range.from,
      to: range.to,
      // Nobody alters their own days, whatever they may otherwise do.
      canWrite: holderCan(user, 'attendance:write') && userId !== user.id,
      canExport: holderCan(user, 'reports:export'),
    })
  } catch (cause) {
    console.error('Attendance record error:', cause)
    return NextResponse.json({ error: 'Failed to load the record' }, { status: 500 })
  }
}
