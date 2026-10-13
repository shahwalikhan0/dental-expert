import type { InvoiceStatus, Prisma } from '@prisma/client'
import { dayRangeIn, localDay } from '@/lib/appointment-time'

/**
 * What the money words mean, once.
 *
 * "Outstanding" meant six different things on six screens (invoice review,
 * 14 Oct, §3.1): the dashboard summed invoice *totals*, receivables counted a
 * refunded invoice as a debt, the portal did not, Financial Analytics added up
 * drafts and cancelled bills. "Overdue" had five definitions (§2.4, and bug
 * report item 5), and "Revenue" was collected cash on the dashboard and billed
 * invoices in Reports under the same name (bug report item 6). Each screen was
 * right by its own rule; the clinic could not reconcile any two of them.
 *
 * So the rules live here and every screen asks this file:
 *
 *  - **Owed**: an invoice the clinic has issued and not been paid for —
 *    PENDING, PARTIALLY_PAID or OVERDUE (or PAID, which should never carry a
 *    balance but is counted if it somehow does) with a balance above zero.
 *    DRAFT is not a bill yet, CANCELLED is a write-off, and REFUNDED means the
 *    charge was reversed: the money went back because the work was not done,
 *    and chasing the patient for it again is the one thing nobody wants.
 *  - **Outstanding**: Σ balanceAmount of owed invoices.
 *  - **Overdue**: owed, and due before today on the clinic's calendar.
 *  - **Billed**: Σ totalAmount of invoices that are neither DRAFT nor
 *    CANCELLED, dated by when they were issued.
 *  - **Collected**: `collectionTotals` in lib/collections.ts — cash, not bills.
 *
 * Nothing here touches the database, so client components (the invoice list's
 * overdue label) can use the same predicate as the server that filtered the
 * list. The Prisma pieces are plain `where` objects.
 */

// ────────────────────────────────────────────────────────────────────────────
// Money
// ────────────────────────────────────────────────────────────────────────────

/** Rounded the way money is, at every boundary rather than at the end. */
export function money(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100
}

// ────────────────────────────────────────────────────────────────────────────
// Owed and outstanding
// ────────────────────────────────────────────────────────────────────────────

/**
 * Statuses an invoice can be owed in. PAID is here only so that a PAID invoice
 * that somehow still carries a balance is not silently dropped; the balance
 * test is what decides.
 */
export const OWED_INVOICE_STATUSES: InvoiceStatus[] = [
  'PENDING',
  'PARTIALLY_PAID',
  'OVERDUE',
  'PAID',
]

/** Never money the patient owes, whatever the balance column says. */
export const NEVER_OWED_INVOICE_STATUSES: InvoiceStatus[] = ['DRAFT', 'CANCELLED', 'REFUNDED']

export interface OwableInvoice {
  status: InvoiceStatus | string
  balanceAmount: unknown
}

/** Does the patient owe the clinic money on this invoice? */
export function isInvoiceOwed(invoice: OwableInvoice): boolean {
  return (
    (OWED_INVOICE_STATUSES as string[]).includes(invoice.status) && money(invoice.balanceAmount) > 0
  )
}

/**
 * The same rule as a Prisma filter.
 *
 * `minBalance` is for the receivables list, which leaves off balances of a
 * few paise — rounding, not debt.
 */
export function owedInvoiceWhere(minBalance = 0): Prisma.InvoiceWhereInput {
  return {
    status: { in: OWED_INVOICE_STATUSES },
    balanceAmount: { gt: minBalance },
  }
}

/** Σ balance of the owed invoices in a list. */
export function outstandingOf(invoices: OwableInvoice[]): number {
  return money(
    invoices.filter(isInvoiceOwed).reduce((sum, invoice) => sum + money(invoice.balanceAmount), 0)
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Due dates and overdue
// ────────────────────────────────────────────────────────────────────────────

type DateLike = Date | string | null | undefined

export interface DatedInvoice {
  dueDate: DateLike
  issuedAt?: DateLike
  createdAt: DateLike
}

/**
 * The moment an invoice falls due.
 *
 * Its due date — which since 14 Oct every issued invoice has, "due on receipt"
 * being the day it was issued. The fallbacks are for a draft (no due date
 * yet) and for anything written before the backfill: when it was issued, and
 * failing that when it was raised.
 */
export function dueAnchor(invoice: DatedInvoice): Date | null {
  const at = invoice.dueDate ?? invoice.issuedAt ?? invoice.createdAt
  if (!at) return null
  const date = at instanceof Date ? at : new Date(at)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The calendar day a stored date stands for, on the clinic's calendar.
 *
 * Due dates have reached this table three ways. The create and edit routes
 * now store a calendar day as midday UTC (`dueDateOn` in lib/invoice-dates.ts),
 * which is that day in any zone within twelve hours of UTC, so reading it in
 * the clinic's zone gives the day back. Older rows typed into a date picker
 * hold UTC midnight, which means *that day* wherever the clinic is but is the
 * previous evening west of Greenwich. Rows computed from payment terms or
 * backfilled from the issue time are instants, whose day is the clinic's day
 * when they happened. So: a value at exactly UTC midnight is read as the
 * calendar day it names, anything else in the clinic's zone. The chance of an
 * instant landing on UTC midnight to the millisecond is nil, and east of
 * Greenwich — Pakistan — the two readings agree anyway.
 */
export function calendarDayOf(at: Date | string, timezone: string): string {
  const date = at instanceof Date ? at : new Date(at)
  const midnightUtc =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  return midnightUtc ? date.toISOString().slice(0, 10) : localDay(date, timezone)
}

/** Whole calendar days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetweenDays(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10))
  )
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  return Math.round((b - a) / 86400000)
}

/**
 * How many days past its due day an invoice is: positive once it is late, 0 on
 * the day it falls due, negative before. Whether anything is *owed* is a
 * separate question — see `isInvoiceOverdue`.
 */
export function daysPastDue(invoice: DatedInvoice, todayYmd: string, timezone: string): number {
  const anchor = dueAnchor(invoice)
  if (!anchor) return 0
  return daysBetweenDays(calendarDayOf(anchor, timezone), todayYmd)
}

/**
 * Overdue: still owed, and due before today on the clinic's calendar.
 *
 * The status OVERDUE that staff can set by hand counts as owed like any other;
 * it does not make an invoice overdue on its own, and its absence does not
 * stop one being overdue. A due date in the future is not overdue because
 * somebody clicked a button; a bill a month late is overdue whether or not
 * anybody did.
 */
export function isInvoiceOverdue(
  invoice: OwableInvoice & DatedInvoice,
  todayYmd: string,
  timezone: string
): boolean {
  return isInvoiceOwed(invoice) && daysPastDue(invoice, todayYmd, timezone) > 0
}

type InvoiceDateField = 'dueDate' | 'issuedAt' | 'createdAt'

/**
 * `field` falls on a day before `todayYmd`, as a Prisma filter that agrees
 * with `calendarDayOf` to the millisecond.
 *
 * Two cut-offs: the clinic's midnight for instants, UTC midnight for
 * date-picker values. East of Greenwich the clinic's midnight comes first and
 * catches both. West of it, a date-picker value for *today* sits at UTC
 * midnight before the clinic's midnight, and is the one value in that window
 * that is not overdue.
 */
function beforeDay(
  field: InvoiceDateField,
  todayYmd: string,
  timezone: string
): Prisma.InvoiceWhereInput {
  const clinicMidnight = dayRangeIn(todayYmd, timezone).gte
  const utcMidnight = new Date(`${todayYmd}T00:00:00.000Z`)

  if (clinicMidnight.getTime() <= utcMidnight.getTime()) {
    return { [field]: { lt: clinicMidnight } }
  }
  return {
    OR: [{ [field]: { lt: utcMidnight } }, { [field]: { gt: utcMidnight, lt: clinicMidnight } }],
  }
}

/** `isInvoiceOverdue` as a Prisma filter, for lists and reminders. */
export function overdueInvoiceWhere(todayYmd: string, timezone: string): Prisma.InvoiceWhereInput {
  return {
    AND: [
      owedInvoiceWhere(),
      {
        OR: [
          beforeDay('dueDate', todayYmd, timezone),
          { AND: [{ dueDate: null }, beforeDay('issuedAt', todayYmd, timezone)] },
          {
            AND: [
              { dueDate: null },
              { issuedAt: null },
              beforeDay('createdAt', todayYmd, timezone),
            ],
          },
        ],
      },
    ],
  }
}

export interface DueState {
  overdue: boolean
  /** Days late when overdue, days to go otherwise. */
  days: number
  label: string
}

/**
 * The line under an invoice's due date: "3 days overdue", "Due today".
 *
 * Null for anything not owed. A paid, cancelled, refunded or draft invoice is
 * not late, however long ago its due date was, and the list used to say
 * "40 days overdue" in red on all of them.
 */
export function invoiceDueState(
  invoice: OwableInvoice & DatedInvoice,
  todayYmd: string,
  timezone: string
): DueState | null {
  if (!isInvoiceOwed(invoice) || !dueAnchor(invoice)) return null
  const late = daysPastDue(invoice, todayYmd, timezone)
  const plural = (n: number) => (n === 1 ? 'day' : 'days')
  if (late > 0) return { overdue: true, days: late, label: `${late} ${plural(late)} overdue` }
  if (late === 0) return { overdue: false, days: 0, label: 'Due today' }
  return { overdue: false, days: -late, label: `Due in ${-late} ${plural(-late)}` }
}

// ────────────────────────────────────────────────────────────────────────────
// Billed
// ────────────────────────────────────────────────────────────────────────────

/** A draft is not a bill yet, and a cancelled one is no longer a bill. */
export const NOT_BILLED_INVOICE_STATUSES: InvoiceStatus[] = ['DRAFT', 'CANCELLED']

export interface Window {
  gte?: Date
  lt?: Date
  lte?: Date
}

/**
 * Invoices billed within a window, by when they were issued.
 *
 * `createdAt` is when the draft was started — a draft from last month issued
 * today is today's billing. It is the fallback only for an issued invoice that
 * somehow has no `issuedAt`, so that nothing billed drops out of the figure.
 * REFUNDED stays in: it was billed, and the refund is a collections event
 * that `collectionTotals` takes off on the day the money went back.
 */
export function billedInvoiceWhere(window: Window): Prisma.InvoiceWhereInput {
  return {
    status: { notIn: NOT_BILLED_INVOICE_STATUSES },
    OR: [{ issuedAt: window }, { issuedAt: null, createdAt: window }],
  }
}

/** The instant an invoice counts as billed. */
export function billedAt(invoice: { issuedAt?: Date | null; createdAt: Date }): Date {
  return invoice.issuedAt ?? invoice.createdAt
}

/**
 * Each line's share of what was actually invoiced: its amount less a pro-rata
 * share of the invoice discount, the same proportion `calculateInvoiceTotals`
 * applies. Before tax, which is the government's and not anybody's revenue.
 *
 * The rounding remainder goes to the largest line, so the lines add up to
 * subtotal − discount exactly and a procedure report reconciles to the bills.
 */
export function netLineAmounts(amounts: unknown[], discount: unknown): number[] {
  const lines = amounts.map(money)
  const subtotal = lines.reduce((sum, amount) => sum + amount, 0)
  const off = Math.min(Math.max(money(discount), 0), subtotal)
  if (subtotal <= 0 || off === 0) return lines

  const net = lines.map((amount) => money(amount - (off * amount) / subtotal))
  const remainder = money(subtotal - off - net.reduce((sum, amount) => sum + amount, 0))
  if (remainder !== 0) {
    const largest = lines.indexOf(Math.max(...lines))
    net[largest] = money(net[largest] + remainder)
  }
  return net
}
