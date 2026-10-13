import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { smsService } from '@/lib/services/sms.service'
import { z } from 'zod'
import { knownErrorResponse } from '@/lib/api-errors'
import { requireFeature } from '@/lib/plan-gate'

const bulkSMSSchema = z.object({
  recipients: z
    .array(
      z.object({
        phone: z.string().min(10),
        message: z.string().min(1).max(500),
        patientId: z.string().optional(),
      })
    )
    .min(1)
    .max(100),
  templateId: z.string().optional(),
})

// POST /api/communications/sms/bulk - Send bulk SMS
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('communications:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Bulk messaging is a paid feature (finding 26). Checked before the body is
  // read: a Free clinic is told about its plan, not about its recipient list.
  const notIncluded = await requireFeature(hospitalId, 'bulkCommunications')
  if (notIncluded) return notIncluded

  try {
    const body = await req.json()
    const data = bulkSMSSchema.parse(body)

    const results = await smsService.sendBulkSMS(
      data.recipients.map((r) => ({
        phone: r.phone,
        message: r.message,
        patientId: r.patientId,
        templateId: data.templateId,
        hospitalId,
      }))
    )

    const successCount = results.filter((r) => r).length
    const failedCount = results.length - successCount

    return NextResponse.json({
      success: true,
      totalRecipients: results.length,
      successCount,
      failedCount,
      results,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Bulk SMS send error:', error)
    return NextResponse.json({ error: 'Failed to send bulk SMS' }, { status: 500 })
  }
}
