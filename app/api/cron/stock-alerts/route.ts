import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { expiryWarningDays, reconcileExpiryAlerts } from '@/lib/stock-alerts'
import { cronAuthorised, cronUnauthorised } from '@/lib/cron-auth'

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
 * Scheduled daily, at 01:30. See lib/jobs.ts for the schedule and
 * docs/SCHEDULING.md for what runs it; whatever does must send
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return cronUnauthorised()

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
