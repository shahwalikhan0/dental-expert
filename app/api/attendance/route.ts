import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { holderCan } from '@/lib/rbac'
import { clinicTimezone, localDay } from '@/lib/appointment-time'
import {
  ATTENDANCE_STATUSES,
  DEFAULT_REGISTER_PAGE_SIZE,
  REGISTER_PAGE_SIZES,
  addDays,
  isDay,
  weekStartOf,
} from '@/lib/attendance'
import { applyMarks, loadRegister, rolesFrom } from '@/lib/attendance-records'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit'

/**
 * GET /api/attendance — the register for a week, or a day.
 *
 * `?start=2026-09-28&days=7` (the default is this week, from Monday). Everyone
 * on the register except the person asking: a manager's own attendance is
 * marked by somebody else, which is the only reason it means anything.
 *
 * Fifty people to a page at least. The register is worked down a column —
 * "who is not in today" — and a page that stopped at twenty would split the
 * front desk and the dentists across screens.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('attendance:read')
  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const params = new URL(request.url).searchParams
    const timezone = await clinicTimezone(prisma, hospitalId)
    const today = localDay(new Date(), timezone)

    const requested = params.get('start')
    if (requested && !isDay(requested)) {
      return NextResponse.json({ error: 'start must be written as YYYY-MM-DD' }, { status: 400 })
    }
    const days = params.get('days') === '1' ? 1 : 7
    // A week always opens on its Monday, whatever day was asked for, so the
    // arrows move the manager a whole week and never half of one.
    const from = days === 7 ? weekStartOf(requested ?? today) : (requested ?? today)
    const to = addDays(from, days - 1)

    const page = Math.max(1, Number(params.get('page')) || 1)
    const asked = Number(params.get('limit')) || DEFAULT_REGISTER_PAGE_SIZE
    const limit = REGISTER_PAGE_SIZES.includes(asked) ? asked : DEFAULT_REGISTER_PAGE_SIZE

    const register = await loadRegister({
      hospitalId,
      from,
      to,
      scope: 'register',
      excludeUserId: user.id,
      filters: { search: params.get('search') ?? undefined, roles: rolesFrom(params.get('role')) },
      page: { page, limit },
    })

    return NextResponse.json({
      from,
      to,
      today: register.calendar.today,
      days: register.calendar.days,
      rows: register.rows,
      pagination: { page, limit, total: register.total },
      canWrite: holderCan(user, 'attendance:write'),
    })
  } catch (cause) {
    console.error('Attendance register error:', cause)
    return NextResponse.json({ error: 'Failed to load the register' }, { status: 500 })
  }
}

const markSchema = z.object({
  userId: z.string().trim().min(1),
  date: z.string().refine(isDay, 'Dates must be written as YYYY-MM-DD'),
  status: z.enum(ATTENDANCE_STATUSES).nullable(),
  note: z.string().max(500, 'Keep the note under 500 characters').nullable().optional(),
})

const saveSchema = z.object({
  marks: z
    .array(markSchema)
    .min(1, 'Nothing to save')
    // Two hundred people for a week, with room to spare. Past this the request
    // is not a register being saved.
    .max(1500, 'Too many days in one save — save a page at a time'),
})

/** How many alterations the audit entry spells out before it summarises. */
const AUDIT_DETAIL_LIMIT = 200

/**
 * PUT /api/attendance — save marks.
 *
 * `{ marks: [{ userId, date, status: "PRESENT" | "ABSENT" | "LATE" | null, note? }] }`.
 * A null status clears the day back to its default. All or nothing: see
 * `applyMarks` for why a partly saved week is not offered.
 */
export async function PUT(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('attendance:write')
  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { marks } = saveSchema.parse(await request.json())
    const result = await applyMarks(hospitalId, user.id, marks)

    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            result.refused.length === 1
              ? result.refused[0].reason
              : `${result.refused.length} days could not be saved, so nothing was`,
          refused: result.refused,
        },
        { status: 400 }
      )
    }

    const touched = result.created + result.updated + result.cleared
    if (touched > 0) {
      // One entry per save. Creations of Present are the register being kept
      // and are counted; absences, lateness and anything altered after the fact
      // are what somebody reviewing the log is looking for, so those are named.
      void recordAudit({
        hospitalId,
        userId: user.id,
        action: AUDIT_ACTIONS.ATTENDANCE_MARKED,
        entityType: 'Attendance',
        entityId: `${touched} day${touched === 1 ? '' : 's'}`,
        oldValues: result.altered.length
          ? {
              altered: result.altered
                .slice(0, AUDIT_DETAIL_LIMIT)
                .map(({ name, date, from }) => ({ name, date, status: from })),
            }
          : undefined,
        newValues: {
          created: result.created,
          updated: result.updated,
          cleared: result.cleared,
          exceptions: result.exceptions
            .slice(0, AUDIT_DETAIL_LIMIT)
            .map(({ name, date, to }) => ({ name, date, status: to })),
          altered: result.altered
            .slice(0, AUDIT_DETAIL_LIMIT)
            .map(({ name, date, to }) => ({ name, date, status: to })),
          truncated:
            result.altered.length > AUDIT_DETAIL_LIMIT ||
            result.exceptions.length > AUDIT_DETAIL_LIMIT,
        },
      })
    }

    return NextResponse.json({
      created: result.created,
      updated: result.updated,
      cleared: result.cleared,
      unchanged: result.unchanged,
      altered: result.altered.length,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid request' },
        { status: 400 }
      )
    }
    console.error('Attendance save error:', err)
    return NextResponse.json({ error: 'Failed to save attendance' }, { status: 500 })
  }
}
