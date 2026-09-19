import { prisma } from '@/lib/prisma'
import { PAYMENT_METHODS, SETTLED_PAYMENT_STATUSES } from '@/lib/cashier'
import type { PaymentMethod } from '@prisma/client'

/**
 * What the clinic actually took, over a window.
 *
 * Two mistakes were built into every financial report before this existed, and
 * they pulled in opposite directions:
 *
 *  1. Payments were filtered on `status: 'COMPLETED'` alone. Refunding part of
 *     a payment moves it to PARTIALLY_REFUNDED, so a bill that was paid in full
 *     and then partly refunded did not reduce the day's takings — it removed
 *     them. Five thousand received and two thousand handed back reported as
 *     zero collected, in the summary, the payments report, the daily collection
 *     report and on the dashboard.
 *
 *  2. Refunds were never subtracted at all, so on the reading where (1) was
 *     fixed by widening the status filter, the same day would have reported the
 *     full five thousand with the refund invisible.
 *
 * `lib/cashier.ts` already got this right for till reconciliation — it counts
 * the settled statuses and takes refunds off by the method the money left by.
 * A clinic reconciling the till against the management report was comparing a
 * correct number with a wrong one. This is that same calculation, in the one
 * place both can use.
 *
 * Gross and refunded are reported alongside the net so the figure can be
 * explained to whoever asks, rather than being a smaller number with no story.
 */

export interface MethodCollection {
  method: PaymentMethod
  received: number
  refunded: number
  net: number
  count: number
}

export interface Collection {
  received: number
  refunded: number
  /** received − refunded: what the clinic is actually holding for the window. */
  net: number
  paymentCount: number
  refundCount: number
  byMethod: MethodCollection[]
}

export interface Window {
  gte: Date
  lte: Date
}

/**
 * Refunds are dated by `refundedAt`, not by the date of the payment they
 * reverse. A refund given in October against September's payment belongs in
 * October's takings: that is the day the money left the drawer, and the day the
 * till will be short if it is not counted.
 */
export async function collectionTotals(hospitalId: string, window: Window): Promise<Collection> {
  const [payments, refunds] = await Promise.all([
    prisma.payment.groupBy({
      by: ['paymentMethod'],
      where: {
        hospitalId,
        paymentDate: window,
        status: { in: [...SETTLED_PAYMENT_STATUSES] as never },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.refund.groupBy({
      by: ['refundMethod'],
      where: { hospitalId, refundedAt: window },
      _sum: { amount: true },
      _count: true,
    }),
  ])

  const receivedBy = new Map<string, { sum: number; count: number }>()
  for (const row of payments) {
    receivedBy.set(row.paymentMethod, { sum: Number(row._sum.amount ?? 0), count: row._count })
  }
  const refundedBy = new Map<string, { sum: number; count: number }>()
  for (const row of refunds) {
    refundedBy.set(row.refundMethod, { sum: Number(row._sum.amount ?? 0), count: row._count })
  }

  // Built from the rows that came back, not by walking a fixed list of methods.
  // Iterating PAYMENT_METHODS would silently drop takings recorded under any
  // value that list had not been updated for — money disappearing from a
  // report because a constant went stale is the very fault this file exists to
  // undo. PAYMENT_METHODS only decides the display order.
  const order = new Map<string, number>(PAYMENT_METHODS.map((method, i) => [method, i]))
  const methods = [...new Set([...receivedBy.keys(), ...refundedBy.keys()])].sort(
    (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER)
  )

  const byMethod = methods.map((method) => {
    const received = receivedBy.get(method)?.sum ?? 0
    const refunded = refundedBy.get(method)?.sum ?? 0
    return {
      method: method as PaymentMethod,
      received,
      refunded,
      net: received - refunded,
      count: receivedBy.get(method)?.count ?? 0,
    }
  })

  return {
    received: byMethod.reduce((sum, row) => sum + row.received, 0),
    refunded: byMethod.reduce((sum, row) => sum + row.refunded, 0),
    net: byMethod.reduce((sum, row) => sum + row.net, 0),
    paymentCount: payments.reduce((sum, row) => sum + row._count, 0),
    refundCount: refunds.reduce((sum, row) => sum + row._count, 0),
    byMethod,
  }
}

/** The day a payment or refund falls on, for grouping a report by date. */
export function dayKeyOf(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}
