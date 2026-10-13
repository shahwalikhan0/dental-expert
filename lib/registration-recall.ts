import type { Prisma, PrismaClient } from '@prisma/client'
import { ageInYears } from '@/lib/age'
import { nextDueDate, startDefaultRecare } from '@/lib/recare'

/**
 * Which recall a newly registered patient starts on.
 *
 * Every patient used to be given the clinic's default — "Scale and polish" in
 * the types every clinic is created with — whatever their age (bug report
 * 12 Oct, finding 61). An eleven-year-old was put on the adult hygiene list
 * while the "Child check-up" type sat unused beside it, and the desk working
 * the list rang a parent about a scale and polish for a child with milk teeth.
 *
 * `RecareType` has no age column, and adding one is a schema change for one
 * decision. The clinic's own child type is recognised by its name instead —
 * the seeded one is "Child check-up", and a clinic that renames it to
 * "Paediatric recall" or "Kids check-up" is still saying the same thing.
 */

/**
 * Under this age a patient is a child for recall purposes. Twelve and under:
 * the mixed dentition, which is what a child check-up is for. A thirteen-year-
 * old with a full permanent set is on the adult hygiene interval.
 */
export const CHILD_RECALL_UNDER_AGE = 13

/** The names a clinic gives its children's recall. Case is ignored. */
const CHILD_TYPE_NAMES = ['child', 'paediatric', 'pediatric', 'kids']

type RecareClient = PrismaClient | Prisma.TransactionClient

/** Whether this date of birth makes the patient a child for recall. Unknown is not. */
export function isChildForRecall(
  dateOfBirth: Date | string | null | undefined,
  at: Date = new Date()
): boolean {
  const age = ageInYears(dateOfBirth, at)
  return age !== null && age < CHILD_RECALL_UNDER_AGE
}

/**
 * Start a newly registered patient on the recall that suits their age.
 *
 * A child goes on the clinic's active child type when it has one. Everybody
 * else — an adult, a child at a clinic with no child type, and a patient whose
 * date of birth nobody gave — goes on the clinic's default, exactly as before.
 * Unknown age is treated as adult deliberately: most patients are adults, and
 * the adult hygiene recall is the one a missing birth date costs least to get
 * wrong.
 */
export async function startRegistrationRecare(
  db: RecareClient,
  hospitalId: string,
  patientId: string,
  dateOfBirth: Date | string | null | undefined,
  from: Date = new Date()
): Promise<void> {
  if (isChildForRecall(dateOfBirth, from)) {
    const childType = await db.recareType.findFirst({
      where: {
        hospitalId,
        isActive: true,
        OR: CHILD_TYPE_NAMES.map((name) => ({
          name: { contains: name, mode: 'insensitive' as const },
        })),
      },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, intervalMonths: true },
    })

    if (childType) {
      await db.recare.upsert({
        where: { patientId_recareTypeId: { patientId, recareTypeId: childType.id } },
        update: {},
        create: {
          hospitalId,
          patientId,
          recareTypeId: childType.id,
          dueDate: nextDueDate(from, childType.intervalMonths),
        },
      })
      return
    }
  }

  await startDefaultRecare(db, hospitalId, patientId, from)
}
