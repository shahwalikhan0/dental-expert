import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { receivables } from '@/lib/ledger'

/**
 * GET /api/billing/receivables — who owes the clinic money, and for how long.
 *
 * `reports:financial` rather than `billing:read`. Reception can take a payment
 * and read an invoice; the list of everybody in arrears, aged, is a management
 * report and the roles that hold it are the ones that hold the others.
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('reports:financial')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? undefined

    // A balance of a few paise is rounding, not a debt. The floor keeps those
    // off a list whose whole purpose is deciding who to telephone.
    const minBalance = Number(searchParams.get('minBalance') ?? 1)

    const data = await receivables(hospitalId, {
      search,
      minBalance: Number.isFinite(minBalance) && minBalance > 0 ? minBalance : 1,
    })

    return NextResponse.json(data)
  } catch (cause) {
    console.error('Error building receivables:', cause)
    return NextResponse.json({ error: 'Failed to build the receivables list' }, { status: 500 })
  }
}
