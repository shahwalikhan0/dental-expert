import { prisma } from '@/lib/prisma'
import type { PaymentMethod, Prisma } from '@prisma/client'

/**
 * Daily closing (FR-015) and the discount/refund controls (FR-013, FR-014).
 *
 * All three are the same idea: money leaving or not arriving needs a named
 * person behind it and a reason on the record. Before this module the
 * capabilities (`billing:closing`, `billing:discount`, `billing:refund`) were
 * enforced, but nothing was written down — a discount had no reason, a refund
 * had no authoriser, and a till could not be reconciled at all.
 */

/** Every method a till can take money by, so a closing counts them all. */
export const PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'CHEQUE',
  'INSURANCE',
  'WALLET',
  'ONLINE',
] as const satisfies readonly PaymentMethod[]

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
 */
export async function getOpenSession(hospitalId: string) {
  return prisma.cashierSession.findFirst({
    where: { hospitalId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  })
}

/** `CS-YYYYMM-0001`, matching the invoice and payment numbering. */
export async function generateSessionNo(hospitalId: string): Promise<string> {
  const now = new Date()
  const datePrefix = `CS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`

  const last = await prisma.cashierSession.findFirst({
    where: { hospitalId, sessionNo: { startsWith: datePrefix } },
    orderBy: { sessionNo: 'desc' },
    select: { sessionNo: true },
  })

  const next = last ? parseInt(last.sessionNo.slice(-4), 10) + 1 : 1
  return `${datePrefix}${String(next).padStart(4, '0')}`
}

/** `REF-YYYYMM-0001`. */
export async function generateRefundNo(hospitalId: string): Promise<string> {
  const now = new Date()
  const datePrefix = `REF-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`

  const last = await prisma.refund.findFirst({
    where: { hospitalId, refundNo: { startsWith: datePrefix } },
    orderBy: { refundNo: 'desc' },
    select: { refundNo: true },
  })

  const next = last ? parseInt(last.refundNo.slice(-4), 10) + 1 : 1
  return `${datePrefix}${String(next).padStart(4, '0')}`
}

export interface MethodTotal {
  paymentMethod: PaymentMethod
  received: number
  refunded: number
  /** received − refunded, plus the opening float for CASH. */
  expected: number
}

/**
 * What each payment method should hold for a session.
 *
 * Refunds are subtracted from the method they were *paid out by*, not the one
 * the original payment came in by — refunding a card payment in cash takes
 * cash out of the drawer, and a reconciliation that ignored that would report
 * a shortfall every time.
 *
 * The opening float lands on CASH alone; there is no float on a card terminal.
 */
export async function computeExpectedTotals(session: {
  id: string
  openingFloat: Prisma.Decimal | number
}): Promise<MethodTotal[]> {
  const [payments, refunds] = await Promise.all([
    prisma.payment.groupBy({
      by: ['paymentMethod'],
      where: {
        cashierSessionId: session.id,
        status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
      },
      _sum: { amount: true },
    }),
    prisma.refund.groupBy({
      by: ['refundMethod'],
      where: { cashierSessionId: session.id },
      _sum: { amount: true },
    }),
  ])

  const receivedBy = new Map<string, number>()
  for (const row of payments) {
    receivedBy.set(row.paymentMethod, Number(row._sum.amount ?? 0))
  }
  const refundedBy = new Map<string, number>()
  for (const row of refunds) {
    refundedBy.set(row.refundMethod, Number(row._sum.amount ?? 0))
  }

  const float = Number(session.openingFloat ?? 0)

  return PAYMENT_METHODS.map((method) => {
    const received = receivedBy.get(method) ?? 0
    const refunded = refundedBy.get(method) ?? 0
    return {
      paymentMethod: method,
      received,
      refunded,
      expected: round2(received - refunded + (method === 'CASH' ? float : 0)),
    }
  })
}

/** Money is compared to the paisa; floating-point drift is not a variance. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export interface CountedLine {
  paymentMethod: PaymentMethod
  countedAmount: number
  notes?: string | null
}

export interface ReconciledLine extends MethodTotal {
  countedAmount: number
  varianceAmount: number
  notes: string | null
}

/**
 * Line up the physical count against what the session should hold.
 *
 * A method nobody counted is treated as zero counted rather than skipped: an
 * uncounted drawer with money expected in it is precisely the variance a
 * closing exists to surface.
 */
export function reconcile(expected: MethodTotal[], counted: CountedLine[]): ReconciledLine[] {
  const countedBy = new Map(counted.map((c) => [c.paymentMethod, c]))

  return expected.map((line) => {
    const entry = countedBy.get(line.paymentMethod)
    const countedAmount = round2(Number(entry?.countedAmount ?? 0))
    return {
      ...line,
      countedAmount,
      varianceAmount: round2(countedAmount - line.expected),
      notes: entry?.notes ?? null,
    }
  })
}

export function totalVariance(lines: ReconciledLine[]): number {
  return round2(lines.reduce((sum, l) => sum + l.varianceAmount, 0))
}
