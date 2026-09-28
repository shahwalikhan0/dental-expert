/**
 * GET /api/portal/me — who is signed in, and the clinic they belong to.
 *
 * Name, patient number, and the clinic's own name and telephone number. The
 * telephone number is here because it is the answer to almost every question
 * this portal raises and cannot answer: the portal is read-only by design, so
 * every "can I change this?" ends in a call to the desk.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePortalPatient } from '@/lib/portal/auth'

export async function GET() {
  const { error, caller } = await requirePortalPatient()
  if (error) return error

  const hospital = await prisma.hospital.findUnique({
    where: { id: caller.patient.hospitalId },
    select: { name: true, logo: true, slug: true, phone: true },
  })

  return NextResponse.json({
    success: true,
    data: {
      patient: {
        name: `${caller.patient.firstName} ${caller.patient.lastName}`.trim(),
        patientId: caller.patient.patientId,
      },
      clinic: {
        name: hospital?.name ?? '',
        logo: hospital?.logo ?? null,
        slug: hospital?.slug ?? '',
        phone: hospital?.phone ?? null,
      },
      mustChangePassword: caller.mustChangePassword,
    },
  })
}
