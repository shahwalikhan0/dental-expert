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
import {
  daysPastDue,
  dueAnchor,
  isInvoiceOwed,
  money,
  type DatedInvoice,
  type OwableInvoice,
} from '@/lib/invoice-figures'

export { money }

/**
 * Money owed, by how far past its due date it is.
 *
 * One bucketing for every screen that ages a debt — receivables, the patient
 * ledger and statement, Claims Aging on the billing overview and Reports →
 * Outstanding. They used to be three: receivables aged from the invoice date
 * and called 0–30 days "Current", the reports aged from the due date and
 * called the same bill "1–30 days overdue", and the ledger called anything
 * older than today overdue (bug report item 5). An invoice raised yesterday
 * with no due date was current, overdue and overdue, depending on the screen.
 *
 * Days are counted from the due date, on the clinic's calendar. "Not yet due"
 * includes the due day itself.
 */
export type AgeingBucketKey = 'notDue' | 'days1_30' | 'days31_60' | 'days61_90' | 'over90'

export interface Ageing {
  notDue: number
  days1_30: number
  days31_60: number
  days61_90: number
  over90: number
  total: number
}

export const EMPTY_AGEING: Ageing = {
  notDue: 0,
  days1_30: 0,
  days31_60: 0,
  days61_90: 0,
  over90: 0,
  total: 0,
}

export const AGEING_BUCKETS: ReadonlyArray<{
  key: AgeingBucketKey
  label: string
  hint: string
}> = [
  { key: 'notDue', label: 'Not yet due', hint: 'Within its terms' },
  { key: 'days1_30', label: '1–30', hint: '1–30 days overdue' },
  { key: 'days31_60', label: '31–60', hint: '31–60 days overdue' },
  { key: 'days61_90', label: '61–90', hint: '61–90 days overdue' },
  { key: 'over90', label: '90+', hint: 'Over 90 days overdue — needs a telephone call' },
]

/** Which bucket a debt this many days past due belongs in. */
export function ageingBucket(daysLate: number): AgeingBucketKey {
  if (daysLate <= 0) return 'notDue'
  if (daysLate <= 30) return 'days1_30'
  if (daysLate <= 60) return 'days31_60'
  if (daysLate <= 90) return 'days61_90'
  return 'over90'
}

/**
 * The date an invoice ages from: its due date, or failing that when it was
 * issued, or raised. See `dueAnchor` in lib/invoice-figures.ts.
 */
export function agesFrom(invoice: DatedInvoice): Date {
  return dueAnchor(invoice) ?? new Date(0)
}

export type AgeableInvoice = OwableInvoice & DatedInvoice

/**
 * Put each owed invoice's balance in its bucket.
 *
 * Invoices that are not owed — drafts, cancelled, refunded, settled — are
 * skipped here rather than trusted to have been filtered out by the caller,
 * so no screen can age a debt the others do not count.
 */
export function ageInvoices(
  invoices: AgeableInvoice[],
  todayYmd: string,
  timezone: string
): Ageing {
  return ageInvoicesWithCounts(invoices, todayYmd, timezone).ageing
}

/** The same, with how many invoices are in each bucket. */
export function ageInvoicesWithCounts(
  invoices: AgeableInvoice[],
  todayYmd: string,
  timezone: string
): { ageing: Ageing; counts: Record<AgeingBucketKey, number> } {
  const buckets = { ...EMPTY_AGEING }
  const counts: Record<AgeingBucketKey, number> = {
    notDue: 0,
    days1_30: 0,
    days31_60: 0,
    days61_90: 0,
    over90: 0,
  }

  for (const invoice of invoices) {
    if (!isInvoiceOwed(invoice)) continue
    const balance = money(invoice.balanceAmount)
    const key = ageingBucket(daysPastDue(invoice, todayYmd, timezone))
    buckets[key] += balance
    counts[key] += 1
    buckets.total += balance
  }

  return {
    ageing: {
      notDue: money(buckets.notDue),
      days1_30: money(buckets.days1_30),
      days31_60: money(buckets.days31_60),
      days61_90: money(buckets.days61_90),
      over90: money(buckets.over90),
      total: money(buckets.total),
    },
    counts,
  }
}

/** Of an ageing, how much is past its due date. */
export function overdueOf(ageing: Ageing): number {
  return money(ageing.total - ageing.notDue)
}

/** Add one ageing into another, for totals across rows. */
export function addAgeing(into: Ageing, more: Ageing): Ageing {
  return {
    notDue: money(into.notDue + more.notDue),
    days1_30: money(into.days1_30 + more.days1_30),
    days31_60: money(into.days31_60 + more.days31_60),
    days61_90: money(into.days61_90 + more.days61_90),
    over90: money(into.over90 + more.over90),
    total: money(into.total + more.total),
  }
}
