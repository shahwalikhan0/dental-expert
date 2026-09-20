import { NextResponse } from 'next/server'
import { dispatchDueMessages } from '@/lib/services/message-dispatch'
import { cronAuthorised, cronUnauthorised } from '@/lib/cron-auth'

/**
 * GET /api/cron/dispatch — meant to run every 15 minutes.
 *
 * Sends the messages `/api/cron/reminders` has queued. Run it more often than
 * the queueing job: a reminder scheduled for 17:00 goes out at the first run
 * after 17:00, so the interval is the worst-case lateness.
 *
 * Reads across clinics deliberately, like the other cron routes, and is
 * authenticated on CRON_SECRET. No clinic can call it.
 *
 * Scheduled every fifteen minutes. See lib/jobs.ts for the schedule and
 * docs/SCHEDULING.md for what runs it; whatever does must send
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return cronUnauthorised()

  const result = await dispatchDueMessages()

  return NextResponse.json({ ...result, processedAt: new Date().toISOString() })
}
