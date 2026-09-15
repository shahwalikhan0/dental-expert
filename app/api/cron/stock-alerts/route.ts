import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { expiryWarningDays, reconcileExpiryAlerts } from '@/lib/stock-alerts'

/**
 * GET /api/cron/stock-alerts — meant to run once a day.
 *
 * Raises the expiry alerts FR-016 asks for. A shortage alert is raised by a
 * stock movement, because that is when it becomes true; an expiry alert
 * becomes true because the calendar moved, so nothing in a request can raise
 * it and it needs a sweep.
 *
 * Reads across clinics deliberately, like the other cron routes, and is
 * authenticated on CRON_SECRET. No clinic can call it.
 *
 * TODO — nothing schedules this yet. The endpoint is complete and can be called
 * by hand; what is missing is the thing that calls it daily. There is no
 * scheduler config anywhere in the repository (no `vercel.json` crons, no
 * timer unit, no CI schedule), so on a fresh deployment this route never runs.
 * Whatever runs it must send `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clinics = await prisma.hospital.findMany({
    where: { isActive: true },
    select: { id: true },
  })

  const now = new Date()
  let raised = 0
  let cleared = 0
  let checked = 0

  for (const clinic of clinics) {
    // Each clinic's own warning window: a practice that orders monthly wants
    // more notice than one with a supplier down the road.
    const warningDays = await expiryWarningDays(prisma, clinic.id)
    const sweep = await reconcileExpiryAlerts(prisma, {
      hospitalId: clinic.id,
      at: now,
      warningDays,
    })

    raised += sweep.raised
    cleared += sweep.cleared
    checked += sweep.checked
  }

  return NextResponse.json({
    clinics: clinics.length,
    checked,
    raised,
    cleared,
    processedAt: now.toISOString(),
  })
}
