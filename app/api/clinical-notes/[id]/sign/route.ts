import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { holderCan } from '@/lib/rbac'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'

/**
 * POST /api/clinical-notes/[id]/sign — FR-007.
 *
 * `clinical:sign`, which only DOCTOR holds. There is no unsign; a note signed
 * in error is corrected the way any other mistake is, by an amendment that
 * says so.
 *
 * Unlike a treatment, there is no completion state to check first. A note is
 * finished when its author says it is — which is what signing it means.
 *
 * The same hole as treatments had (bug report 12 Oct, finding 12): any holder
 * of `clinical:sign` could sign any note. A note written by a clinician is
 * signed by that clinician and nobody else. A note written by somebody who
 * cannot sign — an assistant's chair-side note, an administrator's record of
 * a phone call — is countersigned by a clinician, or it could never be locked.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('clinical:sign')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const note = await prisma.clinicalNote.findFirst({
      where: { id, hospitalId },
      select: {
        id: true,
        noteNo: true,
        signedAt: true,
        patientId: true,
        authorId: true,
        author: {
          select: { id: true, name: true, role: true, clinicalRole: true, isActive: true },
        },
      },
    })

    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

    if (note.signedAt) {
      return NextResponse.json({ error: `${note.noteNo} is already signed` }, { status: 409 })
    }

    // An author who has since left cannot sign, so their note falls to a
    // colleague the same way an assistant's does.
    const authorMustSign =
      !!note.author && note.author.isActive && holderCan(note.author, 'clinical:sign')
    if (note.authorId !== user.id && authorMustSign) {
      return NextResponse.json(
        {
          error: `Only ${note.author!.name}, who wrote ${note.noteNo}, can sign it. A signature attests as the note's author.`,
        },
        { status: 403 }
      )
    }

    const signed = await prisma.clinicalNote.update({
      where: { id },
      data: { signedById: user.id, signedAt: new Date() },
      include: {
        author: { select: { id: true, name: true } },
        signedBy: { select: { id: true, name: true } },
      },
    })

    void recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.CLINICAL_NOTE_SIGNED,
      entityType: 'ClinicalNote',
      entityId: note.id,
      newValues: {
        noteNo: note.noteNo,
        patientId: note.patientId,
        authorId: note.authorId,
        signedAt: signed.signedAt,
      },
      ...requestContext(request.headers),
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
