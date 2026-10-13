import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { requirePermission } from '@/lib/api-helpers'
import { holderCan } from '@/lib/rbac'
import { knownErrorResponse } from '@/lib/api-errors'
import { readTeeth } from '@/lib/teeth'
import {
  diffClinicalFields,
  isSigned,
  isUsableReason,
  MIN_REASON_LENGTH,
  STANDALONE_NOTE_FIELDS,
} from '@/lib/clinical-notes'

/**
 * One free-standing clinical note — FR-007 applied to it in full.
 *
 * The rules are `Treatment`'s, and deliberately so: signing locks the note,
 * only a clinician may amend a signed one, the reason is mandatory and what the
 * note said before is written down. Two record types, one definition of
 * "signed" — shared through lib/clinical-notes.ts.
 */

const updateSchema = z.object({
  kind: z
    .enum(['CONSULTATION', 'PHONE_CALL', 'FOLLOW_UP', 'OBSERVATION', 'DECLINED_TREATMENT', 'OTHER'])
    .optional(),
  summary: z.string().trim().min(3).max(200).optional(),
  body: z.string().trim().min(3).max(20000).optional(),
  toothNumbers: z.string().trim().max(120).nullish(),
  amendmentReason: z.string().optional(),
})

const NOTE_INCLUDE = {
  author: { select: { id: true, name: true } },
  signedBy: { select: { id: true, name: true } },
  patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
  appointment: { select: { id: true, appointmentNo: true, startsAt: true } },
  amendments: {
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: { id: true, name: true } } },
  },
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const note = await prisma.clinicalNote.findFirst({
    where: { id, hospitalId },
    include: NOTE_INCLUDE,
  })

  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  return NextResponse.json(note)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('clinical:write')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const data = updateSchema.parse(await request.json())

    const existing = await prisma.clinicalNote.findFirst({ where: { id, hospitalId } })
    if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

    const signed = isSigned(existing)
    const changes = signed
      ? diffClinicalFields(
          existing as unknown as Record<string, unknown>,
          data as unknown as Record<string, unknown>,
          STANDALONE_NOTE_FIELDS
        )
      : {}
    const amends = Object.keys(changes).length > 0

    if (signed && amends) {
      // `clinical:sign`, not `clinical:delete`. ADMIN holds the latter and
      // deliberately cannot sign a note, so gating on it would let the one
      // role that may not author clinical content rewrite signed content.
      if (!holderCan(user, 'clinical:sign')) {
        return NextResponse.json(
          {
            error: `${existing.noteNo} is signed. Only a clinician can amend it, and the change will be recorded.`,
            signedAt: existing.signedAt,
            fields: Object.keys(changes),
          },
          { status: 409 }
        )
      }

      if (!isUsableReason(data.amendmentReason)) {
        return NextResponse.json(
          {
            error: `Amending a signed note needs a reason of at least ${MIN_REASON_LENGTH} characters saying what was wrong`,
            fields: Object.keys(changes),
          },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, unknown> = {}
    if (data.kind !== undefined) updateData.kind = data.kind
    if (data.summary !== undefined) updateData.summary = data.summary
    if (data.body !== undefined) updateData.body = data.body
    if (data.toothNumbers !== undefined) {
      // FDI numbers, permanent or primary, as on a treatment (bug report
      // 12 Oct, finding 54).
      const teeth = readTeeth(data.toothNumbers)
      if (!teeth.ok) return NextResponse.json({ error: teeth.error }, { status: 400 })
      updateData.toothNumbers = teeth.column
    }
    if (amends) updateData.amendedAt = new Date()

    // The correction and the record of it are one write, or neither happens.
    // A note changed without its trail is the silent overwrite this whole
    // mechanism exists to prevent.
    const note = await prisma.$transaction(async (tx) => {
      if (amends) {
        await tx.clinicalNoteAmendment.create({
          data: {
            hospitalId,
            noteId: id,
            kind: 'CORRECTION',
            body: data.amendmentReason!.trim(),
            // Prisma's Json input type does not accept a plain index
            // signature; the shape is `{ field: { from, to } }`.
            changes: changes as unknown as Prisma.InputJsonValue,
            authorId: user.id,
          },
        })
      }

      return tx.clinicalNote.update({ where: { id }, data: updateData, include: NOTE_INCLUDE })
    })

    return NextResponse.json(note)
  } catch (err) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Update clinical note error:', err)
    return NextResponse.json({ error: 'Failed to save the note' }, { status: 500 })
  }
}

/**
 * DELETE — only before signing, and only by the person who wrote it.
 *
 * A signed note cannot be deleted by anybody, ever; that is what signing is
 * for. An unsigned one is still a draft, and a draft somebody else started is
 * not yours to throw away.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, user } = await requirePermission('clinical:write')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const note = await prisma.clinicalNote.findFirst({
    where: { id, hospitalId },
    select: { id: true, noteNo: true, signedAt: true, authorId: true },
  })

  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  if (note.signedAt) {
    return NextResponse.json(
      {
        error: `${note.noteNo} is signed and cannot be deleted. Add an addendum saying what was wrong.`,
      },
      { status: 409 }
    )
  }

  if (note.authorId !== user.id) {
    return NextResponse.json(
      { error: 'Only the clinician who wrote a note can delete it before it is signed' },
      { status: 403 }
    )
  }

  await prisma.clinicalNote.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
