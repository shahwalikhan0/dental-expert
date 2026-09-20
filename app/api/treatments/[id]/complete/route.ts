import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { completeRecare } from '@/lib/recare'

// POST - Complete treatment
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('clinical:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    // Check if treatment exists
    const treatment = await prisma.treatment.findUnique({
      where: { id, hospitalId },
    })

    if (!treatment) {
      return NextResponse.json({ error: 'Treatment not found' }, { status: 404 })
    }

    // FR-007: this route writes procedureNotes, materialsUsed and
    // complications, so it is another way into the clinical record. A signed
    // note is closed to it.
    if (treatment.signedAt) {
      return NextResponse.json(
        { error: `${treatment.treatmentNo} is signed and cannot be completed again` },
        { status: 409 }
      )
    }

    // Check if treatment can be completed
    if (treatment.status !== 'IN_PROGRESS' && treatment.status !== 'PLANNED') {
      return NextResponse.json(
        { error: `Cannot complete treatment with status: ${treatment.status}` },
        { status: 400 }
      )
    }

    // Update treatment with completion details
    const updateData: any = {
      status: 'COMPLETED',
      endTime: new Date(),
    }

    // If treatment was never started, set start time to now
    if (!treatment.startTime) {
      updateData.startTime = new Date()
    }

    // Optional completion notes
    if (body.procedureNotes !== undefined) updateData.procedureNotes = body.procedureNotes
    if (body.materialsUsed !== undefined) updateData.materialsUsed = body.materialsUsed
    if (body.complications !== undefined) updateData.complications = body.complications
    if (body.followUpRequired !== undefined) updateData.followUpRequired = body.followUpRequired
    if (body.followUpDate !== undefined)
      updateData.followUpDate = body.followUpDate ? new Date(body.followUpDate) : null

    // Completing the visit that a recall was for moves the recall on.
    //
    // Named explicitly rather than guessed: there is no link between a
    // procedure and a recare type, and advancing whatever recall the patient
    // happens to have because a filling was completed would push their hygiene
    // visit six months into the future for the wrong reason. The recall list
    // has its own "mark as done" for the ordinary case.
    if (body.recareId) {
      const recare = await prisma.recare.findFirst({
        where: { id: body.recareId, hospitalId, patientId: treatment.patientId },
        select: { id: true },
      })

      if (!recare) {
        return NextResponse.json(
          { error: 'That recare does not belong to this patient' },
          { status: 400 }
        )
      }
    }

    const updatedTreatment = await prisma.treatment.update({
      where: { id, hospitalId },
      data: updateData,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        procedure: {
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
          },
        },
      },
    })

    if (body.recareId) {
      await completeRecare(prisma, body.recareId, updateData.endTime)
    }

    return NextResponse.json(updatedTreatment)
  } catch (error) {
    console.error('Error completing treatment:', error)
    return NextResponse.json({ error: 'Failed to complete treatment' }, { status: 500 })
  }
}
