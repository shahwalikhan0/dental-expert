import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/**
 * Addenda to a signed note. The same contract as a treatment's — appended,
 * attributed, dated, and with no PUT or DELETE, because an append-only record
 * that can be edited is not an append-only record.
 */

const addendumSchema = z.object({
  body: z
    .string({ error: 'An addendum needs some text' })
    .trim()
    .min(3, 'An addendum needs some text')
    .max(5000),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('clinical:sign')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const data = addendumSchema.parse(await request.json())

    const note = await prisma.clinicalNote.findFirst({
      where: { id, hospitalId },
      select: { id: true, noteNo: true, signedAt: true },
    })

    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

    // Before signing there is nothing to append to: the note is still being
    // written, so the text belongs in the note itself.
    if (!note.signedAt) {
      return NextResponse.json(
        {
          error: `${note.noteNo} is not signed yet — edit it directly instead of adding an addendum`,
        },
        { status: 400 }
      )
    }

    const addendum = await prisma.clinicalNoteAmendment.create({
      data: { hospitalId, noteId: id, kind: 'ADDENDUM', body: data.body, authorId: user.id },
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
    console.error('Create note addendum error:', err)
    return NextResponse.json({ error: 'Failed to add the addendum' }, { status: 500 })
  }
}
