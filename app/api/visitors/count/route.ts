import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/**
 * How many walk-ins are waiting on a decision.
 *
 * For the badge in the navigation. The list route can answer this — its
 * `pagination.total` for `state=open` is the same number — but it also reads a
 * page of rows with four joins to do it, and the menu asks on every
 * navigation. This is the count on its own.
 *
 * Same permission as the screen the badge points at, so a role that cannot
 * open the walk-in queue is not told how long it is.
 */
export async function GET() {
  const { error, hospitalId } = await requirePermission('patients:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const open = await prisma.visitor.count({
      where: { hospitalId, convertedAt: null, discardedAt: null },
    })

    return NextResponse.json({ open })
  } catch (err) {
    console.error('Error counting visitors:', err)
    return NextResponse.json({ error: 'Failed to count visitors' }, { status: 500 })
  }
}
