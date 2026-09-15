import { NextRequest, NextResponse } from 'next/server'
import { communicationTriggersService } from '@/lib/services/communication-triggers.service'

/**
 * POST /api/communications/triggers — birthday wishes, payment reminders and
 * lab-work-ready notifications. Appointment reminders are not here: they are
 * queued by /api/cron/reminders and sent by /api/cron/dispatch.
 *
 * TODO — nothing schedules this yet. The endpoint is complete and can be called
 * by hand; what is missing is the thing that calls it daily. There is no
 * scheduler config anywhere in the repository (no `vercel.json` crons, no timer
 * unit, no CI schedule), so on a fresh deployment this route never runs.
 * Whatever runs it must send `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(req: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET || 'your-cron-secret-key'

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Run all automated communication triggers
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

// GET /api/communications/triggers - Manual trigger (for testing)
export async function GET(req: NextRequest) {
  try {
    // Only allow in development or with admin authentication
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Manual triggers not allowed in production' },
        { status: 403 }
      )
    }

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
