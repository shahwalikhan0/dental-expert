import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET — distinct medication categories for this hospital
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('masters:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const rows = await prisma.medication.findMany({
      where: { hospitalId, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    })

    const categories = rows.map((r) => r.category).filter(Boolean)

    return NextResponse.json({ success: true, data: categories })
  } catch (err: any) {
    console.error('Error fetching medication categories:', err)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}
