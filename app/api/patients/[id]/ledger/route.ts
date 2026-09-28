import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { buildLedger } from '@/lib/ledger'
import { familyOf } from '@/lib/family'

/**
 * GET /api/patients/[id]/ledger — what this patient owes, and how it got there.
 *
 * `?family=true` widens it to everyone on the same account, which is what a
 * statement is. Off by default: the patient record's billing tab is about the
 * person whose record it is, and quietly showing somebody their mother's
 * treatment costs because they share a payer would be a disclosure nobody
 * asked for.
 *
 * Read-only and derived — see lib/ledger.ts for why nothing is stored.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const wantsFamily = new URL(request.url).searchParams.get('family') === 'true'

  try {
    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
      select: {
        id: true,
        patientId: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        guarantorId: true,
      },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    const family = await familyOf(hospitalId, id)
    const patientIds = wantsFamily && family ? family.patientIds : [id]

    const ledger = await buildLedger(hospitalId, patientIds)

    return NextResponse.json({
      patient,
      family,
      scope: wantsFamily ? 'family' : 'patient',
      ...ledger,
    })
  } catch (cause) {
    console.error('Error building patient ledger:', cause)
    return NextResponse.json({ error: 'Failed to build the ledger' }, { status: 500 })
  }
}
