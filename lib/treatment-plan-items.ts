import type { Prisma, PrismaClient, TreatmentPlanItemStatus } from '@prisma/client'
import { readTeeth } from '@/lib/teeth'
import { phaseOf } from '@/lib/treatment-phases'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * The lines of a treatment plan as a form sends them, checked once for both
 * the create and the edit route.
 *
 * What each used to get wrong (bug report 12 Oct):
 *
 *  - **The same procedure twice was refused** (finding 10). Two fillings, on
 *    16 and 26, is the ordinary case; the route counted the distinct
 *    procedures it found against the number of lines and called the
 *    difference "not found".
 *  - **A deactivated procedure was accepted** (finding 48).
 *  - **Teeth were free text** (finding 54).
 *  - **A line at Rs 0 was quoted at list price**, and a negative one accepted —
 *    the plan's version of finding 33.
 */

export interface PlanItemInput {
  /** The stored item this line is, on an edit. Absent for a new line. */
  id?: string
  procedureId: string
  toothNumbers: string | null
  phase: number
  priority: number
  estimatedCost: number
  notes: string | null
  status: TreatmentPlanItemStatus
}

export type PlanItemsResult =
  | { ok: true; items: PlanItemInput[]; estimatedCost: number; estimatedDuration: number }
  | { ok: false; status: number; error: string }

/** What a form may set a line to. The rest are set by the treatment carrying it out. */
const FORM_STATUSES = new Set<TreatmentPlanItemStatus>(['PENDING', 'SCHEDULED', 'CANCELLED'])

function money(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Check the lines and work out the plan's total.
 *
 * `keepProcedure` names procedure ids that may stay on the plan although they
 * have since been deactivated — the ones already on it. A line that was there
 * before the procedure left the catalogue is history; a new line is not.
 */
export async function readPlanItems(
  db: Db,
  hospitalId: string,
  raw: unknown,
  keepProcedure: Set<string> = new Set()
): Promise<PlanItemsResult> {
  if (!Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'Items must be a list of procedures' }
  }

  const ids = raw.map((item: any) => item?.procedureId)
  if (ids.some((id) => typeof id !== 'string' || !id)) {
    return { ok: false, status: 400, error: 'Every line of the plan needs a procedure' }
  }

  // Distinct ids against distinct ids: a plan may hold the same procedure on
  // as many lines as it needs.
  const wanted = [...new Set(ids as string[])]
  const procedures =
    wanted.length > 0
      ? ((await db.procedure.findMany({ where: { id: { in: wanted }, hospitalId } })) ?? [])
      : []
  if (procedures.length !== wanted.length) {
    return { ok: false, status: 404, error: 'One or more procedures not found' }
  }
  const byId = new Map(procedures.map((p) => [p.id, p]))

  const inactive = procedures.filter((p) => p.isActive === false && !keepProcedure.has(p.id))
  if (inactive.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `${inactive.map((p) => p.name).join(', ')} ${inactive.length === 1 ? 'has' : 'have'} been deactivated in the procedure catalogue and cannot be added to a plan.`,
    }
  }

  const items: PlanItemInput[] = []
  let estimatedCost = 0
  let estimatedDuration = 0

  for (const [index, item] of (raw as any[]).entries()) {
    const procedure = byId.get(item.procedureId)!

    const teeth = readTeeth(item.toothNumbers)
    if (!teeth.ok) {
      return { ok: false, status: 400, error: `${procedure.name}: ${teeth.error}` }
    }

    // The line's own price is settled here, once, and both the line and the
    // plan total are built from it — they used to be worked out separately
    // and disagreed. Nothing given is the list price; zero is zero.
    let cost: number
    if (
      item.estimatedCost === undefined ||
      item.estimatedCost === null ||
      item.estimatedCost === ''
    ) {
      cost = Number(procedure.basePrice)
    } else {
      cost = Number(item.estimatedCost)
      if (!Number.isFinite(cost) || cost < 0) {
        return {
          ok: false,
          status: 400,
          error: `${procedure.name}: the price must be a number of zero or more`,
        }
      }
    }
    cost = money(cost)

    const status: TreatmentPlanItemStatus = FORM_STATUSES.has(item.status) ? item.status : 'PENDING'

    items.push({
      id: typeof item.id === 'string' && item.id ? item.id : undefined,
      procedureId: procedure.id,
      toothNumbers: teeth.column,
      // Clamped rather than trusted: `phase` comes from a form and is what
      // the printed estimate groups on.
      phase: phaseOf(item),
      priority: Number.isInteger(item.priority) && item.priority > 0 ? item.priority : index + 1,
      estimatedCost: cost,
      notes: typeof item.notes === 'string' && item.notes.trim() ? item.notes : null,
      status,
    })

    estimatedCost += cost
    estimatedDuration += procedure.defaultDuration
  }

  return { ok: true, items, estimatedCost: money(estimatedCost), estimatedDuration }
}
