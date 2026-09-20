import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/** The kinds of recurring visit a clinic runs, and how often each comes round. */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const types = await prisma.recareType.findMany({
      where: { hospitalId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { recares: true } } },
    })

    return NextResponse.json({ types })
  } catch (err) {
    console.error('Error listing recare types:', err)
    return NextResponse.json({ error: 'Failed to load recare types' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const name = String(body.name ?? '').trim()
    const intervalMonths = Number(body.intervalMonths)

    if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })
    if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 120) {
      return NextResponse.json(
        { error: 'The interval must be a whole number of months between 1 and 120' },
        { status: 400 }
      )
    }

    const duplicate = await prisma.recareType.findFirst({
      where: { hospitalId, name },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: `"${name}" already exists` }, { status: 409 })
    }

    // One default. Setting a new one clears the old rather than leaving two,
    // because "the default" picked at random is not a default.
    const type = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.recareType.updateMany({ where: { hospitalId }, data: { isDefault: false } })
      }
      return tx.recareType.create({
        data: {
          hospitalId,
          name,
          intervalMonths,
          description: body.description?.trim() || null,
          sortOrder: Number(body.sortOrder) || 0,
          isDefault: Boolean(body.isDefault),
        },
      })
    })

    return NextResponse.json({ type }, { status: 201 })
  } catch (err) {
    console.error('Error creating recare type:', err)
    return NextResponse.json({ error: 'Failed to create the recare type' }, { status: 500 })
  }
}
