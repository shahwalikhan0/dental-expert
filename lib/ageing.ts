/**
 * How old a debt is, and what that means.
 *
 * Split out of `lib/ledger.ts` for one reason: the ledger opens a Prisma client
 * at module scope, and the screens that draw an ageing bar are client
 * components. Importing a bucket label from a module that instantiates the
 * database driver drags the driver into the browser bundle, where it throws.
 *
 * So the arithmetic and the labels live here, where nothing is imported but
 * dates and numbers, and the ledger builds on top.
 */

/**
 * Money owed, by how long it has been owed.
 *
 * The four buckets every practice management system uses, because they are the
 * ones a collections conversation is held in: this month, last month, the
 * month before, and the one that needs a telephone call.
 */
export interface Ageing {
  current: number
  days30: number
  days60: number
  days90: number
  total: number
}

export const EMPTY_AGEING: Ageing = {
  current: 0,
  days30: 0,
  days60: 0,
  days90: 0,
  total: 0,
}

/** Rounded the way money is, at every boundary rather than at the end. */
export function money(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100
}

/**
 * Whole days from `from` to `to`, by calendar day.
 *
 * An invoice raised at 23:50 yesterday is one day old this morning, not
 * fourteen hours old, because that is what somebody reading the list means.
 */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86400000)
}

/**
 * The date an invoice starts ageing from.
 *
 * Its due date when it has one — that is the promise that was made — and
 * otherwise the day it was raised. Falling back to `createdAt` matters: most
 * invoices in this application have no due date, and an ageing report that
 * silently drops them is worse than none.
 */
export function agesFrom(invoice: { dueDate: Date | null; createdAt: Date }): Date {
  return invoice.dueDate ?? invoice.createdAt
}

export interface AgeableInvoice {
  dueDate: Date | null
  createdAt: Date
  balanceAmount: unknown
}

/** Put each invoice's outstanding balance in its bucket. */
export function ageInvoices(invoices: AgeableInvoice[], today: Date = new Date()): Ageing {
  const buckets = { ...EMPTY_AGEING }

  for (const invoice of invoices) {
    const balance = money(invoice.balanceAmount)
    if (balance <= 0) continue

    const age = daysBetween(agesFrom(invoice), today)
    if (age <= 30) buckets.current += balance
    else if (age <= 60) buckets.days30 += balance
    else if (age <= 90) buckets.days60 += balance
    else buckets.days90 += balance

    buckets.total += balance
  }

  return {
    current: money(buckets.current),
    days30: money(buckets.days30),
    days60: money(buckets.days60),
    days90: money(buckets.days90),
    total: money(buckets.total),
  }
}

export const AGEING_BUCKETS = [
  { key: 'current', label: 'Current', hint: 'Up to 30 days' },
  { key: 'days30', label: '31–60 days', hint: 'One month late' },
  { key: 'days60', label: '61–90 days', hint: 'Two months late' },
  { key: 'days90', label: '90+ days', hint: 'Needs a telephone call' },
] as const
