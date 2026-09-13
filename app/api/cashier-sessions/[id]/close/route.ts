import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import {
  PAYMENT_METHODS,
  computeExpectedTotals,
  reconcile,
  totalVariance,
  type CountedLine,
} from '@/lib/cashier'
import { z } from 'zod'

/**
 * POST /api/cashier-sessions/[id]/close — FR-015's reconciliation and variance
 * record.
 *
 * `billing:closing`, which reception does not hold: the person who took the
 * money is not the person who signs off on what is in the drawer. ADMIN,
 * CLINIC_MANAGER and ACCOUNTANT can close.
 */

const closeSchema = z.object({
  counts: z
    .array(
      z.object({
        paymentMethod: z.enum(PAYMENT_METHODS),
        countedAmount: z.number().min(0).max(100_000_000),
        notes: z.string().trim().max(300).optional().nullable(),
      })
    )
    .max(PAYMENT_METHODS.length),
  closingNotes: z.string().trim().max(1000).optional().nullable(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('billing:closing')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = closeSchema.parse(await req.json())

    // A method counted twice would silently drop one of the figures.
    const seen = new Set<string>()
    for (const line of body.counts) {
      if (seen.has(line.paymentMethod)) {
        return NextResponse.json(
          { error: `${line.paymentMethod} was counted more than once` },
          { status: 400 }
        )
      }
      seen.add(line.paymentMethod)
    }

    const session = await prisma.cashierSession.findFirst({ where: { id, hospitalId } })
    if (!session) {
      return NextResponse.json({ error: 'Cashier session not found' }, { status: 404 })
    }
    // Closing twice would overwrite the first reconciliation, which is the one
    // record FR-015 exists to keep.
    if (session.status === 'CLOSED') {
      return NextResponse.json(
        { error: `${session.sessionNo} was already closed` },
        { status: 409 }
      )
    }

    const expected = await computeExpectedTotals(session)
    const lines = reconcile(expected, body.counts as CountedLine[])

    // Written together: a session marked closed without its counts would be an
    // unreconcilable record of a reconciliation.
    const [closed] = await prisma.$transaction([
      prisma.cashierSession.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: user.id,
          closingNotes: body.closingNotes || null,
        },
        include: {
          openedBy: { select: { id: true, name: true } },
          closedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.cashierSessionCount.createMany({
        data: lines.map((line) => ({
          sessionId: id,
          paymentMethod: line.paymentMethod,
          expectedAmount: line.expected,
          countedAmount: line.countedAmount,
          varianceAmount: line.varianceAmount,
          notes: line.notes,
        })),
      }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        ...closed,
        totals: lines,
        totalVariance: totalVariance(lines),
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid count' },
        { status: 400 }
      )
    }
    console.error('Close cashier session error:', err)
    return NextResponse.json({ error: 'Failed to close cashier session' }, { status: 500 })
  }
}
