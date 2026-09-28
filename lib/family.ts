import { prisma } from '@/lib/prisma'

/**
 * Who pays for whom.
 *
 * A practice does not bill individuals, it bills households. A mother brings
 * three children; they hold three patient records, because each of them has
 * their own teeth and their own clinical history, and there is one person who
 * settles the account and one statement that should go out. Without this the
 * clinic sends four statements to one address, one of them to a seven-year-old.
 *
 * Modelled as `Patient.guarantorId`, a self-reference, rather than as a
 * household table. The question a practice asks is "who do I address this to",
 * and the answer is always another patient of the clinic — so a household table
 * would be a row nobody ever edits which still has to name a payer inside it.
 *
 * **One hop, and no further.** If A's guarantor is B and B's guarantor is C,
 * this treats B as A's payer and stops. Following the chain would mean a cycle
 * check on every statement and, worse, a household whose membership nobody at
 * the desk can predict from the two records in front of them. The database
 * refuses self-reference (`Patient_guarantor_not_self`); everything else here
 * is a deliberate flattening.
 */

export interface FamilyMember {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  isActive: boolean
  /** True for the person the account is addressed to. */
  isGuarantor: boolean
}

export interface Family {
  /** The patient the account is settled by — the patient themselves if nobody else. */
  guarantorId: string
  /** Everyone on the account, the guarantor first. */
  members: FamilyMember[]
  /** Every id on the account, for a `patientId: { in: … }` query. */
  patientIds: string[]
  /** False when this patient pays for themselves and nobody else. */
  isShared: boolean
}

const MEMBER_FIELDS = {
  id: true,
  patientId: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
} as const

/**
 * The account this patient's money belongs to.
 *
 * Resolves upward first — if somebody else settles this patient's bills, the
 * account is theirs — and then collects everyone that payer covers. A patient
 * with no guarantor and no dependants gets an account of one, which is the
 * common case and must stay indistinguishable from having no family at all.
 */
export async function familyOf(hospitalId: string, patientId: string): Promise<Family | null> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, hospitalId },
    select: { ...MEMBER_FIELDS, guarantorId: true },
  })
  if (!patient) return null

  const guarantorId = patient.guarantorId ?? patient.id

  const guarantor =
    guarantorId === patient.id
      ? patient
      : await prisma.patient.findFirst({
          where: { id: guarantorId, hospitalId },
          select: MEMBER_FIELDS,
        })

  // A guarantor pointing at a record in another clinic, or at one that has been
  // deleted, should not take the patient's own account down with it.
  if (!guarantor) {
    return {
      guarantorId: patient.id,
      members: [{ ...patient, isGuarantor: true }],
      patientIds: [patient.id],
      isShared: false,
    }
  }

  const dependants = await prisma.patient.findMany({
    where: { hospitalId, guarantorId },
    select: MEMBER_FIELDS,
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  })

  const members: FamilyMember[] = [
    { ...guarantor, isGuarantor: true },
    ...dependants.map((member) => ({ ...member, isGuarantor: false })),
  ]

  return {
    guarantorId,
    members,
    patientIds: members.map((member) => member.id),
    isShared: members.length > 1,
  }
}

/**
 * Whether `candidateId` may be set as `patientId`'s guarantor.
 *
 * Three refusals, and each one is a shape the ledger cannot read:
 *
 *  - **itself**, which would make the rollup count a balance twice. The
 *    database refuses this too; this is the message a person gets;
 *  - **somebody who already has a guarantor of their own**, because the
 *    one-hop rule above would silently drop the third person out of the
 *    household they think they are in;
 *  - **somebody who already depends on this patient**, which is the two-record
 *    cycle — each paying for the other, and neither statement terminating.
 */
export async function guarantorRefusal(
  hospitalId: string,
  patientId: string,
  candidateId: string
): Promise<string | null> {
  if (patientId === candidateId) {
    return 'A patient cannot be their own guarantor.'
  }

  const candidate = await prisma.patient.findFirst({
    where: { id: candidateId, hospitalId },
    select: { id: true, guarantorId: true, firstName: true, lastName: true },
  })
  if (!candidate) return 'That patient is not on this clinic’s register.'

  // The cycle first, because it has the more useful message. Both cases are
  // "the candidate already has a guarantor"; only this one is the candidate
  // already being on *this* patient's account.
  if (candidate.guarantorId === patientId) {
    return `${candidate.firstName} ${candidate.lastName} is already on this patient’s account. Two people cannot settle each other’s bills.`
  }

  if (candidate.guarantorId) {
    return `${candidate.firstName} ${candidate.lastName}’s own bills are settled by somebody else. Accounts are one level deep, so pick the person who settles them.`
  }

  return null
}

/**
 * Patients whose own bills this one settles.
 *
 * Used by the patient record, and by the delete path: clearing a guarantor out
 * from under a household silently is how a statement stops arriving without
 * anybody noticing. `onDelete: SetNull` makes the database safe; this makes it
 * visible.
 */
export async function dependantsOf(hospitalId: string, patientId: string) {
  return prisma.patient.findMany({
    where: { hospitalId, guarantorId: patientId },
    select: MEMBER_FIELDS,
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  })
}
