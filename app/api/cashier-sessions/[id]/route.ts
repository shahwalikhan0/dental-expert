import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { computeExpectedTotals } from '@/lib/cashier'

/**
 * GET /api/cashier-sessions/[id]
 *
 * While the session is open the per-method totals are computed live, so the
 * cashier can see what the drawer should hold at any point. Once closed they
 * come from the stamped `counts` rows instead — a reconciliation records what
 * was found at the time, and recomputing it would let yesterday's closing
 * change under a correction made today.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const session = await prisma.cashierSession.findFirst({
      where: { id, hospitalId },
      include: {
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
        counts: { orderBy: { paymentMethod: 'asc' } },
        payments: {
          select: {
            id: true,
            paymentNo: true,
            amount: true,
            paymentMethod: true,
            paymentDate: true,
            status: true,
            invoice: { select: { invoiceNo: true } },
          },
          orderBy: { paymentDate: 'asc' },
        },
        refunds: {
          select: {
            id: true,
            refundNo: true,
            amount: true,
            refundMethod: true,
            reason: true,
            refundedAt: true,
            authorisedBy: { select: { id: true, name: true } },
          },
          orderBy: { refundedAt: 'asc' },
        },
      },
    })

    if (!session) {
      return NextResponse.json({ error: 'Cashier session not found' }, { status: 404 })
    }

    const totals =
      session.status === 'OPEN'
        ? await computeExpectedTotals(session)
        : session.counts.map((c) => ({
            paymentMethod: c.paymentMethod,
            expected: Number(c.expectedAmount),
            counted: Number(c.countedAmount),
            variance: Number(c.varianceAmount),
            notes: c.notes,
          }))

    return NextResponse.json({ success: true, data: { ...session, totals } })
  } catch (err) {
    console.error('Get cashier session error:', err)
    return NextResponse.json({ error: 'Failed to load cashier session' }, { status: 500 })
  }
}
