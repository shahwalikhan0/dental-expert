import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { completeRecare, nextDueDate, type RecallMoved } from '@/lib/recare'
import { afterTreatmentCompleted } from '@/lib/treatment-completion'
import { clinicTimezone } from '@/lib/appointment-time'

// POST - Complete treatment
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:write')
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
    // Two ways. A caller can name the recall (`recareId`), which is checked to
    // be this patient's. And whether or not it does, the patient's recalls
    // whose type the clinic has linked to this procedure are moved too — a
    // scale and polish moves the "Scale and polish" recall, as Mark as done
    // would (bug report 12 Oct, finding 46). No screen ever sent `recareId`,
    // so without the second the recall waited for somebody to remember. Only
    // the stored link counts — see `recaresForProcedureWhere` — so a filling,
    // linked to no recall, never moves a hygiene recall.
    let namedRecare: { id: string; recareType: { name: string; intervalMonths: number } } | null =
      null
    if (body.recareId) {
      namedRecare = await prisma.recare.findFirst({
        where: { id: body.recareId, hospitalId, patientId: treatment.patientId },
        select: { id: true, recareType: { select: { name: true, intervalMonths: true } } },
      })

      if (!namedRecare) {
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

    const recallsMoved: RecallMoved[] = []
    if (namedRecare) {
      await completeRecare(prisma, namedRecare.id, updateData.endTime)
      recallsMoved.push({
        id: namedRecare.id,
        name: namedRecare.recareType.name,
        dueDate: nextDueDate(
          updateData.endTime,
          namedRecare.recareType.intervalMonths,
          await clinicTimezone(prisma, hospitalId)
        ),
      })
    }

    // The plan step this treatment carries out, and the recalls it is the
    // visit for.
    recallsMoved.push(
      ...(await afterTreatmentCompleted(
        prisma,
        {
          id,
          hospitalId,
          patientId: treatment.patientId,
          procedure: updatedTreatment.procedure,
        },
        updateData.endTime,
        namedRecare ? [namedRecare.id] : []
      ))
    )

    return NextResponse.json({ ...updatedTreatment, recallsMoved })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error completing treatment:', error)
    return NextResponse.json({ error: 'Failed to complete treatment' }, { status: 500 })
  }
}
