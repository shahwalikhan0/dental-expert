import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { ProcedureCategory } from '@prisma/client'
import { requirePermission } from '@/lib/api-helpers'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import { linkDefaultRecareProcedures } from '@/lib/recare'

// Generate unique procedure code
async function generateProcedureCode(category: string, hospitalId: string): Promise<string> {
  const prefixMap: Record<string, string> = {
    PREVENTIVE: 'PRV',
    RESTORATIVE: 'RST',
    ENDODONTIC: 'END',
    PERIODONTIC: 'PER',
    PROSTHODONTIC: 'PRS',
    ORTHODONTIC: 'ORT',
    ORAL_SURGERY: 'SRG',
    COSMETIC: 'COS',
    DIAGNOSTIC: 'DGN',
    EMERGENCY: 'EMR',
  }

  const prefix = prefixMap[category] || 'GEN'

  return nextInSeries(prisma, {
    hospitalId,
    prefix,
    width: 3,
    currentMax: async () => {
      const last = await prisma.procedure.findFirst({
        where: { hospitalId, code: { startsWith: prefix } },
        orderBy: { code: 'desc' },
        select: { code: true },
      })
      return trailingNumber(last?.code, 3)
    },
  })
}

// GET - List procedures with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const search = searchParams.get('search') || ''
    const category = searchParams.get('category') || ''
    const isActive = searchParams.get('isActive')
    const all = searchParams.get('all') === 'true'

    const skip = (page - 1) * limit

    // Build where clause
    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (category) {
      if (!isEnumMember(ProcedureCategory, category)) {
        return enumRefusal('Category', category, ProcedureCategory)
      }
      where.category = category
    }

    if (isActive !== null && isActive !== '') {
      where.isActive = isActive === 'true'
    }

    const [procedures, total] = await Promise.all([
      prisma.procedure.findMany({
        where,
        // Newest first on the grid, so a procedure somebody has just added is
        // the first row they see rather than buried under its category. `all`
        // is the unpaged picker mode, where a person scans for a name and
        // alphabetical is what they are scanning.
        orderBy: all ? [{ category: 'asc' }, { name: 'asc' }] : { createdAt: 'desc' },
        skip: all ? undefined : skip,
        take: all ? undefined : limit,
      }),
      prisma.procedure.count({ where }),
    ])

    return NextResponse.json({
      procedures,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching procedures:', error)
    return NextResponse.json({ error: 'Failed to fetch procedures' }, { status: 500 })
  }
}

// POST - Create new procedure
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      name,
      category,
      description,
      defaultDuration = 30,
      basePrice,
      materials,
      preInstructions,
      postInstructions,
      defaultDiagnosis,
      defaultFindings,
      defaultProcedureNotes,
      defaultFollowUpDays,
    } = body

    // Validate required fields. The price is checked for being there, not for
    // being truthy: `!basePrice` refused Rs 0, so a free consultation could
    // not be in the catalogue (bug report 12 Oct, finding 50).
    if (!name || !category || basePrice === undefined || basePrice === null || basePrice === '') {
      return NextResponse.json(
        { error: 'Name, category, and base price are required' },
        { status: 400 }
      )
    }
    if (!isEnumMember(ProcedureCategory, category)) {
      return enumRefusal('Category', category, ProcedureCategory)
    }
    const price = Number(basePrice)
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json(
        { error: 'The base price must be a number of zero or more' },
        { status: 400 }
      )
    }

    // Check if procedure name already exists
    const existingProcedure = await prisma.procedure.findFirst({
      where: {
        hospitalId,
        name: {
          equals: name,
        },
      },
    })

    if (existingProcedure) {
      return NextResponse.json(
        { error: 'A procedure with this name already exists' },
        { status: 409 }
      )
    }

    // Generate procedure code
    const code = await generateProcedureCode(category, hospitalId)

    // Create procedure
    const procedure = await prisma.procedure.create({
      data: {
        hospitalId,
        code,
        name,
        category,
        description,
        defaultDuration,
        basePrice: price,
        materials,
        preInstructions,
        postInstructions,
        defaultDiagnosis,
        defaultFindings,
        defaultProcedureNotes,
        // Coerced, because this arrives from a text input as a string. Passing
        // it through untouched hands Prisma "7" where it expects a number and
        // the whole create fails on a field nobody filled in on purpose.
        defaultFollowUpDays:
          defaultFollowUpDays === undefined ||
          defaultFollowUpDays === null ||
          defaultFollowUpDays === ''
            ? null
            : Number(defaultFollowUpDays),
        isActive: true,
      },
    })

    // A new clinic's catalogue is built after signup, one procedure at a time,
    // so this is where the default recall types get their links: a scaling
    // added here moves the "Scale and polish" recall when it is completed
    // (bug report 12 Oct, finding 46). Only the default types, by their
    // default names, and only this procedure; the recall types screen shows
    // the link and can undo it. Not worth failing the save over.
    await linkDefaultRecareProcedures(prisma, hospitalId, [procedure.id]).catch((err) =>
      console.error('Linking a new procedure to the default recalls failed:', err)
    )

    return NextResponse.json(procedure, { status: 201 })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating procedure:', error)
    return NextResponse.json({ error: 'Failed to create procedure' }, { status: 500 })
  }
}
