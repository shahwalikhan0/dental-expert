import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/api-helpers'
import { queueRecallMessages } from '@/lib/recall'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit'

/**
 * POST /api/recare/contact — work the recall list.
 *
 * Takes the recares somebody selected on the due list and queues one message
 * each. Nothing is sent here: the rows go into `MessageLog` at PENDING and
 * `/api/cron/dispatch` sends them, which is what makes the clinic's send window
 * and its per-patient consent apply to a recall exactly as they apply to an
 * appointment reminder.
 *
 * `communications:write`, not `appointments:write`. Reading the recall list is
 * scheduling; sending forty patients a message is communications, and a clinic
 * that lets everyone read the list may not want everyone able to text it.
 */

const contactSchema = z.object({
  recareIds: z
    .array(z.string().trim().min(1))
    .min(1, 'Choose at least one patient')
    // A bulk send is a batch, not a campaign. Past this it should be a job.
    .max(200, 'Two hundred at a time is the limit — work the list in batches'),
  channel: z.enum(['SMS', 'EMAIL', 'WHATSAPP']).default('SMS'),
  /** Override the fortnight's cooling-off — for when you know it did not arrive. */
  force: z.boolean().default(false),
})

export async function POST(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('communications:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const data = contactSchema.parse(await request.json())

    const run = await queueRecallMessages(hospitalId, data.recareIds, {
      channel: data.channel,
      force: data.force,
    })

    // One entry for the batch rather than one per patient: what an auditor
    // needs to reconstruct is that somebody worked the list at this time, and
    // the individual messages are already in the message log.
    void recordAudit({
      hospitalId,
      userId: user?.id,
      action: AUDIT_ACTIONS.RECALL_CONTACTED,
      entityType: 'Recare',
      entityId: `${run.queued} queued`,
      newValues: {
        channel: data.channel,
        requested: data.recareIds.length,
        queued: run.queued,
        skipped: run.skipped,
        forced: data.force,
      },
    })

    return NextResponse.json(run)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid request' },
        { status: 400 }
      )
    }
    console.error('Recall contact error:', err)
    return NextResponse.json({ error: 'Failed to queue the messages' }, { status: 500 })
  }
}
