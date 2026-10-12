import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { holderCan } from '@/lib/rbac'
import { clinicTimezone, localDay } from '@/lib/appointment-time'
import { parseRange } from '@/lib/attendance'
import { personalRecord } from '@/lib/attendance-records'
import { fileResponse, personalCsv, personalWorkbook, slug } from '@/lib/attendance-export'

/**
 * GET /api/attendance/[userId]/export?from=&to=&format=xlsx|csv — one person's
 * record as a file.
 *
 * Needs `reports:export` as well as the register: FR-022 restricts taking data
 * out of the application separately from reading it, and a file of somebody's
 * absences is exactly the kind of thing that ends up forwarded.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { error, hospitalId, user } = await requirePermission('attendance:read')
  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!holderCan(user, 'reports:export')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { userId } = await params
    const search = new URL(request.url).searchParams
    const format = search.get('format') === 'csv' ? 'csv' : 'xlsx'

    const today = localDay(new Date(), await clinicTimezone(prisma, hospitalId))
    const range = parseRange(search.get('from'), search.get('to'), today, 'week')
    if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 })

    const [record, hospital] = await Promise.all([
      personalRecord(hospitalId, userId, range.from, range.to),
      prisma.hospital.findUnique({ where: { id: hospitalId }, select: { name: true } }),
    ])
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const meta = {
      clinicName: hospital?.name ?? 'Clinic',
      from: range.from,
      to: range.to,
      filterLabel: record.person.name,
    }
    const filename = `attendance-${slug(record.person.name)}-${range.from}-to-${range.to}`

    return format === 'csv'
      ? fileResponse(personalCsv(record, meta), 'csv', filename)
      : fileResponse(await personalWorkbook(record, meta), 'xlsx', filename)
  } catch (cause) {
    console.error('Attendance record export error:', cause)
    return NextResponse.json({ error: 'Failed to build the file' }, { status: 500 })
  }
}
