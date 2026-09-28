/**
 * GET /api/portal/prescriptions — what the patient was told to take.
 *
 * Complete, unlike the treatment list, because a partial prescription is worse
 * than none: dosage, frequency, duration and timing are the instruction, and a
 * patient reading three of the four will guess the fourth.
 *
 * `diagnosis` on the prescription is omitted for the same reason the treatment
 * route omits its clinical free text. The medicines are what this page is for.
 * `notes` *is* included — that field is the instruction to the patient, and it
 * is written to be read by them ("rinse with warm salt water from tomorrow").
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePortalPatient } from '@/lib/portal/auth'
import { parseTeeth } from '@/lib/teeth'

export async function GET() {
  const { error, caller } = await requirePortalPatient()
  if (error) return error

  const prescriptions = await prisma.prescription.findMany({
    where: {
      patientId: caller.patient.id,
      hospitalId: caller.patient.hospitalId,
    },
    select: {
      id: true,
      prescriptionNo: true,
      toothNumbers: true,
      notes: true,
      validUntil: true,
      createdAt: true,
      doctor: { select: { firstName: true, lastName: true } },
      medications: {
        select: {
          id: true,
          medicationName: true,
          dosage: true,
          frequency: true,
          duration: true,
          route: true,
          timing: true,
          instructions: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    success: true,
    data: prescriptions.map((rx) => ({
      id: rx.id,
      prescriptionNo: rx.prescriptionNo,
      teeth: parseTeeth(rx.toothNumbers),
      notes: rx.notes,
      validUntil: rx.validUntil,
      date: rx.createdAt,
      dentist: `${rx.doctor.firstName} ${rx.doctor.lastName}`.trim(),
      medicines: rx.medications,
    })),
  })
}
