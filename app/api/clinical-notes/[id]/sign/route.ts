import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/**
 * POST /api/clinical-notes/[id]/sign — FR-007.
 *
 * `clinical:sign`, which only DOCTOR holds. There is no unsign; a note signed
 * in error is corrected the way any other mistake is, by an amendment that
 * says so.
 *
 * Unlike a treatment, there is no completion state to check first. A note is
 * finished when its author says it is — which is what signing it means.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('clinical:sign')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const note = await prisma.clinicalNote.findFirst({
      where: { id, hospitalId },
      select: { id: true, noteNo: true, signedAt: true },
    })

    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

    if (note.signedAt) {
      return NextResponse.json({ error: `${note.noteNo} is already signed` }, { status: 409 })
    }

    const signed = await prisma.clinicalNote.update({
      where: { id },
      data: { signedById: user.id, signedAt: new Date() },
      include: {
        author: { select: { id: true, name: true } },
        signedBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      success: true,
      message: `${note.noteNo} signed and locked`,
      data: signed,
    })
  } catch (err) {
    console.error('Sign clinical note error:', err)
    return NextResponse.json({ error: 'Failed to sign the note' }, { status: 500 })
  }
}
