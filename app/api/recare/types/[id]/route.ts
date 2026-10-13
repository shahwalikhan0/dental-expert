import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import {
  RECARE_TYPE_PROCEDURES_SELECT,
  checkRecareProcedureIds,
  parseProcedureIds,
} from '@/lib/recare'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.recareType.findFirst({
      where: { id, hospitalId },
      select: { id: true, name: true, procedures: { select: { id: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Recare type not found' }, { status: 404 })

    const name = body.name !== undefined ? String(body.name).trim() : existing.name
    if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })

    if (body.intervalMonths !== undefined) {
      const months = Number(body.intervalMonths)
      if (!Number.isInteger(months) || months < 1 || months > 120) {
        return NextResponse.json(
          { error: 'The interval must be a whole number of months between 1 and 120' },
          { status: 400 }
        )
      }
    }

    // The procedures that count as the visit for it (bug report 12 Oct,
    // finding 46). Replaces the list. This clinic's only; a procedure that has
    // since been deactivated may stay linked but may not be newly added — see
    // `checkRecareProcedureIds`.
    let procedureIds: string[] | undefined
    if (body.procedureIds !== undefined) {
      const requested = parseProcedureIds(body.procedureIds)
      const found = await prisma.procedure.findMany({
        where: { hospitalId, id: { in: requested } },
        select: { id: true, name: true, isActive: true },
      })
      const check = checkRecareProcedureIds(
        requested,
        found,
        existing.procedures.map((procedure) => procedure.id)
      )
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
      procedureIds = check.ids
    }

    if (name !== existing.name) {
      const duplicate = await prisma.recareType.findFirst({
        where: { hospitalId, name, id: { not: id } },
        select: { id: true },
      })
      if (duplicate)
        return NextResponse.json({ error: `"${name}" already exists` }, { status: 409 })
    }

    const type = await prisma.$transaction(async (tx) => {
      if (body.isDefault === true) {
        await tx.recareType.updateMany({ where: { hospitalId }, data: { isDefault: false } })
      }
      return tx.recareType.update({
        where: { id },
        data: {
          name,
          ...(body.intervalMonths !== undefined
            ? { intervalMonths: Number(body.intervalMonths) }
            : {}),
          ...(body.description !== undefined
            ? { description: body.description?.trim() || null }
            : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
          ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          ...(body.isDefault !== undefined ? { isDefault: Boolean(body.isDefault) } : {}),
          ...(procedureIds !== undefined
            ? { procedures: { set: procedureIds.map((procedureId) => ({ id: procedureId })) } }
            : {}),
        },
        include: { procedures: RECARE_TYPE_PROCEDURES_SELECT },
      })
    })

    return NextResponse.json({ type })
  } catch (err) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Error updating recare type:', err)
    return NextResponse.json({ error: 'Failed to update the recare type' }, { status: 500 })
  }
}

/**
 * DELETE — only while nobody is on it.
 *
 * A type with patients against it is deactivated instead. Deleting it would
 * take their recall dates with it, which is a silent way to stop chasing people
 * the practice meant to chase.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const type = await prisma.recareType.findFirst({
      where: { id, hospitalId },
      select: { id: true, name: true, _count: { select: { recares: true } } },
    })
    if (!type) return NextResponse.json({ error: 'Recare type not found' }, { status: 404 })

    if (type._count.recares > 0) {
      await prisma.recareType.update({ where: { id }, data: { isActive: false, isDefault: false } })
      return NextResponse.json({
        success: true,
        deactivated: true,
        message: `${type.name} is used by ${type._count.recares} patient${type._count.recares === 1 ? '' : 's'}, so it was deactivated rather than deleted`,
      })
    }

    await prisma.recareType.delete({ where: { id } })
    return NextResponse.json({ success: true, message: `${type.name} was deleted` })
  } catch (err) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Error deleting recare type:', err)
    return NextResponse.json({ error: 'Failed to delete the recare type' }, { status: 500 })
  }
}
