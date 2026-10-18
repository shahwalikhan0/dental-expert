import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'
import { duplicateMedicationMessage, findDuplicateMedication } from '@/lib/medication-catalogue'

// GET — single medication
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const medication = await prisma.medication.findFirst({
      where: { id, hospitalId },
    })

    if (!medication) {
      return NextResponse.json({ error: 'Medication not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: medication })
  } catch (err: any) {
    console.error('Error fetching medication:', err)
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to fetch medication' }, { status: 500 })
    )
  }
}

// PUT — update medication
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await prisma.medication.findFirst({ where: { id, hospitalId } })
    if (!existing) {
      return NextResponse.json({ error: 'Medication not found' }, { status: 404 })
    }

    const body = await request.json()
    const data = {
      name: body.name ?? existing.name,
      genericName: body.genericName ?? existing.genericName,
      category: body.category ?? existing.category,
      form: body.form ?? existing.form,
      strength: body.strength ?? existing.strength,
      manufacturer: body.manufacturer ?? existing.manufacturer,
      defaultDosage: body.defaultDosage ?? existing.defaultDosage,
      defaultFrequency: body.defaultFrequency ?? existing.defaultFrequency,
      defaultDuration: body.defaultDuration ?? existing.defaultDuration,
      contraindications: body.contraindications ?? existing.contraindications,
      sideEffects: body.sideEffects ?? existing.sideEffects,
      isActive: body.isActive ?? existing.isActive,
    }

    /*
     * An edit can make two entries the same drug as surely as an add can —
     * renaming one, or reactivating a retired copy of something now stocked
     * again (finding 56). Checked against what the entry will be, and only
     * when it will be active: a retired duplicate is history, not a clash.
     */
    if (data.isActive) {
      const duplicate = await findDuplicateMedication(hospitalId, data, id)
      if (duplicate) {
        return NextResponse.json(
          { error: duplicateMedicationMessage(duplicate), duplicateOf: duplicate.id },
          { status: 409 }
        )
      }
    }

    const medication = await prisma.medication.update({ where: { id }, data })

    // Only what changed, before and after (16 Oct, finding 14).
    const change = diffValues(existing, data)
    if (change.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.MEDICATION_UPDATED,
        entityType: 'Medication',
        entityId: id,
        oldValues: change.before,
        newValues: { name: medication.name, ...change.after },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json({ success: true, data: medication })
  } catch (err: any) {
    console.error('Error updating medication:', err)
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to update medication' }, { status: 500 })
    )
  }
}

// DELETE — deactivate medication (soft)
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
    const existing = await prisma.medication.findFirst({ where: { id, hospitalId } })
    if (!existing) {
      return NextResponse.json({ error: 'Medication not found' }, { status: 404 })
    }

    await prisma.medication.update({ where: { id }, data: { isActive: false } })

    if (existing.isActive) {
      await recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.MEDICATION_DEACTIVATED,
        entityType: 'Medication',
        entityId: id,
        oldValues: { isActive: true },
        newValues: { name: existing.name, strength: existing.strength, isActive: false },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json({ success: true, message: 'Medication deactivated' })
  } catch (err: any) {
    console.error('Error deleting medication:', err)
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to delete medication' }, { status: 500 })
    )
  }
}
