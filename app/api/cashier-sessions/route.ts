import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { computeExpectedTotals, generateSessionNo, getOpenSession } from '@/lib/cashier'
import { z } from 'zod'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

/**
 * Cashier sessions — the till behind FR-015's daily closing.
 *
 * Opening is `billing:write`, not `billing:closing`: the person who opens the
 * drawer is the one taking payments, which is reception. Counting it down and
 * recording the variance is the supervisory act, and lives on the close route
 * under `billing:closing`.
 */

const openSessionSchema = z.object({
  openingFloat: z.number().min(0).max(10_000_000).optional(),
  openingNotes: z.string().trim().max(500).optional().nullable(),
})

// GET /api/cashier-sessions — list sessions, newest first
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const status = req.nextUrl.searchParams.get('status')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30, 100)

    const sessions = await prisma.cashierSession.findMany({
      where: { hospitalId, ...(status === 'OPEN' || status === 'CLOSED' ? { status } : {}) },
      orderBy: { openedAt: 'desc' },
      take: limit,
      include: {
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
        counts: true,
        _count: { select: { payments: true, refunds: true } },
      },
    })

    return NextResponse.json({ success: true, data: sessions, count: sessions.length })
  } catch (err) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('List cashier sessions error:', err)
    return NextResponse.json({ error: 'Failed to list cashier sessions' }, { status: 500 })
  }
}

// POST /api/cashier-sessions — open the till
export async function POST(req: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('billing:write')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const data = openSessionSchema.parse(body ?? {})

    // One open till per clinic. A second one would split the day's takings
    // across two reconciliations and leave neither able to balance.
    //
    // Checked and created under a lock on the clinic's row, so two people
    // pressing "Open till" at the same moment cannot both find none open now
    // that there is a screen to press it on (finding 38). `FOR NO KEY UPDATE`
    // rather than `FOR UPDATE`: it still queues the two openings, but does not
    // hold up every insert elsewhere that only references the clinic.
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Hospital" WHERE "id" = ${hospitalId} FOR NO KEY UPDATE
      `
      const existing = await getOpenSession(hospitalId, { db: tx })
      if (existing) return { existing, session: null }

      // The number is drawn in the same transaction as the row it names, so a
      // failed insert gives it back rather than leaving a gap (finding 68).
      const session = await tx.cashierSession.create({
        data: {
          hospitalId,
          sessionNo: await generateSessionNo(hospitalId, tx),
          openingFloat: data.openingFloat ?? 0,
          openingNotes: data.openingNotes || null,
          openedById: user.id,
        },
        include: { openedBy: { select: { id: true, name: true } } },
      })
      return { existing: null, session }
    })

    const { existing, session } = outcome
    if (!session) {
      return NextResponse.json(
        {
          error: `A cashier session (${existing?.sessionNo}) is already open. Close it before opening another.`,
          session: existing,
        },
        { status: 409 }
      )
    }

    await recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.TILL_OPENED,
      entityType: 'CashierSession',
      entityId: session.id,
      newValues: {
        sessionNo: session.sessionNo,
        openingFloat: Number(session.openingFloat),
        openingNotes: session.openingNotes,
      },
      ...requestContext(req.headers),
    })

    return NextResponse.json(
      { success: true, data: { ...session, totals: await computeExpectedTotals(session) } },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid session' },
        { status: 400 }
      )
    }
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Open cashier session error:', err)
    return NextResponse.json({ error: 'Failed to open cashier session' }, { status: 500 })
  }
}
