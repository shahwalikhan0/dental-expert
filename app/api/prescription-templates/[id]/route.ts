import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { templateRefusal } from '@/lib/prescription-templates'
import { itemRows } from '../route'

const ITEM_INCLUDE = {
  items: {
    orderBy: { sortOrder: 'asc' as const },
    include: { medication: { select: { id: true, name: true, genericName: true } } },
  },
}

// GET — one template
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const template = await prisma.prescriptionTemplate.findFirst({
    where: { id, hospitalId },
    include: ITEM_INCLUDE,
  })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  return NextResponse.json({ success: true, data: template })
}

// PATCH — edit a template, or retire and restore one
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await prisma.prescriptionTemplate.findFirst({
      where: { id, hospitalId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

    const body = await request.json()

    // Retiring or restoring is its own request and touches nothing else, so a
    // screen can offer it without having to resend the whole template.
    if (typeof body.isActive === 'boolean' && Object.keys(body).length === 1) {
      const template = await prisma.prescriptionTemplate.update({
        where: { id },
        data: { isActive: body.isActive },
        include: ITEM_INCLUDE,
      })
      return NextResponse.json({ success: true, data: template })
    }

    const { name, description, category, diagnosis, notes, items } = body
    const refusal = templateRefusal({ name, items })
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

    const clash = await prisma.prescriptionTemplate.findFirst({
      where: { hospitalId, name: name.trim(), NOT: { id } },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json({ error: 'Another template already has that name' }, { status: 409 })
    }

    /*
     * The lines are replaced wholesale rather than reconciled row by row.
     *
     * Safe here precisely because issuing copies: no `PrescriptionMedication`
     * anywhere points at a `PrescriptionTemplateItem`, so deleting these rows
     * cannot reach a patient's record. Reconciling would buy nothing and would
     * need a stable identity for a line that the editing screen does not have.
     */
    const template = await prisma.$transaction(async (tx) => {
      await tx.prescriptionTemplateItem.deleteMany({ where: { templateId: id } })
      return tx.prescriptionTemplate.update({
        where: { id },
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          category: category?.trim() || null,
          diagnosis: diagnosis?.trim() || null,
          notes: notes?.trim() || null,
          items: { create: itemRows(items) },
        },
        include: ITEM_INCLUDE,
      })
    })

    return NextResponse.json({ success: true, data: template })
  } catch (err: any) {
    console.error('Error updating prescription template:', err)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

/**
 * DELETE — retire a template.
 *
 * Deactivates rather than deletes, and says so in the response. Prescriptions
 * issued from a template keep pointing at it, and a clinic auditing what it
 * prescribed last March needs that pointer to still resolve to a name. A
 * template is stationery; the records made from it are not.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('clinical:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.prescriptionTemplate.findFirst({
    where: { id, hospitalId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  await prisma.prescriptionTemplate.update({ where: { id }, data: { isActive: false } })

  return NextResponse.json({
    success: true,
    retired: true,
    message: 'Template retired. Prescriptions already issued from it are unchanged.',
  })
}
