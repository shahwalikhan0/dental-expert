import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { validateVisitor } from '@/lib/visitors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

/**
 * Walk-ins who have not been registered.
 *
 * `state` narrows the list the way the desk thinks about it: `open` is the
 * decision queue — people seen but not yet either registered or written off —
 * and it is the default, because it is the only one anybody works.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('patients:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const state = searchParams.get('state') || 'open'
    const search = searchParams.get('search')?.trim() || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))

    const where: Record<string, unknown> = { hospitalId }

    if (state === 'open') Object.assign(where, { convertedAt: null, discardedAt: null })
    else if (state === 'converted') Object.assign(where, { convertedAt: { not: null } })
    else if (state === 'discarded') Object.assign(where, { discardedAt: { not: null } })

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ]
    }

    const [visitors, total] = await Promise.all([
      prisma.visitor.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          convertedPatient: { select: { id: true, patientId: true } },
          convertedBy: { select: { id: true, name: true } },
          discardedBy: { select: { id: true, name: true } },
          _count: { select: { appointments: true } },
        },
      }),
      prisma.visitor.count({ where }),
    ])

    return NextResponse.json({
      visitors,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('Error listing visitors:', err)
    return NextResponse.json({ error: 'Failed to list visitors' }, { status: 500 })
  }
}

/**
 * A visitor with no appointment.
 *
 * Booking a walk-in creates the visitor and the appointment together, which is
 * the ordinary path. This exists for the desk taking a name before it knows
 * which dentist is free.
 */
export async function POST(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('patients:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const invalid = validateVisitor(body)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    const visitor = await prisma.visitor.create({
      data: {
        hospitalId,
        name: String(body.name).trim(),
        phone: body.phone ? String(body.phone).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
      },
    })

    await recordAudit({
      hospitalId,
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.VISITOR_CREATED,
      entityType: 'Visitor',
      entityId: visitor.id,
      newValues: { name: visitor.name, phone: visitor.phone },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ visitor }, { status: 201 })
  } catch (err) {
    console.error('Error creating visitor:', err)
    return NextResponse.json({ error: 'Failed to create visitor' }, { status: 500 })
  }
}
