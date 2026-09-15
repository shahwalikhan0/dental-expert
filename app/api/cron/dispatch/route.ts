import { NextResponse } from 'next/server'
import { dispatchDueMessages } from '@/lib/services/message-dispatch'

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
 * TODO — nothing schedules this yet. The endpoint is complete and can be called
 * by hand; what is missing is the thing that calls it every fifteen minutes.
 * There is no scheduler config anywhere in the repository (no `vercel.json`
 * crons, no timer unit, no CI schedule), so on a fresh deployment this route
 * never runs.
 * Whatever runs it must send `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await dispatchDueMessages()

  return NextResponse.json({ ...result, processedAt: new Date().toISOString() })
}
