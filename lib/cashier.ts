import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { expectedTotals, type MethodTotal } from '@/lib/till'
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Daily closing (FR-015) and the discount/refund controls (FR-013, FR-014).
 *
 * All three are the same idea: money leaving or not arriving needs a named
 * person behind it and a reason on the record. Before this module the
 * capabilities (`billing:closing`, `billing:discount`, `billing:refund`) were
 * enforced, but nothing was written down — a discount had no reason, a refund
 * had no authoriser, and a till could not be reconciled at all.
 */

// The pure arithmetic lives in lib/till.ts so the Till screen can use it too;
// re-exported here so the routes keep one import for the cashier.
export {
  PAYMENT_METHODS,
  round2,
  reconcile,
  totalVariance,
  type MethodTotal,
  type CountedLine,
  type ReconciledLine,
} from '@/lib/till'

/**
 * Payment statuses that represent money actually received. A failed or pending
 * payment must not appear in what the till is expected to hold.
 */
export const SETTLED_PAYMENT_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const

// ────────────────────────────────────────────────────────────────────────────
// FR-013 — discount approval
// ────────────────────────────────────────────────────────────────────────────

/**
 * Discounts strictly greater than this (in PKR) need a reason and an approver.
 *
 * Stored in `Setting`, so changing it is a settings edit rather than a
 * migration.
 *
 * The default is a starting value, not a considered clinic policy — the number
 * to set is a question for whoever runs the practice. It is deliberately not
 * zero: a threshold of zero sends every goodwill rounding-down of a bill to a
 * manager, and the predictable result is that staff stop using the discount
 * field and adjust the price instead, which records less than before. FR-013
 * asks for a threshold precisely so routine discretion stays routine.
 */
export const DISCOUNT_THRESHOLD_KEY = 'billing.discountApprovalThreshold'
export const DEFAULT_DISCOUNT_THRESHOLD = 1000

export async function getDiscountApprovalThreshold(hospitalId: string): Promise<number> {
  const setting = await prisma.setting.findUnique({
    where: { hospitalId_key: { hospitalId, key: DISCOUNT_THRESHOLD_KEY } },
    select: { value: true },
  })
  const parsed = Number(setting?.value)
  // A missing, blank or malformed setting falls back to the default rather
  // than to "no threshold", which would disable the control silently.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DISCOUNT_THRESHOLD
}

export function discountNeedsApproval(discountAmount: number, threshold: number): boolean {
  return discountAmount > threshold
}

// ────────────────────────────────────────────────────────────────────────────
// FR-015 — cashier sessions
// ────────────────────────────────────────────────────────────────────────────

/**
 * The clinic's open till, if there is one.
 *
 * One open session per clinic: this is a single-site practice with one front
 * desk, and "daily closing" means one reconciliation at the end of the day.
 * Payments attach to whichever session is open when they are taken.
 *
 * With `userId`, a till that person opened is preferred: a payment belongs in
 * the drawer of the person who took it (finding 38). Opening is serialised per
 * clinic now, but tills opened before that may still be open side by side.
 * `db` lets a caller read it inside the transaction that records the payment.
 */
export async function getOpenSession(
  hospitalId: string,
  options: { db?: Db; userId?: string | null } = {}
) {
  const db = options.db ?? prisma
  if (options.userId) {
    const own = await db.cashierSession.findFirst({
      where: { hospitalId, status: 'OPEN', openedById: options.userId },
      orderBy: { openedAt: 'desc' },
    })
    if (own) return own
  }
  return db.cashierSession.findFirst({
    where: { hospitalId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  })
}

/**
 * The open till a payment or refund is about to be written into, held for the
 * rest of the transaction.
 *
 * Money is now refused with no till open (finding 38), and a till can be
 * closed from the Till screen while somebody else is mid-payment. Without a
 * lock a payment could read the session as open, the closing could count the
 * drawer and mark it closed, and the payment would then commit into a session
 * whose figures were already stamped — the same orphaned money by a narrower
 * door. `FOR SHARE` lets payments run side by side but makes the closing's
 * `FOR UPDATE` (see `lockSessionForClose`) wait for them; a payment that
 * arrives while a closing holds the row waits, re-reads it as closed, and is
 * refused.
 *
 * Must be called inside a transaction.
 */
export async function lockOpenSession(
  db: Prisma.TransactionClient,
  hospitalId: string,
  userId?: string | null
) {
  await db.$queryRaw`
    SELECT "id" FROM "CashierSession"
    WHERE "hospitalId" = ${hospitalId} AND "status" = 'OPEN'
    FOR SHARE
  `
  return getOpenSession(hospitalId, { db, userId })
}

/**
 * Hold a session against new payments while it is counted down and closed.
 * Waits for any payment already writing into it to commit first.
 */
export async function lockSessionForClose(
  db: Prisma.TransactionClient,
  sessionId: string,
  hospitalId: string
): Promise<void> {
  await db.$queryRaw`
    SELECT "id" FROM "CashierSession"
    WHERE "id" = ${sessionId} AND "hospitalId" = ${hospitalId}
    FOR UPDATE
  `
}

/** `CS-YYYYMM-0001`, matching the invoice and payment numbering. */
export async function generateSessionNo(hospitalId: string, db: Db = prisma): Promise<string> {
  const now = new Date()
  const prefix = `CS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`

  return nextInSeries(db, {
    hospitalId,
    prefix,
    width: 4,
    currentMax: async () => {
      const last = await db.cashierSession.findFirst({
        where: { hospitalId, sessionNo: { startsWith: prefix } },
        orderBy: { sessionNo: 'desc' },
        select: { sessionNo: true },
      })
      return trailingNumber(last?.sessionNo, 4)
    },
  })
}

/**
 * `REF-YYYYMM-0001`.
 *
 * Pass the transaction the refund is written in: the counter row is then
 * rolled back with it, and a refused refund does not leave a gap.
 */
export async function generateRefundNo(hospitalId: string, db: Db = prisma): Promise<string> {
  const now = new Date()
  const prefix = `REF-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`

  return nextInSeries(db, {
    hospitalId,
    prefix,
    width: 4,
    currentMax: async () => {
      const last = await db.refund.findFirst({
        where: { hospitalId, refundNo: { startsWith: prefix } },
        orderBy: { refundNo: 'desc' },
        select: { refundNo: true },
      })
      return trailingNumber(last?.refundNo, 4)
    },
  })
}

/**
 * What each payment method should hold for a session — see `expectedTotals`
 * for the rules.
 *
 * Pass the transaction when the figures are about to be stamped on a closing,
 * so they are read behind the same lock that keeps a payment from landing in
 * the session halfway through (finding 38).
 */
export async function computeExpectedTotals(
  session: {
    id: string
    openingFloat: Prisma.Decimal | number
  },
  db: Db = prisma
): Promise<MethodTotal[]> {
  const [payments, refunds] = await Promise.all([
    db.payment.groupBy({
      by: ['paymentMethod'],
      where: {
        cashierSessionId: session.id,
        status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
      },
      _sum: { amount: true },
    }),
    db.refund.groupBy({
      by: ['refundMethod'],
      where: { cashierSessionId: session.id },
      _sum: { amount: true },
    }),
  ])

  return expectedTotals(
    payments.map((row) => ({ method: row.paymentMethod, amount: Number(row._sum.amount ?? 0) })),
    refunds.map((row) => ({ method: row.refundMethod, amount: Number(row._sum.amount ?? 0) })),
    Number(session.openingFloat ?? 0)
  )
}
