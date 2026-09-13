import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/**
 * GET /api/refunds — the refund trail FR-014 asks to be kept.
 *
 * `billing:read`, not `billing:refund`: seeing what was refunded and by whose
 * authority is what makes the control worth having, and restricting the list
 * to the people allowed to issue refunds would hide it from exactly the
 * reviewers it exists for. Issuing one still needs `billing:refund`.
 */
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sp = req.nextUrl.searchParams
    const page = Math.max(parseInt(sp.get('page') || '1', 10) || 1, 1)
    const limit = Math.min(parseInt(sp.get('limit') || '25', 10) || 25, 100)
    const dateFrom = sp.get('dateFrom')
    const dateTo = sp.get('dateTo')
    const sessionId = sp.get('cashierSessionId')

    const where: Record<string, unknown> = { hospitalId }
    if (sessionId) where.cashierSessionId = sessionId
    if (dateFrom || dateTo) {
      where.refundedAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      }
    }

    const [refunds, total] = await Promise.all([
      prisma.refund.findMany({
        where,
        orderBy: { refundedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          authorisedBy: { select: { id: true, name: true } },
          cashierSession: { select: { id: true, sessionNo: true } },
          payment: {
            select: {
              id: true,
              paymentNo: true,
              amount: true,
              paymentMethod: true,
              invoice: {
                select: {
                  id: true,
                  invoiceNo: true,
                  patient: {
                    select: { id: true, patientId: true, firstName: true, lastName: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.refund.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: refunds,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('List refunds error:', err)
    return NextResponse.json({ error: 'Failed to list refunds' }, { status: 500 })
  }
}
