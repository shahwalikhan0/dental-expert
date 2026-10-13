import type { Prisma, PrismaClient } from '@prisma/client'

/** Works against the client or a transaction — both are used by callers. */
type Db = PrismaClient | Prisma.TransactionClient

export type TreatmentLink =
  | { ok: true; treatmentId: string | null | undefined }
  | { ok: false; status: 400 | 404; error: string }

/**
 * The treatment a lab case is for, checked (bug report 12 Oct, finding 60).
 *
 * The crown for Bilal's 46 had no link to the treatment it was made for, so
 * nobody could go from the preparation to the crown or back. The link is
 * optional — a night guard or a study model may be ordered with no treatment
 * behind it — but when one is given it has to be this patient's treatment, in
 * this clinic. A treatment id from another patient would put one person's
 * crown on another person's record.
 *
 * `undefined` means "not sent, leave it as it is"; null or a blank string
 * means "no treatment".
 */
export async function resolveTreatmentLink(
  db: Db,
  input: { hospitalId: string; patientId: string; treatmentId: unknown }
): Promise<TreatmentLink> {
  const { treatmentId } = input
  if (treatmentId === undefined) return { ok: true, treatmentId: undefined }
  if (treatmentId === null || treatmentId === '') return { ok: true, treatmentId: null }
  if (typeof treatmentId !== 'string') {
    return { ok: false, status: 400, error: 'treatmentId must be a treatment id' }
  }

  const treatment = await db.treatment.findFirst({
    where: { id: treatmentId, hospitalId: input.hospitalId },
    select: { id: true, patientId: true },
  })

  if (!treatment) return { ok: false, status: 404, error: 'Treatment not found' }
  if (treatment.patientId !== input.patientId) {
    return {
      ok: false,
      status: 400,
      error: 'That treatment belongs to a different patient',
    }
  }

  return { ok: true, treatmentId: treatment.id }
}
