import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/**
 * GET: the forms that can be filled in for a patient.
 *
 * The template list under /api/settings/forms needs `settings:read`, which the
 * front desk and the dentist do not hold — and they are who hands a patient a
 * medical history or a consent form. This is the same list, active templates
 * only, gated on `patients:write`: the permission POST /api/forms takes to
 * save the answers (16 Oct, finding 23).
 */
export async function GET() {
  const { error, hospitalId } = await requirePermission('patients:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const templates = await prisma.formTemplate.findMany({
      where: { hospitalId, isActive: true },
      select: { id: true, name: true, description: true, type: true, fields: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ templates })
  } catch (err) {
    console.error('List fillable forms error:', err)
    return NextResponse.json({ error: 'Failed to list forms' }, { status: 500 })
  }
}
