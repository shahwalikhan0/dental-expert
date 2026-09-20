import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { ALL_SITES, summarise, validDepth, validRecession, validTooth } from '@/lib/perio'
import { noteRecordAccess } from '@/lib/record-access'
import { requestContext } from '@/lib/audit'

/** GET — a patient's perio exams, newest first. */
export async function GET(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('clinical:read')
  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')
    if (!patientId) {
      return NextResponse.json({ error: 'A patient is required' }, { status: 400 })
    }

    const exams = await prisma.perioExam.findMany({
      where: { hospitalId, patientId },
      orderBy: { examDate: 'desc' },
      include: {
        recordedBy: { select: { id: true, name: true } },
        measurements: true,
        toothFindings: true,
      },
    })

    void noteRecordAccess({
      db: prisma,
      hospitalId,
      userId: user.id,
      patientId,
      kind: 'clinical',
      via: 'perio',
      ...requestContext(request.headers),
    })

    return NextResponse.json({
      exams: exams.map((exam) => ({ ...exam, summary: summarise(exam.measurements) })),
    })
  } catch (err) {
    console.error('Error listing perio exams:', err)
    return NextResponse.json({ error: 'Failed to load the periodontal charts' }, { status: 500 })
  }
}

/**
 * POST — record a periodontal examination.
 *
 * The whole chart arrives at once. A perio exam is one pass around the mouth on
 * one date, and saving it site by site would leave half-charts that read as
 * findings rather than as an unfinished exam.
 *
 * A site with no probing depth is not written. Absent means "not probed", which
 * is not the same as zero — and a row of zeroes would read as a perfectly
 * healthy mouth that nobody actually measured.
 */
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('clinical:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { patientId, examDate, notes } = body
    const measurements = Array.isArray(body.measurements) ? body.measurements : []
    const toothFindings = Array.isArray(body.toothFindings) ? body.toothFindings : []

    if (!patientId) {
      return NextResponse.json({ error: 'A patient is required' }, { status: 400 })
    }

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
      select: { id: true },
    })
    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

    const rows = []
    for (const m of measurements) {
      if (!validTooth(m.toothNumber)) {
        return NextResponse.json({ error: `${m.toothNumber} is not a tooth` }, { status: 400 })
      }
      if (!ALL_SITES.includes(m.site)) {
        return NextResponse.json({ error: `${m.site} is not a site` }, { status: 400 })
      }
      if (m.pocketDepth != null && !validDepth(m.pocketDepth)) {
        return NextResponse.json(
          { error: `A probing depth of ${m.pocketDepth}mm on ${m.toothNumber} is not plausible` },
          { status: 400 }
        )
      }
      if (m.recession != null && !validRecession(m.recession)) {
        return NextResponse.json(
          { error: `A recession of ${m.recession}mm on ${m.toothNumber} is not plausible` },
          { status: 400 }
        )
      }

      // Nothing recorded at this site: skip it rather than storing a blank row.
      if (
        m.pocketDepth == null &&
        m.recession == null &&
        !m.bleeding &&
        !m.suppuration &&
        !m.plaque
      ) {
        continue
      }

      rows.push({
        toothNumber: m.toothNumber,
        site: m.site,
        pocketDepth: m.pocketDepth ?? null,
        recession: m.recession ?? null,
        bleeding: Boolean(m.bleeding),
        suppuration: Boolean(m.suppuration),
        plaque: Boolean(m.plaque),
      })
    }

    if (rows.length === 0 && toothFindings.length === 0) {
      return NextResponse.json({ error: 'Nothing was recorded on this chart' }, { status: 400 })
    }

    const exam = await prisma.perioExam.create({
      data: {
        hospitalId,
        patientId,
        examDate: examDate ? new Date(examDate) : new Date(),
        notes: notes?.trim() || null,
        // Who probed. The same gap the tooth chart had until recently: a
        // clinical measurement nobody is standing behind.
        recordedById: session?.user?.id ?? null,
        measurements: { create: rows },
        toothFindings: {
          create: toothFindings
            .filter((f: { toothNumber: unknown }) => validTooth(f.toothNumber))
            .map((f: Record<string, unknown>) => ({
              toothNumber: f.toothNumber as number,
              mobility: f.mobility == null ? null : Number(f.mobility),
              furcation: f.furcation == null ? null : Number(f.furcation),
              isMissing: Boolean(f.isMissing),
              isImplant: Boolean(f.isImplant),
            })),
        },
      },
      include: {
        measurements: true,
        toothFindings: true,
        recordedBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(
      { exam: { ...exam, summary: summarise(exam.measurements) } },
      { status: 201 }
    )
  } catch (err) {
    console.error('Error creating perio exam:', err)
    return NextResponse.json({ error: 'Failed to save the periodontal chart' }, { status: 500 })
  }
}
