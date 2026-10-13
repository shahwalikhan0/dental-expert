/**
 * The prescriptions a clinic writes over and over.
 *
 * Clinic-wide, like `FormTemplate` and `CommunicationTemplate`: a dentist who
 * improves the post-extraction wording improves it for the practice. There is
 * no owner column and no visibility rule, on purpose — a template nobody else
 * can see is a note, and notes belong in a note.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { everyTermMatches, like } from '@/lib/search-terms'
import { templateRefusal } from '@/lib/prescription-templates'
import { itemRows, templateMedicationRefusal } from '@/lib/prescription-template-lines'

const ITEM_INCLUDE = {
  items: {
    orderBy: { sortOrder: 'asc' as const },
    // `isActive` so the screens can mark a line whose drug has since been
    // retired from the catalogue (bug report 12 Oct, finding 48).
    include: {
      medication: { select: { id: true, name: true, genericName: true, isActive: true } },
    },
  },
}

// GET — list templates
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sp = request.nextUrl.searchParams
    const search = sp.get('search') || ''
    // The prescribing form asks for active ones only; the management screen
    // asks for everything, so it can show what has been retired and put it
    // back.
    const includeInactive = sp.get('includeInactive') === 'true'

    const where: any = { hospitalId }
    if (!includeInactive) where.isActive = true

    const terms = everyTermMatches(search, (term) => [
      { name: like(term) },
      { description: like(term) },
      { category: like(term) },
      // A dentist looks for the template by the drug in it as often as by its
      // name — "the one with the metronidazole".
      { items: { some: { medicationName: like(term) } } },
    ])
    if (terms) Object.assign(where, terms)

    const templates = await prisma.prescriptionTemplate.findMany({
      where,
      include: ITEM_INCLUDE,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return NextResponse.json({ success: true, data: templates })
  } catch (err: any) {
    console.error('Error fetching prescription templates:', err)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

// POST — create a template
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('clinical:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, description, category, diagnosis, notes, items } = body

    const refusal = templateRefusal({ name, items })
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

    const medicineRefusal = await templateMedicationRefusal(hospitalId, items)
    if (medicineRefusal) return NextResponse.json({ error: medicineRefusal }, { status: 400 })

    // Two templates called "Post-extraction" in one clinic is a mistake rather
    // than a choice: whichever one you picked from the list would be a coin
    // toss. Checked here as well as by the unique index so the answer is a
    // sentence rather than a constraint violation.
    const clash = await prisma.prescriptionTemplate.findFirst({
      where: { hospitalId, name: name.trim() },
      select: { id: true, isActive: true },
    })
    if (clash) {
      return NextResponse.json(
        {
          error: clash.isActive
            ? 'A template with that name already exists'
            : 'A retired template has that name. Reactivate it instead, or choose another name.',
        },
        { status: 409 }
      )
    }

    const template = await prisma.prescriptionTemplate.create({
      data: {
        hospitalId,
        name: name.trim(),
        description: description?.trim() || null,
        category: category?.trim() || null,
        diagnosis: diagnosis?.trim() || null,
        notes: notes?.trim() || null,
        createdById: session?.user?.id || null,
        items: {
          create: itemRows(items),
        },
      },
      include: ITEM_INCLUDE,
    })

    return NextResponse.json({ success: true, data: template }, { status: 201 })
  } catch (err: any) {
    console.error('Error creating prescription template:', err)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
