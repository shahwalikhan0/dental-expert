import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { nextInSeries, trailingNumber } from '@/lib/numbering'

/**
 * A patient's free-standing clinical notes — the record a procedure is not.
 *
 * See the `ClinicalNote` model for what this exists to stop: telephone calls,
 * declined treatment and observations being written into `Appointment.notes`,
 * a scheduling field with no author, no signature and no amendment trail.
 */

const KINDS = [
  'CONSULTATION',
  'PHONE_CALL',
  'FOLLOW_UP',
  'OBSERVATION',
  'DECLINED_TREATMENT',
  'OTHER',
] as const

const noteSchema = z.object({
  kind: z.enum(KINDS).default('CONSULTATION'),
  summary: z
    .string({ error: 'A note needs a one-line summary' })
    .trim()
    .min(3, 'A note needs a one-line summary')
    .max(200),
  body: z
    .string({ error: 'A note needs some text' })
    .trim()
    .min(3, 'A note needs some text')
    .max(20000),
  toothNumbers: z.string().trim().max(120).nullish(),
  appointmentId: z.string().trim().nullish(),
})

async function generateNoteNo(hospitalId: string): Promise<string> {
  const now = new Date()
  const prefix = `CN${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`

  return nextInSeries(prisma, {
    hospitalId,
    prefix,
    width: 4,
    currentMax: async () => {
      const last = await prisma.clinicalNote.findFirst({
        where: { hospitalId, noteNo: { startsWith: prefix } },
        orderBy: { noteNo: 'desc' },
        select: { noteNo: true },
      })
      return trailingNumber(last?.noteNo, 4)
    },
  })
}

const NOTE_INCLUDE = {
  author: { select: { id: true, name: true } },
  signedBy: { select: { id: true, name: true } },
  appointment: { select: { id: true, appointmentNo: true, startsAt: true } },
  amendments: {
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: { id: true, name: true } } },
  },
}

// GET /api/patients/[id]/notes
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('clinical:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind')
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200)

    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
      select: { id: true },
    })
    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

    const notes = await prisma.clinicalNote.findMany({
      where: {
        hospitalId,
        patientId: id,
        ...(kind && KINDS.includes(kind as (typeof KINDS)[number]) ? { kind: kind as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: NOTE_INCLUDE,
    })

    return NextResponse.json({ notes, count: notes.length })
  } catch (err) {
    console.error('List clinical notes error:', err)
    return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 })
  }
}

// POST /api/patients/[id]/notes
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('clinical:write')
  if (error || !hospitalId || !user?.id) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const data = noteSchema.parse(await request.json())

    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
      select: { id: true },
    })
    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

    // An appointment from another clinic, or one belonging to a different
    // patient, would put this note on the wrong visit. Checked rather than
    // trusted: the id comes from a form.
    let appointmentId: string | null = null
    if (data.appointmentId) {
      const appointment = await prisma.appointment.findFirst({
        where: { id: data.appointmentId, hospitalId, patientId: id },
        select: { id: true },
      })
      if (!appointment) {
        return NextResponse.json(
          { error: 'That appointment is not this patient’s' },
          { status: 400 }
        )
      }
      appointmentId = appointment.id
    }

    const note = await prisma.clinicalNote.create({
      data: {
        hospitalId,
        patientId: id,
        appointmentId,
        noteNo: await generateNoteNo(hospitalId),
        kind: data.kind,
        summary: data.summary,
        body: data.body,
        toothNumbers: data.toothNumbers || null,
        authorId: user.id,
      },
      include: NOTE_INCLUDE,
    })

    return NextResponse.json(note, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message || 'Invalid note' }, { status: 400 })
    }
    console.error('Create clinical note error:', err)
    return NextResponse.json({ error: 'Failed to save the note' }, { status: 500 })
  }
}
