import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { duplicateMedicationMessage, findDuplicateMedication } from '@/lib/medication-catalogue'

// GET — list medications with search, category filter, pagination
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sp = request.nextUrl.searchParams
    const search = sp.get('search') || ''
    const category = sp.get('category') || ''
    const active = sp.get('active') // 'true' | 'false' | null (all)
    const page = parseInt(sp.get('page') || '1')
    const limit = parseInt(sp.get('limit') || '50')
    const skip = (page - 1) * limit

    // The grid shows newest first, so a record somebody has just added is the
    // top row rather than wherever its name falls. `sort=name` is for the
    // dropdowns that read the same endpoint, where a person scans for a name.
    const byName = sp.get('sort') === 'name'

    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { genericName: { contains: search, mode: 'insensitive' } },
        { manufacturer: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (category) {
      where.category = category
    }

    if (active === 'true') where.isActive = true
    else if (active === 'false') where.isActive = false

    const [medications, total] = await Promise.all([
      prisma.medication.findMany({
        where,
        orderBy: byName ? { name: 'asc' } : { createdAt: 'desc' },
        skip,
        take: limit,
        // Stock, so a prescriber can see whether the drug they are about to
        // write for is on the shelf. Only the two columns that question needs:
        // pulling whole inventory rows here would put purchase prices and
        // supplier terms into a dropdown that a dentist opens fifty times a
        // day. Soft-deleted stock is excluded — it is not on the shelf.
        include: {
          inventoryItems: {
            where: { deletedAt: null, isActive: true },
            select: { id: true, name: true, unit: true, currentStock: true, minimumStock: true },
          },
        },
      }),
      prisma.medication.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: medications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err: any) {
    console.error('Error fetching medications:', err)
    // Never `err.message`: a Prisma error names the server's paths and the
    // query (bug report 12 Oct, finding 4).
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to fetch medications' }, { status: 500 })
    )
  }
}

// POST — create a medication
export async function POST(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      name,
      genericName,
      category,
      form,
      strength,
      manufacturer,
      defaultDosage,
      defaultFrequency,
      defaultDuration,
      contraindications,
      sideEffects,
    } = body

    if (!name) {
      return NextResponse.json({ error: 'Medication name is required' }, { status: 400 })
    }

    // The same drug twice splits its stock, templates and search results
    // between two rows nobody can tell apart (finding 56).
    const duplicate = await findDuplicateMedication(hospitalId, {
      name,
      genericName,
      strength,
      form,
    })
    if (duplicate) {
      return NextResponse.json(
        { error: duplicateMedicationMessage(duplicate), duplicateOf: duplicate.id },
        { status: 409 }
      )
    }

    const medication = await prisma.medication.create({
      data: {
        hospitalId,
        name,
        genericName: genericName || null,
        category: category || null,
        form: form || null,
        strength: strength || null,
        manufacturer: manufacturer || null,
        defaultDosage: defaultDosage || null,
        defaultFrequency: defaultFrequency || null,
        defaultDuration: defaultDuration || null,
        contraindications: contraindications || null,
        sideEffects: sideEffects || null,
      },
    })

    await recordAudit({
      hospitalId,
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.MEDICATION_CREATED,
      entityType: 'Medication',
      entityId: medication.id,
      newValues: {
        name: medication.name,
        genericName: medication.genericName,
        form: medication.form,
        strength: medication.strength,
        defaultDosage: medication.defaultDosage,
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ success: true, data: medication }, { status: 201 })
  } catch (err: any) {
    console.error('Error creating medication:', err)
    return (
      knownErrorResponse(err) ??
      NextResponse.json({ error: 'Failed to create medication' }, { status: 500 })
    )
  }
}
