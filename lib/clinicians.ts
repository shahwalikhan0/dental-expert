import { prisma } from '@/lib/prisma'

/**
 * Who may be the dentist on a booking, a treatment or a plan.
 *
 * Booking and treatments checked only that the staff id belonged to the
 * clinic (bug report 12 Oct, finding 7), so the receptionist, or a dentist
 * deactivated that morning, could be booked as the treating dentist. A
 * dentist here is an active staff member whose active account holds DOCTOR as
 * its role or as its second, clinical role — the same people the dentist
 * picker offers.
 */
export const DENTIST_WHERE = {
  isActive: true,
  user: {
    isActive: true,
    OR: [{ role: 'DOCTOR' as const }, { clinicalRole: 'DOCTOR' as const }],
  },
}

export async function findDentist(hospitalId: string, staffId: string | null | undefined) {
  if (!staffId) return null
  return prisma.staff.findFirst({
    where: { id: staffId, hospitalId, ...DENTIST_WHERE },
    select: { id: true, firstName: true, lastName: true, userId: true },
  })
}

/** The 400 a route returns when `findDentist` comes back empty. */
export const NOT_A_DENTIST =
  'Choose an active dentist at this clinic. That staff member is not a dentist, or is no longer active.'

/**
 * Who may be the assistant on a booking: an active staff member whose active
 * account holds DENTAL_ASSISTANT as its role or as its second, clinical role.
 */
export const ASSISTANT_WHERE = {
  isActive: true,
  user: {
    isActive: true,
    OR: [{ role: 'DENTAL_ASSISTANT' as const }, { clinicalRole: 'DENTAL_ASSISTANT' as const }],
  },
}

/** Everybody who sees patients: the dentists and the assistants. */
export const CLINICIAN_WHERE = {
  isActive: true,
  user: {
    isActive: true,
    OR: [
      { role: 'DOCTOR' as const },
      { clinicalRole: 'DOCTOR' as const },
      { role: 'DENTAL_ASSISTANT' as const },
      { clinicalRole: 'DENTAL_ASSISTANT' as const },
    ],
  },
}

export async function findAssistant(hospitalId: string, staffId: string | null | undefined) {
  if (!staffId) return null
  return prisma.staff.findFirst({
    where: { id: staffId, hospitalId, ...ASSISTANT_WHERE },
    select: { id: true, firstName: true, lastName: true, userId: true },
  })
}

/** The 400 a route returns when `findAssistant` comes back empty. */
export const NOT_AN_ASSISTANT =
  'Choose an active dental assistant at this clinic. That staff member is not an assistant, or is no longer active.'
