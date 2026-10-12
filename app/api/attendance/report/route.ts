import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { ROLE_LABELS, holderCan } from '@/lib/rbac'
import { clinicTimezone, localDay } from '@/lib/appointment-time'
import { DEFAULT_REGISTER_PAGE_SIZE, REGISTER_PAGE_SIZES, parseRange } from '@/lib/attendance'
import { loadRegister, rolesFrom } from '@/lib/attendance-records'
import { fileResponse, registerCsv, registerWorkbook } from '@/lib/attendance-export'

/**
 * GET /api/attendance/report — the register over any range.
 *
 * `?from=&to=&role=DOCTOR,RECEPTIONIST&search=`, plus `format`:
 *
 *  - `json` (the default) — one page of people with their totals, for the
 *    report screen's preview;
 *  - `xlsx` / `csv` — everybody who matches, a column per day, as a file.
 *
 * Unlike the register, the person asking is included — a report is about the
 * clinic, and the manager is on its staff — and so is anybody who has left
 * but has days inside the range.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('attendance:read')
  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const search = new URL(request.url).searchParams
    const format = search.get('format')
    const wantsFile = format === 'csv' || format === 'xlsx'

    if (wantsFile && !holderCan(user, 'reports:export')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const today = localDay(new Date(), await clinicTimezone(prisma, hospitalId))
    const range = parseRange(search.get('from'), search.get('to'), today)
    if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 })

    const roles = rolesFrom(search.get('role'))
    const filters = { search: search.get('search') ?? undefined, roles }

    if (wantsFile) {
      const [register, hospital] = await Promise.all([
        loadRegister({ hospitalId, ...range, scope: 'report', filters }),
        prisma.hospital.findUnique({ where: { id: hospitalId }, select: { name: true } }),
      ])
      const meta = {
        clinicName: hospital?.name ?? 'Clinic',
        ...range,
        filterLabel: roles.length ? roles.map((role) => ROLE_LABELS[role]).join(', ') : 'All roles',
      }
      const filename = `attendance-${range.from}-to-${range.to}`
      return format === 'csv'
        ? fileResponse(registerCsv(register, meta), 'csv', filename)
        : fileResponse(await registerWorkbook(register, meta), 'xlsx', filename)
    }

    const page = Math.max(1, Number(search.get('page')) || 1)
    const asked = Number(search.get('limit')) || DEFAULT_REGISTER_PAGE_SIZE
    const limit = REGISTER_PAGE_SIZES.includes(asked) ? asked : DEFAULT_REGISTER_PAGE_SIZE

    const register = await loadRegister({
      hospitalId,
      ...range,
      scope: 'report',
      filters,
      page: { page, limit },
    })

    return NextResponse.json({
      ...range,
      today: register.calendar.today,
      workingDays: register.calendar.days.filter((day) => !day.closed && day.date <= today).length,
      // The preview needs the totals, not a column per day: drop the cells so
      // a year's report for a page of people is not a megabyte of JSON.
      rows: register.rows.map(({ cells: _cells, ...row }) => row),
      pagination: { page, limit, total: register.total },
      canExport: holderCan(user, 'reports:export'),
    })
  } catch (cause) {
    console.error('Attendance report error:', cause)
    return NextResponse.json({ error: 'Failed to build the report' }, { status: 500 })
  }
}
