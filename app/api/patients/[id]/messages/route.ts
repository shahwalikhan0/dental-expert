import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { messageHistory } from '@/lib/message-history'

/**
 * GET /api/patients/[id]/messages — every message the clinic sent this
 * patient, over any channel: what the desk sent, reminders, recalls and
 * waitlist offers.
 *
 * `communications:read`, as the SMS and email history are. The patient record
 * had no list of these at all (bug report 16 Oct, finding 18), so a patient
 * saying they were never reminded could not be answered from their record.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('communications:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
      select: { id: true },
    })
    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

    const limit = Number(request.nextUrl.searchParams.get('limit')) || 100
    const messages = await messageHistory({ hospitalId, patientId: patient.id, limit })

    return NextResponse.json({ messages })
  } catch (err) {
    console.error('Error fetching patient messages:', err)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}
