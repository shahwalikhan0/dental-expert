import type { Prisma, PrismaClient } from '@prisma/client'
import { completeRecaresForProcedure, type RecallMoved } from '@/lib/recare'
import { completePlanItemFor } from '@/lib/treatment-plan-status'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * What else a treatment finishing changes.
 *
 * Two routes complete a treatment — the Complete button's own route, and an
 * edit that sets the status — and both have to leave the rest of the record
 * agreeing with it:
 *
 *  - the plan step it carries out is completed, and the plan with it once
 *    nothing is left (bug report 12 Oct, finding 11);
 *  - the patient's recalls that this procedure is the visit for are moved on,
 *    exactly as Mark as done would (finding 46). See
 *    `recareTypeMatchesProcedure` for what counts.
 *
 * Returns the recalls that moved, so the screen can say where to.
 */
export async function afterTreatmentCompleted(
  db: Db,
  treatment: {
    id: string
    hospitalId: string
    patientId: string
    procedure: { name: string; category: string }
  },
  completedAt: Date,
  /** Recalls the caller has already moved by id, so they are not moved twice. */
  alreadyMoved: string[] = []
): Promise<RecallMoved[]> {
  await completePlanItemFor(db, treatment.id, completedAt)

  return completeRecaresForProcedure(db, {
    hospitalId: treatment.hospitalId,
    patientId: treatment.patientId,
    procedure: treatment.procedure,
    completedAt,
    except: alreadyMoved,
  })
}
