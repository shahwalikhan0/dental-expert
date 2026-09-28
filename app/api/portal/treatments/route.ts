/**
 * GET /api/portal/treatments — what was done, when, by whom, and what it cost.
 *
 * What is *not* selected is the point of this file. `Treatment` also carries
 * `diagnosis`, `findings`, `procedureNotes` and `complications`: free text one
 * clinician wrote for another. Releasing those to a patient unread, at
 * whatever hour they happen to open the page, is how somebody reads a
 * differential diagnosis before anybody has spoken to them about it. They are
 * omitted deliberately and this comment is why; adding one is a clinical
 * decision for the practice, not a field somebody forgot.
 *
 * PLANNED treatments are left out too. A plan is a proposal the dentist may
 * not have discussed yet, and a patient reading a costed plan they have never
 * been offered will reasonably believe it has been decided.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePortalPatient } from '@/lib/portal/auth'
import { parseTeeth } from '@/lib/teeth'

export async function GET() {
  const { error, caller } = await requirePortalPatient()
  if (error) return error

  const treatments = await prisma.treatment.findMany({
    where: {
      // Both, always. The patient id alone would be enough given it is a cuid,
      // but a scope that depends on an id being unguessable is not a scope.
      patientId: caller.patient.id,
      hospitalId: caller.patient.hospitalId,
      status: { in: ['IN_PROGRESS', 'COMPLETED'] },
    },
    select: {
      id: true,
      treatmentNo: true,
      toothNumbers: true,
      status: true,
      cost: true,
      startTime: true,
      createdAt: true,
      procedure: { select: { name: true } },
      doctor: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ startTime: 'desc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json({
    success: true,
    data: treatments.map((t) => ({
      id: t.id,
      treatmentNo: t.treatmentNo,
      procedure: t.procedure.name,
      teeth: parseTeeth(t.toothNumbers),
      status: t.status,
      cost: Number(t.cost),
      date: t.startTime ?? t.createdAt,
      dentist: `${t.doctor.firstName} ${t.doctor.lastName}`.trim(),
    })),
  })
}
