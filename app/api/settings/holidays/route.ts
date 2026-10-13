import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { knownErrorResponse } from '@/lib/api-errors'
import { displayDate } from '@/lib/dates'

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A holiday is a calendar day, and the column is `@db.Date`. The schema used
 * to insist on a full ISO timestamp, so `2026-10-21` — what a date input
 * gives — was refused with zod's raw issue list (bug report 12 Oct, finding
 * 25). Both forms are taken now and reduced to `YYYY-MM-DD`; a timestamp keeps
 * its UTC day, which is the day Prisma would have stored from it anyway.
 */
const holidayDay = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const day = CALENDAR_DAY.test(value)
      ? value
      : z.iso.datetime().safeParse(value).success
        ? value.slice(0, 10)
        : null
    // `2026-02-30` matches the pattern but is not a day; round-tripping it
    // through Date shows that.
    const at = day === null ? null : new Date(`${day}T00:00:00.000Z`)
    if (day === null || !at || Number.isNaN(at.getTime()) || !at.toISOString().startsWith(day)) {
      ctx.addIssue({ code: 'custom', message: 'Enter the date as YYYY-MM-DD, e.g. 2026-10-21.' })
      return z.NEVER
    }
    return day
  })

const createHolidaySchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for the holiday.'),
  date: holidayDay,
  isRecurring: z.boolean().optional(),
})

// GET /api/settings/holidays - Get all holidays
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams
    const year = searchParams.get('year')

    const where: any = { hospitalId }

    if (year) {
      const yearNum = parseInt(year)
      where.date = {
        gte: new Date(`${yearNum}-01-01`),
        lte: new Date(`${yearNum}-12-31`),
      }
    }

    // A clinic holiday is a dated `Availability` row that closes the whole day
    // for everybody — see lib/availability.ts.
    const holidays = await prisma.availability.findMany({
      where: { ...where, staffId: null, date: where.date ?? { not: null }, isAvailable: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, date: true, isRecurring: true },
    })

    return NextResponse.json({
      success: true,
      data: holidays,
      count: holidays.length,
    })
  } catch (error) {
    console.error('Get holidays error:', error)
    return NextResponse.json({ error: 'Failed to get holidays' }, { status: 500 })
  }
}

// POST /api/settings/holidays - Create a new holiday
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const data = createHolidaySchema.parse(body)
    const isRecurring = data.isRecurring || false

    // Two holidays on one day said nothing the first did not, and showed
    // twice in the calendar (finding 51). A yearly holiday falls on its month
    // and day every year, so it clashes with anything on that month and day;
    // there are a handful of these per clinic, so they are compared here.
    const existing = await prisma.availability.findMany({
      where: {
        hospitalId,
        staffId: null,
        isAvailable: false,
        startTime: null,
        endTime: null,
        date: { not: null },
      },
      select: { name: true, date: true, isRecurring: true },
    })
    const clash = existing.find((row) => {
      if (!row.date) return false
      const stored = row.date.toISOString().slice(0, 10)
      return row.isRecurring || isRecurring
        ? stored.slice(5) === data.date.slice(5)
        : stored === data.date
    })
    if (clash) {
      const when = clash.isRecurring
        ? `every year on ${displayDate(data.date).replace(/\s*\d{4}$/, '')}`
        : `on ${displayDate(clash.date)}`
      return NextResponse.json(
        { error: `"${clash.name ?? 'A holiday'}" is already set ${when}.` },
        { status: 409 }
      )
    }

    const holiday = await prisma.availability.create({
      data: {
        name: data.name,
        date: new Date(`${data.date}T00:00:00.000Z`),
        isRecurring,
        hospitalId,
        // Nobody is bookable, and no times means the whole day.
        staffId: null,
        isAvailable: false,
      },
      select: { id: true, name: true, date: true, isRecurring: true },
    })

    return NextResponse.json({
      success: true,
      data: holiday,
      message: 'Holiday created successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Create holiday error:', error)
    return NextResponse.json({ error: 'Failed to create holiday' }, { status: 500 })
  }
}

// DELETE /api/settings/holidays?id=xxx - Delete a holiday
export async function DELETE(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Holiday ID is required' }, { status: 400 })
    }

    // `deleteMany` rather than `delete` so the clinic filter is part of the
    // statement: deleting by id alone would reach another clinic's row.
    const removed = await prisma.availability.deleteMany({
      where: { id, hospitalId, staffId: null, date: { not: null } },
    })

    if (removed.count === 0) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Holiday deleted successfully',
    })
  } catch (error) {
    console.error('Delete holiday error:', error)
    return NextResponse.json({ error: 'Failed to delete holiday' }, { status: 500 })
  }
}
