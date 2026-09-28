import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { bandFilter, dueBand, nextDueDate, type DueBand } from '@/lib/recare'
import { RECALL_COOLDOWN_DAYS } from '@/lib/recall'

const BANDS: DueBand[] = ['OVERDUE', 'DUE_SOON', 'UPCOMING', 'SNOOZED', 'NOT_DUE']

/**
 * GET — the recall list.
 *
 * The question the whole module exists to answer: who should be in the chair
 * and is not booked. `band` narrows it the way a practice works it — overdue
 * first, then this month.
 *
 * Counts for every band come back alongside the page, because a list that
 * cannot say how many are overdue is a list nobody trusts enough to work.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const band = (searchParams.get('band') || 'OVERDUE') as DueBand
    const typeId = searchParams.get('typeId') || ''
    const search = searchParams.get('search')?.trim() || ''
    /**
     * `no` hides anybody already chased inside the cooling-off period, which
     * is what makes the list workable a second time in the same fortnight.
     * `yes` is the other half of the same question — who has been written to
     * and has still not booked.
     */
    const contacted = searchParams.get('contacted') || ''
    const sort = searchParams.get('sort') || 'dueDate'
    const direction = searchParams.get('direction') === 'desc' ? 'desc' : 'asc'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')))

    if (!BANDS.includes(band)) {
      return NextResponse.json({ error: `Unknown band "${band}"` }, { status: 400 })
    }

    const today = new Date()
    const cooledOffAt = new Date(today.getTime() - RECALL_COOLDOWN_DAYS * 86400000)

    const base = {
      hospitalId,
      status: 'ACTIVE' as const,
      ...(typeId ? { recareTypeId: typeId } : {}),
      ...(contacted === 'no'
        ? { OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: cooledOffAt } }] }
        : {}),
      ...(contacted === 'yes' ? { lastContactedAt: { gte: cooledOffAt } } : {}),
      ...(search
        ? {
            patient: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' as const } },
                { lastName: { contains: search, mode: 'insensitive' as const } },
                { phone: { contains: search } },
                { patientId: { contains: search, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    }

    const orderBy =
      sort === 'patient'
        ? { patient: { firstName: direction as 'asc' | 'desc' } }
        : sort === 'lastDone'
          ? { lastDoneAt: direction as 'asc' | 'desc' }
          : { dueDate: direction as 'asc' | 'desc' }

    const where = { AND: [base, bandFilter(band, today)] }

    const [rows, total, bandCounts] = await Promise.all([
      prisma.recare.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          recareType: { select: { id: true, name: true, intervalMonths: true } },
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              // So the list can grey out somebody who cannot be contacted
              // rather than letting the desk select them and be told
              // afterwards.
              communicationPrefs: true,
            },
          },
        },
      }),
      prisma.recare.count({ where }),
      Promise.all(
        BANDS.map(async (b) => ({
          band: b,
          count: await prisma.recare.count({ where: { AND: [base, bandFilter(b, today)] } }),
        }))
      ),
    ])

    return NextResponse.json({
      recares: rows.map((row) => ({ ...row, band: dueBand(row, today) })),
      counts: Object.fromEntries(bandCounts.map((c) => [c.band, c.count])),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('Error listing recare:', err)
    return NextResponse.json({ error: 'Failed to load the recall list' }, { status: 500 })
  }
}

/** POST — put a patient on a recare, or move the one they already have. */
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { patientId, recareTypeId, dueDate, notes } = body

    if (!patientId || !recareTypeId) {
      return NextResponse.json(
        { error: 'A patient and a recare type are required' },
        { status: 400 }
      )
    }

    const [patient, type] = await Promise.all([
      prisma.patient.findFirst({ where: { id: patientId, hospitalId }, select: { id: true } }),
      prisma.recareType.findFirst({
        where: { id: recareTypeId, hospitalId },
        select: { id: true, intervalMonths: true },
      }),
    ])

    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    if (!type) return NextResponse.json({ error: 'Recare type not found' }, { status: 404 })

    const due = dueDate ? new Date(dueDate) : nextDueDate(new Date(), type.intervalMonths)

    const recare = await prisma.recare.upsert({
      where: { patientId_recareTypeId: { patientId, recareTypeId } },
      update: { dueDate: due, notes: notes ?? undefined, status: 'ACTIVE' },
      create: { hospitalId, patientId, recareTypeId, dueDate: due, notes: notes ?? null },
      include: { recareType: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ recare }, { status: 201 })
  } catch (err) {
    console.error('Error creating recare:', err)
    return NextResponse.json({ error: 'Failed to save the recare' }, { status: 500 })
  }
}
