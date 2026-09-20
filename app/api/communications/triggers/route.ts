import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorised, cronUnauthorised } from '@/lib/cron-auth'
import { communicationTriggersService } from '@/lib/services/communication-triggers.service'

/**
 * POST /api/communications/triggers — meant to run once a day.
 *
 * Birthday wishes, payment chasing and lab-work-ready notifications.
 * Appointment reminders are not here: they are queued by /api/cron/reminders
 * and sent by /api/cron/dispatch.
 *
 * Reads across clinics deliberately, like the cron routes, and is authenticated
 * on CRON_SECRET. No clinic can call it. See scripts/scheduler.ts and
 * docs/SCHEDULING.md for what runs it.
 *
 * Each of the three triggers is safe to run twice. That was not true until the
 * job was actually put on a schedule: every one of them resent on every run, so
 * an hourly schedule would have sent a patient twenty-four reminders about the
 * same overdue invoice in a day.
 */
export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) return cronUnauthorised()

  try {
    await communicationTriggersService.runAllTriggers()

    return NextResponse.json({
      success: true,
      message: 'Communication triggers executed successfully',
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Communication triggers error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to run communication triggers' },
      { status: 500 }
    )
  }
}

/**
 * GET — the same thing, for a scheduler that can only issue GETs.
 *
 * It used to run the triggers with **no authentication at all** outside
 * production, on the reasoning that manual triggering is a development
 * convenience. What it actually was is an unauthenticated endpoint that sends
 * text messages to real patients, on every staging environment that had the
 * clinic's Twilio credentials configured — which is what a staging environment
 * usually has.
 */
export async function GET(req: NextRequest) {
  return POST(req)
}
