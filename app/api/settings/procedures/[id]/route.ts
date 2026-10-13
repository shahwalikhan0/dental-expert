import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const procedureUpdateSchema = z.object({
  code: z.string().min(1).toUpperCase().optional(),
  name: z.string().min(1).optional(),
  category: z
    .enum([
      'PREVENTIVE',
      'RESTORATIVE',
      'ENDODONTIC',
      'PERIODONTIC',
      'PROSTHODONTIC',
      'ORTHODONTIC',
      'ORAL_SURGERY',
      'COSMETIC',
      'DIAGNOSTIC',
      'EMERGENCY',
    ])
    .optional(),
  description: z.string().optional(),
  defaultDuration: z.number().int().positive().optional(),
  // Zero is a price (bug report 12 Oct, finding 50); negative is not.
  basePrice: z.number().min(0, 'The base price cannot be negative').optional(),
  materials: z.string().optional(),
  preInstructions: z.string().optional(),
  postInstructions: z.string().optional(),
  // Boilerplate copied onto a new treatment's note. See model Procedure.
  defaultDiagnosis: z.string().optional(),
  defaultFindings: z.string().optional(),
  defaultProcedureNotes: z.string().optional(),
  // Non-negative rather than positive: 0 means "follow up the same day",
  // which is a real answer for an extraction. "No default" is the field
  // being absent.
  defaultFollowUpDays: z.number().int().min(0).max(3650).optional().nullable(),
  isActive: z.boolean().optional(),
})

// GET /api/settings/procedures/[id] - Get single procedure
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const procedure = await prisma.procedure.findUnique({
      where: { id, hospitalId },
    })

    if (!procedure) {
      return NextResponse.json({ error: 'Procedure not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: procedure,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Get procedure error:', error)
    return NextResponse.json({ error: 'Failed to get procedure' }, { status: 500 })
  }
}

// PUT /api/settings/procedures/[id] - Update procedure
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const data = procedureUpdateSchema.parse(body)

    // Check if procedure exists
    const existing = await prisma.procedure.findUnique({
      where: { id, hospitalId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Procedure not found' }, { status: 404 })
    }

    // If code is being updated, check if it's unique within this hospital
    if (data.code && data.code !== existing.code) {
      const codeExists = await prisma.procedure.findFirst({
        where: { code: data.code, hospitalId },
      })

      if (codeExists) {
        return NextResponse.json({ error: 'Procedure code already exists' }, { status: 400 })
      }
    }

    const procedure = await prisma.procedure.update({
      where: { id, hospitalId },
      data,
    })

    // The Active switch on the catalogue page is this route. Taking a
    // procedure out of use is recorded, however it is done (finding 24).
    if (existing.isActive && data.isActive === false) {
      void recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.PROCEDURE_DEACTIVATED,
        entityType: 'Procedure',
        entityId: id,
        oldValues: { isActive: true },
        newValues: { code: existing.code, name: existing.name, isActive: false },
        ...requestContext(req.headers),
      })
    }

    return NextResponse.json({
      success: true,
      data: procedure,
      message: 'Procedure updated successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Update procedure error:', error)
    return NextResponse.json({ error: 'Failed to update procedure' }, { status: 500 })
  }
}

// DELETE /api/settings/procedures/[id] - Deactivate procedure
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Check if procedure exists
    const existing = await prisma.procedure.findUnique({
      where: { id, hospitalId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Procedure not found' }, { status: 404 })
    }

    // Soft delete by setting isActive to false
    const procedure = await prisma.procedure.update({
      where: { id, hospitalId },
      data: { isActive: false },
    })

    // Recorded once, when it actually goes out of use (finding 24).
    if (existing.isActive) {
      void recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.PROCEDURE_DEACTIVATED,
        entityType: 'Procedure',
        entityId: id,
        oldValues: { isActive: true },
        newValues: { code: existing.code, name: existing.name, isActive: false },
        ...requestContext(req.headers),
      })
    }

    return NextResponse.json({
      success: true,
      data: procedure,
      // The settings page reads this to say what happened. The procedure is
      // kept: treatments and plans that used it still name it.
      deactivated: true,
      message: 'Procedure deactivated successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Delete procedure error:', error)
    return NextResponse.json({ error: 'Failed to delete procedure' }, { status: 500 })
  }
}
