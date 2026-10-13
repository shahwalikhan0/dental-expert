import type { Prisma, PrismaClient, TreatmentPlanStatus } from '@prisma/client'

/**
 * A treatment plan's status, and the plan items that move it.
 *
 * Two things were missing (bug report 12 Oct, findings 11 and 34):
 *
 *  - **Nothing moved an item.** A plan item's Start button opened a new
 *    treatment with no link back, so a root canal could be done, completed and
 *    signed and its plan still said PENDING. `TreatmentPlanItem.treatmentId`
 *    is that link now, and the functions below are what a treatment does to
 *    the item it carries out as it starts, finishes or is dropped.
 *  - **Any status went to any other.** A plan was marked Completed with all
 *    three items pending, then reopened. The table below is the rule.
 */

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Which plan statuses may follow which.
 *
 *   DRAFT       → PROPOSED, CANCELLED
 *   PROPOSED    → DRAFT (taken back to rework), ACCEPTED, CANCELLED
 *   ACCEPTED    → PROPOSED (consent withdrawn), IN_PROGRESS, CANCELLED
 *   IN_PROGRESS → COMPLETED, CANCELLED
 *   COMPLETED   → nothing
 *   CANCELLED   → nothing
 *
 * COMPLETED and CANCELLED are final. Reopening either would make a plan say
 * something different from what was agreed and done; more work, or a change of
 * mind, is a new plan, which can copy the old one's items. IN_PROGRESS does not
 * go back to ACCEPTED: once a step has been started it has been started.
 *
 * Staying where it is is always allowed — the consent dialog sends the plan's
 * current status alongside the consent, and that is not a transition.
 */
export const PLAN_TRANSITIONS: Record<TreatmentPlanStatus, readonly TreatmentPlanStatus[]> = {
  DRAFT: ['PROPOSED', 'CANCELLED'],
  PROPOSED: ['DRAFT', 'ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PROPOSED', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export const PLAN_STATUSES = Object.keys(PLAN_TRANSITIONS) as TreatmentPlanStatus[]

/** Item statuses that mean there is nothing left to do on that step. */
const FINISHED_ITEM = new Set(['COMPLETED', 'CANCELLED'])

/** Every step done or dropped, and at least one done. */
export function planIsFinished(items: { status: string }[]): boolean {
  return (
    items.length > 0 &&
    items.every((item) => FINISHED_ITEM.has(item.status)) &&
    items.some((item) => item.status === 'COMPLETED')
  )
}

/**
 * Why a plan may not move from `from` to `to`, or null if it may.
 *
 * `items` are the plan's items as they will be after this request, so that an
 * edit which cancels the last pending step and completes the plan in one save
 * is judged on the result.
 */
export function planTransitionRefusal(
  from: string,
  to: string,
  items: { status: string }[]
): string | null {
  if (!(PLAN_STATUSES as string[]).includes(to)) {
    return `Status "${to}" is not valid. Use one of: ${PLAN_STATUSES.join(', ')}.`
  }
  if (from === to) return null

  const allowed = PLAN_TRANSITIONS[from as TreatmentPlanStatus] ?? []
  if (!allowed.includes(to as TreatmentPlanStatus)) {
    if (from === 'COMPLETED' || from === 'CANCELLED') {
      return `This plan is ${from.toLowerCase()} and cannot be reopened. Start a new plan instead.`
    }
    return `A ${label(from)} plan cannot be moved to ${label(to)}.`
  }

  if (to === 'COMPLETED' && !planIsFinished(items)) {
    const left = items.filter((item) => !FINISHED_ITEM.has(item.status)).length
    return left > 0
      ? `${left} step${left === 1 ? ' is' : 's are'} not done yet. Complete or cancel ${left === 1 ? 'it' : 'them'} before completing the plan.`
      : 'Nothing in this plan has been done, so it cannot be completed. Cancel it instead.'
  }

  return null
}

function label(status: string): string {
  return status.toLowerCase().replace('_', ' ')
}

/** The plan statuses a step can be started from. */
export const STARTABLE_PLAN = new Set(['ACCEPTED', 'IN_PROGRESS'])
/** And the item statuses. */
export const STARTABLE_ITEM = new Set(['PENDING', 'SCHEDULED'])

/**
 * A treatment has been started from a plan item: link the two, mark the item
 * in progress, and the plan with it if this is its first step.
 *
 * Conditional on the item still being free, because two clicks on Start can
 * both pass the route's checks; the second finds the item taken and the whole
 * write — treatment included — is rolled back.
 */
export async function linkPlanItem(
  db: Db,
  args: { planItemId: string; planId: string; planStatus: string; treatmentId: string }
): Promise<void> {
  const claimed = await db.treatmentPlanItem.updateMany({
    where: {
      id: args.planItemId,
      treatmentId: null,
      status: { in: [...STARTABLE_ITEM] as ('PENDING' | 'SCHEDULED')[] },
    },
    data: { treatmentId: args.treatmentId, status: 'IN_PROGRESS' },
  })
  if (claimed.count !== 1) throw new PlanItemTaken()

  if (args.planStatus === 'ACCEPTED') {
    await db.treatmentPlan.update({
      where: { id: args.planId },
      data: { status: 'IN_PROGRESS' },
    })
  }
}

/** Thrown inside the create transaction when the item was taken first. */
export class PlanItemTaken extends Error {
  constructor() {
    super('That plan step has already been started by another treatment.')
  }
}

/**
 * The treatment carrying out a plan item is complete: so is the item, and if
 * that was the plan's last open step, so is the plan.
 *
 * Silent when the treatment did not come from a plan.
 */
export async function completePlanItemFor(
  db: Db,
  treatmentId: string,
  completedAt: Date = new Date()
): Promise<void> {
  const item = await db.treatmentPlanItem.findFirst({
    where: { treatmentId },
    select: { id: true, treatmentPlanId: true },
  })
  if (!item) return

  await db.treatmentPlanItem.update({
    where: { id: item.id },
    data: { status: 'COMPLETED' },
  })

  const plan = await db.treatmentPlan.findFirst({
    where: { id: item.treatmentPlanId },
    select: { id: true, status: true, completedDate: true, items: { select: { status: true } } },
  })
  if (plan && plan.status === 'IN_PROGRESS' && planIsFinished(plan.items ?? [])) {
    await db.treatmentPlan.update({
      where: { id: plan.id },
      data: { status: 'COMPLETED', completedDate: plan.completedDate ?? completedAt },
    })
  }
}

/**
 * The treatment carrying out a plan item was cancelled or deleted: the step
 * was not done, so it goes back to pending and loses the link, ready to be
 * started again.
 */
export async function releasePlanItemFor(db: Db, treatmentId: string): Promise<void> {
  const item = await db.treatmentPlanItem.findFirst({
    where: { treatmentId },
    select: { id: true },
  })
  if (!item) return

  await db.treatmentPlanItem.update({
    where: { id: item.id },
    data: { treatmentId: null, status: 'PENDING' },
  })
}
