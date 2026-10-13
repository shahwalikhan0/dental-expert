import { NextRequest, NextResponse } from 'next/server'
import type { TreatmentPlanItemStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { can } from '@/lib/rbac'
import { normalisePhaseNames } from '@/lib/treatment-phases'
import { readPlanItems } from '@/lib/treatment-plan-items'
import { planTransitionRefusal } from '@/lib/treatment-plan-status'

// GET - Get single treatment plan with all details
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const treatmentPlan = await prisma.treatmentPlan.findFirst({
      where: { id, hospitalId },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            dateOfBirth: true,
            gender: true,
          },
        },
        items: {
          include: {
            procedure: {
              select: {
                id: true,
                code: true,
                name: true,
                category: true,
                description: true,
                defaultDuration: true,
                basePrice: true,
                preInstructions: true,
                postInstructions: true,
              },
            },
            // The treatment carrying the step out, once one has been started.
            treatment: { select: { id: true, treatmentNo: true, status: true } },
          },
          orderBy: [{ phase: 'asc' }, { priority: 'asc' }],
        },
      },
    })

    if (!treatmentPlan) {
      return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 })
    }

    return NextResponse.json(treatmentPlan)
  } catch (error) {
    console.error('Error fetching treatment plan:', error)
    return NextResponse.json({ error: 'Failed to fetch treatment plan' }, { status: 500 })
  }
}

// PUT - Update treatment plan
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('clinical:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    // Check if treatment plan exists and belongs to this hospital
    const existingPlan = await prisma.treatmentPlan.findFirst({
      where: { id, hospitalId },
      include: { items: true },
    })

    if (!existingPlan) {
      return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 })
    }

    // Prevent updates to completed or cancelled plans. A record integrity rule,
    // not an access rule — see the matching comment in treatments/[id].
    if (
      (existingPlan.status === 'COMPLETED' || existingPlan.status === 'CANCELLED') &&
      !can(session?.user?.role, 'clinical:delete')
    ) {
      return NextResponse.json(
        { error: 'Cannot modify completed or cancelled treatment plans' },
        { status: 400 }
      )
    }

    const updateData: any = {}

    // Update basic fields
    if (body.title !== undefined) updateData.title = body.title
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.startDate !== undefined)
      updateData.startDate = body.startDate ? new Date(body.startDate) : null
    if (body.expectedEndDate !== undefined)
      updateData.expectedEndDate = body.expectedEndDate ? new Date(body.expectedEndDate) : null
    if (body.phaseNames !== undefined) updateData.phaseNames = normalisePhaseNames(body.phaseNames)
    if (body.consentGiven !== undefined) {
      updateData.consentGiven = body.consentGiven
      // `consentDate` was a column nothing ever wrote. A plan could say the
      // patient had consented without saying when, which is the one thing a
      // consent record has to be able to answer. Withdrawing consent clears it
      // rather than leaving the old date standing as if it still applied.
      if (body.consentGiven && !existingPlan.consentGiven) {
        updateData.consentDate = new Date()
      } else if (!body.consentGiven) {
        updateData.consentDate = null
      }
    }

    // The items, if sent, are matched to the stored ones by id rather than
    // deleted and written back. Wholesale replacement threw away each item's
    // link to the treatment carrying it out (bug report 12 Oct, finding 11),
    // and with it the step's progress.
    type ItemWrite = Awaited<ReturnType<typeof readPlanItems>>
    let checked: Extract<ItemWrite, { ok: true }> | null = null
    let removed: string[] = []
    const existingItems = existingPlan.items ?? []
    const stored = new Map(existingItems.map((item) => [item.id, item]))

    if (body.items !== undefined) {
      // A procedure already on the plan may stay though it has since been
      // deactivated; a new line may not use one (finding 48).
      const result = await readPlanItems(
        prisma,
        hospitalId,
        body.items,
        new Set(existingItems.map((item) => item.procedureId))
      )
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      checked = result

      const kept = new Set(result.items.map((item) => item.id).filter(Boolean))
      const dropped = existingItems.filter((item) => !kept.has(item.id))

      // A step that has been started or done is a record of work, and goes
      // only by cancelling the treatment that carries it.
      const started = dropped.find(
        (item) => item.treatmentId || item.status === 'IN_PROGRESS' || item.status === 'COMPLETED'
      )
      if (started) {
        return NextResponse.json(
          { error: 'A step that has been started or completed cannot be removed from the plan' },
          { status: 400 }
        )
      }
      removed = dropped.map((item) => item.id)

      for (const item of result.items) {
        const before = item.id ? stored.get(item.id) : undefined
        if (!before) continue
        // A step being carried out by a treatment keeps its procedure, and its
        // status is the treatment's to move, not the form's.
        if (before.treatmentId && before.procedureId !== item.procedureId) {
          return NextResponse.json(
            { error: 'A step that has been started cannot be changed to another procedure' },
            { status: 400 }
          )
        }
      }

      updateData.estimatedCost = result.estimatedCost
      updateData.estimatedDuration = result.estimatedDuration
    }

    // The status, against the plan's items as they will be after this save
    // (finding 34). See PLAN_TRANSITIONS for the rule.
    if (body.status !== undefined) {
      const itemsAfter = checked
        ? checked.items.map((item) => {
            const before = item.id ? stored.get(item.id) : undefined
            return { status: statusToStore(item.status, before) }
          })
        : existingItems
      const refusal = planTransitionRefusal(existingPlan.status, body.status, itemsAfter)
      if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

      updateData.status = body.status
      if (body.status === 'COMPLETED' && !existingPlan.completedDate) {
        updateData.completedDate = new Date()
      }
    }

    // The items and the plan's total and status land together.
    const treatmentPlan = await prisma.$transaction(async (tx) => {
      if (checked && removed.length > 0) {
        await tx.treatmentPlanItem.deleteMany({
          where: { id: { in: removed }, treatmentPlanId: id },
        })
      }

      for (const item of checked?.items ?? []) {
        const before = item.id ? stored.get(item.id) : undefined
        const data = {
          procedureId: item.procedureId,
          toothNumbers: item.toothNumbers,
          phase: item.phase,
          priority: item.priority,
          estimatedCost: item.estimatedCost,
          notes: item.notes,
          status: statusToStore(item.status, before),
        }
        if (before) {
          await tx.treatmentPlanItem.update({ where: { id: before.id }, data })
        } else {
          await tx.treatmentPlanItem.create({ data: { ...data, treatmentPlanId: id } })
        }
      }

      return tx.treatmentPlan.update({
        where: { id },
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
          items: {
            include: {
              procedure: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  category: true,
                  basePrice: true,
                },
              },
            },
            orderBy: [{ phase: 'asc' }, { priority: 'asc' }],
          },
        },
      })
    })

    return NextResponse.json(treatmentPlan)
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating treatment plan:', error)
    return NextResponse.json({ error: 'Failed to update treatment plan' }, { status: 500 })
  }
}

/**
 * The status a line is stored with.
 *
 * A step carried out by a treatment, or already in progress or done, keeps the
 * status it has: that is moved by the treatment, and a form resending what it
 * loaded must not wind it back. Otherwise the form's PENDING, SCHEDULED or
 * CANCELLED stands.
 */
function statusToStore(
  requested: TreatmentPlanItemStatus,
  before: { status: TreatmentPlanItemStatus; treatmentId: string | null } | undefined
): TreatmentPlanItemStatus {
  if (
    before &&
    (before.treatmentId || before.status === 'IN_PROGRESS' || before.status === 'COMPLETED')
  ) {
    return before.status
  }
  return requested
}

// DELETE - Delete treatment plan
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, session } = await requirePermission('clinical:delete')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Check if treatment plan exists and belongs to this hospital
    const treatmentPlan = await prisma.treatmentPlan.findFirst({
      where: { id, hospitalId },
      include: {
        items: true,
      },
    })

    if (!treatmentPlan) {
      return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 })
    }

    // Check if any items are in progress or completed
    const hasActiveItems = treatmentPlan.items.some(
      (item) => item.status === 'IN_PROGRESS' || item.status === 'COMPLETED'
    )

    if (hasActiveItems) {
      return NextResponse.json(
        { error: 'Cannot delete treatment plan with active or completed items' },
        { status: 400 }
      )
    }

    // Delete items first
    await prisma.treatmentPlanItem.deleteMany({
      where: { treatmentPlanId: id },
    })

    // Delete treatment plan
    await prisma.treatmentPlan.delete({
      where: { id },
    })

    return NextResponse.json({
      message: 'Treatment plan deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting treatment plan:', error)
    return NextResponse.json({ error: 'Failed to delete treatment plan' }, { status: 500 })
  }
}
