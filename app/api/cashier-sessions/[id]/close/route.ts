import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import {
  PAYMENT_METHODS,
  computeExpectedTotals,
  lockSessionForClose,
  reconcile,
  totalVariance,
  type CountedLine,
} from '@/lib/cashier'
import { z } from 'zod'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { BillingRefusal, billingRefusalResponse } from '@/lib/invoice-settlement'

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

    // The session row is held from before the figures are read until the
    // counts are written. A payment already writing into the till is waited
    // for, and one arriving now waits, then finds the till closed and is
    // refused (finding 38) — so nothing can land in a session after its
    // expected totals were stamped.
    const outcome = await prisma.$transaction(async (tx) => {
      await lockSessionForClose(tx, id, hospitalId)

      const session = await tx.cashierSession.findFirst({ where: { id, hospitalId } })
      if (!session) {
        throw new BillingRefusal(404, 'Cashier session not found')
      }
      // Closing twice would overwrite the first reconciliation, which is the one
      // record FR-015 exists to keep.
      if (session.status === 'CLOSED') {
        throw new BillingRefusal(409, `${session.sessionNo} was already closed`)
      }

      const expected = await computeExpectedTotals(session, tx)
      const lines = reconcile(expected, body.counts as CountedLine[])

      // Written together: a session marked closed without its counts would be
      // an unreconcilable record of a reconciliation.
      const closed = await tx.cashierSession.update({
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
      })
      await tx.cashierSessionCount.createMany({
        data: lines.map((line) => ({
          sessionId: id,
          paymentMethod: line.paymentMethod,
          expectedAmount: line.expected,
          countedAmount: line.countedAmount,
          varianceAmount: line.varianceAmount,
          notes: line.notes,
        })),
      })

      return { closed, lines }
    })

    const { closed, lines } = outcome
    const variance = totalVariance(lines)

    // Who signed the drawer off, and what they found. The counts are on the
    // session too; this puts the closing in the one trail an auditor reads.
    await recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.TILL_CLOSED,
      entityType: 'CashierSession',
      entityId: closed.id,
      oldValues: { status: 'OPEN' },
      newValues: {
        sessionNo: closed.sessionNo,
        status: 'CLOSED',
        totalVariance: variance,
        counts: lines.map((line) => ({
          method: line.paymentMethod,
          expected: line.expected,
          counted: line.countedAmount,
          variance: line.varianceAmount,
        })),
        closingNotes: closed.closingNotes,
      },
      ...requestContext(req.headers),
    })

    return NextResponse.json({
      success: true,
      data: {
        ...closed,
        totals: lines,
        totalVariance: variance,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid count' },
        { status: 400 }
      )
    }
    const known = billingRefusalResponse(err) ?? knownErrorResponse(err)
    if (known) return known
    console.error('Close cashier session error:', err)
    return NextResponse.json({ error: 'Failed to close cashier session' }, { status: 500 })
  }
}
