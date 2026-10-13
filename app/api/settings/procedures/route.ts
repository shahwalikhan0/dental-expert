import { NextRequest, NextResponse } from 'next/server'
import { ProcedureCategory } from '@prisma/client'
import { requirePermission } from '@/lib/api-helpers'
import { enumRefusal, isEnumMember, knownErrorResponse } from '@/lib/api-errors'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const procedureSchema = z.object({
  code: z.string().min(1).toUpperCase(),
  name: z.string().min(1),
  category: z.enum([
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
  ]),
  description: z.string().optional(),
  defaultDuration: z.number().int().positive().default(30),
  // Zero is a price — a free consultation, a warranty redo (bug report 12 Oct,
  // finding 50). Negative is not.
  basePrice: z.number().min(0, 'The base price cannot be negative'),
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
  isActive: z.boolean().default(true),
})

// GET /api/settings/procedures - Get all procedures
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams
    const category = searchParams.get('category')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    const where: any = { hospitalId }
    if (category) {
      if (!isEnumMember(ProcedureCategory, category)) {
        return enumRefusal('Category', category, ProcedureCategory)
      }
      where.category = category
    }

    const [procedures, total] = await Promise.all([
      prisma.procedure.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.procedure.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: procedures,
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
    console.error('Get procedures error:', error)
    return NextResponse.json({ error: 'Failed to get procedures' }, { status: 500 })
  }
}

// POST /api/settings/procedures - Create new procedure
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const data = procedureSchema.parse(body)

    // Check if code already exists for this hospital
    const existing = await prisma.procedure.findFirst({
      where: { code: data.code, hospitalId },
    })

    if (existing) {
      return NextResponse.json({ error: 'Procedure code already exists' }, { status: 400 })
    }

    const procedure = await prisma.procedure.create({
      data: {
        ...data,
        hospitalId,
      },
    })

    return NextResponse.json({
      success: true,
      data: procedure,
      message: 'Procedure created successfully',
    })
  } catch (error) {
    // A price of -1, a category the catalogue does not have: a 400 that says
    // which, not a 500 with zod's issue list for the toast (finding 25).
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Create procedure error:', error)
    return NextResponse.json({ error: 'Failed to create procedure' }, { status: 500 })
  }
}
