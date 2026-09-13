import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/**
 * POST /api/treatments/[id]/sign — FR-007.
 *
 * Gated on `clinical:sign`, which only DOCTOR holds. ADMIN deliberately does
 * not: a signature attests as the treating provider, and a practice manager is
 * not one. The owner-dentist reaches it through their second `clinicalRole`.
 *
 * Signing is what locks the note. There is no unsign — that is the entire
 * point of a signature — so a note signed in error is corrected the same way
 * as any other mistake, by an amendment that says so.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('clinical:sign')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const treatment = await prisma.treatment.findFirst({
      where: { id, hospitalId },
      select: { id: true, treatmentNo: true, status: true, signedAt: true },
    })

    if (!treatment) {
      return NextResponse.json({ error: 'Treatment not found' }, { status: 404 })
    }

    if (treatment.signedAt) {
      return NextResponse.json(
        { error: `${treatment.treatmentNo} is already signed` },
        { status: 409 }
      )
    }

    // Signing an unfinished note would attest to work that has not happened.
    if (treatment.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: `Only a completed treatment can be signed — this one is ${treatment.status}` },
        { status: 400 }
      )
    }

    const signed = await prisma.treatment.update({
      where: { id },
      data: { signedById: user.id, signedAt: new Date() },
      include: {
        signedBy: { select: { id: true, name: true } },
        doctor: { select: { id: true, firstName: true, lastName: true } },
      },
    })

    return NextResponse.json({
      success: true,
      message: `${treatment.treatmentNo} signed and locked`,
      data: signed,
    })
  } catch (err) {
    console.error('Sign treatment error:', err)
    return NextResponse.json({ error: 'Failed to sign the treatment' }, { status: 500 })
  }
}
