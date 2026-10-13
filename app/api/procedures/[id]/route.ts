import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

// GET - Get single procedure
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const procedure = await prisma.procedure.findUnique({
      where: { id, hospitalId },
      include: {
        _count: {
          select: {
            treatments: true,
            treatmentPlanItems: true,
          },
        },
      },
    })

    if (!procedure) {
      return NextResponse.json({ error: 'Procedure not found' }, { status: 404 })
    }

    return NextResponse.json(procedure)
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching procedure:', error)
    return NextResponse.json({ error: 'Failed to fetch procedure' }, { status: 500 })
  }
}

// PUT - Update procedure
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    // Check if procedure exists
    const existingProcedure = await prisma.procedure.findUnique({
      where: { id, hospitalId },
    })

    if (!existingProcedure) {
      return NextResponse.json({ error: 'Procedure not found' }, { status: 404 })
    }

    // Check if name is being changed and if new name already exists
    if (body.name && body.name !== existingProcedure.name) {
      const nameExists = await prisma.procedure.findFirst({
        where: {
          hospitalId,
          name: body.name,
          id: { not: id },
        },
      })

      if (nameExists) {
        return NextResponse.json(
          { error: 'A procedure with this name already exists' },
          { status: 409 }
        )
      }
    }

    const updateData: any = {}

    if (body.name !== undefined) updateData.name = body.name
    if (body.description !== undefined) updateData.description = body.description
    if (body.defaultDuration !== undefined) updateData.defaultDuration = body.defaultDuration
    if (body.basePrice !== undefined) {
      // Zero is a price; negative, or not a number, is not (finding 50).
      const price = Number(body.basePrice)
      if (
        body.basePrice === null ||
        body.basePrice === '' ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        return NextResponse.json(
          { error: 'The base price must be a number of zero or more' },
          { status: 400 }
        )
      }
      updateData.basePrice = price
    }
    if (body.materials !== undefined) updateData.materials = body.materials
    if (body.preInstructions !== undefined) updateData.preInstructions = body.preInstructions
    if (body.postInstructions !== undefined) updateData.postInstructions = body.postInstructions
    if (body.defaultDiagnosis !== undefined) updateData.defaultDiagnosis = body.defaultDiagnosis
    if (body.defaultFindings !== undefined) updateData.defaultFindings = body.defaultFindings
    if (body.defaultProcedureNotes !== undefined)
      updateData.defaultProcedureNotes = body.defaultProcedureNotes
    if (body.defaultFollowUpDays !== undefined)
      updateData.defaultFollowUpDays =
        body.defaultFollowUpDays === null || body.defaultFollowUpDays === ''
          ? null
          : Number(body.defaultFollowUpDays)
    if (body.isActive !== undefined) updateData.isActive = body.isActive

    const procedure = await prisma.procedure.update({
      where: { id, hospitalId },
      data: updateData,
    })

    if (existingProcedure.isActive && updateData.isActive === false) {
      void recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.PROCEDURE_DEACTIVATED,
        entityType: 'Procedure',
        entityId: id,
        oldValues: { isActive: true },
        newValues: {
          code: existingProcedure.code,
          name: existingProcedure.name,
          isActive: false,
        },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json(procedure)
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating procedure:', error)
    return NextResponse.json({ error: 'Failed to update procedure' }, { status: 500 })
  }
}

// DELETE - Delete procedure (soft delete by setting isActive to false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Check if procedure exists
    const procedure = await prisma.procedure.findUnique({
      where: { id, hospitalId },
      include: {
        _count: {
          select: {
            treatments: true,
            treatmentPlanItems: true,
          },
        },
      },
    })

    if (!procedure) {
      return NextResponse.json({ error: 'Procedure not found' }, { status: 404 })
    }

    // Check if procedure is used in treatments or treatment plans
    if (procedure._count.treatments > 0 || procedure._count.treatmentPlanItems > 0) {
      // Soft delete - just mark as inactive
      await prisma.procedure.update({
        where: { id, hospitalId },
        data: { isActive: false },
      })

      // Recorded once, when it actually goes out of use (finding 24).
      if (procedure.isActive) {
        void recordAudit({
          hospitalId,
          userId: user?.id ?? null,
          action: AUDIT_ACTIONS.PROCEDURE_DEACTIVATED,
          entityType: 'Procedure',
          entityId: id,
          oldValues: { isActive: true },
          newValues: { code: procedure.code, name: procedure.name, isActive: false },
          ...requestContext(request.headers),
        })
      }

      return NextResponse.json({
        message: 'Procedure has been deactivated as it is used in existing treatments',
        deactivated: true,
      })
    }

    // Hard delete if not used
    await prisma.procedure.delete({
      where: { id, hospitalId },
    })

    return NextResponse.json({
      message: 'Procedure deleted successfully',
      deleted: true,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deleting procedure:', error)
    return NextResponse.json({ error: 'Failed to delete procedure' }, { status: 500 })
  }
}
