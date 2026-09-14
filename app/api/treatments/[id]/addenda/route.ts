import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { z } from 'zod'

/**
 * Addenda to a signed clinical note — FR-007's "later amendments".
 *
 * The ordinary way to say something further about a treatment once it is
 * signed. The note itself is untouched; the addendum is appended, attributed
 * and dated. There is no PUT or DELETE here on purpose: an append-only record
 * that can be edited is not an append-only record.
 *
 * `clinical:sign` rather than `clinical:write`, because an addendum is an
 * attributed clinical statement about a patient, the same kind of act as the
 * signature it hangs off.
 */

const addendumSchema = z.object({
  body: z
    .string({ error: 'An addendum needs some text' })
    .trim()
    .min(3, 'An addendum needs some text')
    .max(5000),
})

// GET /api/treatments/[id]/addenda
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const treatment = await prisma.treatment.findFirst({
      where: { id, hospitalId },
      select: { id: true },
    })
    if (!treatment) {
      return NextResponse.json({ error: 'Treatment not found' }, { status: 404 })
    }

    // Addenda only. Corrections live in the same table under
    // `kind: 'CORRECTION'` and are returned with the note itself, where they
    // sit beside the fields they changed.
    const addenda = await prisma.treatmentAmendment.findMany({
      where: { treatmentId: id, hospitalId, kind: 'ADDENDUM' },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ success: true, data: addenda, count: addenda.length })
  } catch (err) {
    console.error('List addenda error:', err)
    return NextResponse.json({ error: 'Failed to load addenda' }, { status: 500 })
  }
}

// POST /api/treatments/[id]/addenda
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('clinical:sign')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const data = addendumSchema.parse(await req.json())

    const treatment = await prisma.treatment.findFirst({
      where: { id, hospitalId },
      select: { id: true, treatmentNo: true, signedAt: true },
    })

    if (!treatment) {
      return NextResponse.json({ error: 'Treatment not found' }, { status: 404 })
    }

    // Before signing there is nothing to append to — the note is still being
    // written, so the text belongs in the note itself.
    if (!treatment.signedAt) {
      return NextResponse.json(
        {
          error: `${treatment.treatmentNo} is not signed yet — edit the note directly instead of adding an addendum`,
        },
        { status: 400 }
      )
    }

    const addendum = await prisma.treatmentAmendment.create({
      data: { hospitalId, treatmentId: id, kind: 'ADDENDUM', body: data.body, authorId: user.id },
      include: { author: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ success: true, data: addendum }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid addendum' },
        { status: 400 }
      )
    }
    console.error('Create addendum error:', err)
    return NextResponse.json({ error: 'Failed to add the addendum' }, { status: 500 })
  }
}
