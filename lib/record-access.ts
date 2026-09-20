/**
 * Recording that somebody read a patient's record.
 *
 * Specification §10 asks for "audit history for login, patient record access
 * where supported". Logins were recorded and changes were recorded; *reading*
 * was not, and reading is the one an information commissioner asks about. The
 * question after an incident is never "who edited this record" — an edit leaves
 * its own marks — it is "who looked at it", and until now the honest answer was
 * that nobody knows.
 *
 * ## What counts as access, and what deliberately does not
 *
 * **Opening a record** is access: the patient page, the clinical chart, the
 * documents, the timeline. That is a person choosing one named individual and
 * reading their history.
 *
 * **A list is not.** The register, a day's appointments, a search for a
 * surname: these are working screens that a receptionist loads dozens of times
 * an hour, and a row for each would add tens of thousands of entries a month
 * that bury the ones that matter. §10 says "where supported", and this is the
 * line that makes the trail worth reading rather than merely large.
 *
 * ## Once per person per record per session-length window
 *
 * A patient record is a tabbed page, and a dentist moving between the chart,
 * the treatment history and the documents is one act of reading, not four. So
 * repeated access by the same person to the same record inside
 * `ACCESS_WINDOW_MINUTES` is recorded once. What survives is "Dr Malik read
 * Ayesha Khan's record at 10:42", which is the sentence the trail exists to be
 * able to produce.
 *
 * The de-duplication reads the log before writing to it. That is one indexed
 * query on a record open — not on a list, not on a save — which is a cost worth
 * paying for a log somebody can actually read.
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit'

type Db = PrismaClient | Prisma.TransactionClient

/** How long before the same person reading the same record is logged again. */
export const ACCESS_WINDOW_MINUTES = 30

export type AccessKind = 'patient' | 'clinical'

const ACTION: Record<AccessKind, string> = {
  patient: AUDIT_ACTIONS.PATIENT_RECORD_VIEWED,
  clinical: AUDIT_ACTIONS.CLINICAL_RECORD_VIEWED,
}

export interface RecordAccessEntry {
  db: Db
  hospitalId: string
  userId: string
  patientId: string
  kind: AccessKind
  /** Which screen, for the entry — "chart", "documents", "timeline". */
  via?: string
  ipAddress?: string | null
  userAgent?: string | null
  at?: Date
}

/**
 * Note that this person opened this record.
 *
 * Never throws and never blocks: like every other audit write, the thing being
 * audited has already happened, and a log failure must not turn into a patient
 * record that will not open. Callers do not await it.
 */
export async function noteRecordAccess({
  db,
  hospitalId,
  userId,
  patientId,
  kind,
  via,
  ipAddress,
  userAgent,
  at = new Date(),
}: RecordAccessEntry): Promise<void> {
  try {
    const since = new Date(at.getTime() - ACCESS_WINDOW_MINUTES * 60_000)

    const recent = await db.auditLog.findFirst({
      where: {
        hospitalId,
        userId,
        action: ACTION[kind],
        entityType: 'Patient',
        entityId: patientId,
        createdAt: { gte: since },
      },
      select: { id: true },
    })

    if (recent) return

    await recordAudit({
      hospitalId,
      userId,
      action: ACTION[kind],
      entityType: 'Patient',
      entityId: patientId,
      newValues: via ? { via } : null,
      ipAddress,
      userAgent,
    })
  } catch (err) {
    // See rule 1 in lib/audit.ts.
    console.error('Failed to note record access:', err)
  }
}
