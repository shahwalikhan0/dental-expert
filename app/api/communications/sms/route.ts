import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { smsService } from '@/lib/services/sms.service'
import { z } from 'zod'
import { knownErrorResponse } from '@/lib/api-errors'
import { isSendRefusal } from '@/lib/services/send-refusal'

const sendSMSSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(1).max(500),
  patientId: z.string().optional(),
  templateId: z.string().optional(),
  scheduledFor: z.string().datetime().optional(),
})

// POST /api/communications/sms - Send SMS
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('communications:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const data = sendSMSSchema.parse(body)

    const smsLogId = await smsService.sendSMS({
      phone: data.phone,
      message: data.message,
      patientId: data.patientId,
      templateId: data.templateId,
      scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : undefined,
      hospitalId,
    })

    return NextResponse.json({
      success: true,
      smsLogId,
      message: data.scheduledFor ? 'SMS scheduled successfully' : 'SMS sent successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    // The service's own reasons — no gateway set up, outside the send window,
    // the patient opted out — are for the person sending. Anything else is
    // logged, not repeated.
    if (isSendRefusal(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('SMS send error:', error)
    return NextResponse.json({ error: 'Failed to send SMS' }, { status: 500 })
  }
}

// GET /api/communications/sms - Get SMS history
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('communications:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams

    const filters = {
      patientId: searchParams.get('patientId') || undefined,
      phone: searchParams.get('phone') || undefined,
      status: searchParams.get('status') || undefined,
      from: searchParams.get('from') ? new Date(searchParams.get('from')!) : undefined,
      to: searchParams.get('to') ? new Date(searchParams.get('to')!) : undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100,
      hospitalId,
    }

    const history = await smsService.getSMSHistory(filters)

    return NextResponse.json({
      success: true,
      data: history,
      count: history.length,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Get SMS history error:', error)
    return NextResponse.json({ error: 'Failed to get SMS history' }, { status: 500 })
  }
}
