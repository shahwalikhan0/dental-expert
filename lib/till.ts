import type { PaymentMethod } from '@prisma/client'

/**
 * The till's arithmetic, with nothing that touches the database.
 *
 * Kept apart from lib/cashier.ts so the Till screen can show the same expected
 * figures and the same variance the server will stamp at closing, while the
 * person is still counting — a preview worked out by different code is a
 * preview that can disagree with the record (bug report 12 Oct, finding 38).
 */

/** Every method a till can take money by, so a closing counts them all. */
export const PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'CHEQUE',
  'WALLET',
  'ONLINE',
] as const satisfies readonly PaymentMethod[]

/**
 * What a route answers, in `code`, when money is taken with no till open.
 * The screens look for it to point the person at the Till screen rather than
 * just showing the sentence.
 */
export const NO_OPEN_TILL = 'NO_OPEN_TILL'
export const NO_OPEN_TILL_MESSAGE = 'Open the till before taking a payment — Billing → Till.'
export const NO_OPEN_TILL_REFUND_MESSAGE =
  'Open the till before paying a refund out in cash — Billing → Till.'

/** Where the Till screen lives, for the links that send people to it. */
export const TILL_PATH = '/billing/till'

/** Money is compared to the paisa; floating-point drift is not a variance. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Does a refund paid out by this method need a till open?
 *
 * Only cash. A cash refund is money physically leaving the drawer, and with no
 * session to charge it to, the next closing would count a drawer short by that
 * amount with nothing on the record to explain it — finding 38 the other way
 * round. A card reversal, a bank transfer, a cheque or a wallet refund does not
 * go through the drawer: it is settled by the bank or the terminal, carries its
 * own reference, and is on the refund trail either way. Refusing those until
 * somebody opens a till would hold up money owed to a patient for no gain in
 * what can be reconciled. When a till is open they are still attached to it,
 * so its closing sees every outflow by the method it left by.
 */
export function refundNeedsOpenTill(method: PaymentMethod | string): boolean {
  return method === 'CASH'
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
export function expectedTotals(
  received: ReadonlyArray<{ method: string; amount: number }>,
  refunded: ReadonlyArray<{ method: string; amount: number }>,
  openingFloat: number
): MethodTotal[] {
  const sum = (rows: ReadonlyArray<{ method: string; amount: number }>, method: string) =>
    rows.reduce(
      (total, row) => (row.method === method ? total + Number(row.amount || 0) : total),
      0
    )
  const float = Number(openingFloat) || 0

  return PAYMENT_METHODS.map((method) => {
    const inn = round2(sum(received, method))
    const out = round2(sum(refunded, method))
    return {
      paymentMethod: method,
      received: inn,
      refunded: out,
      expected: round2(inn - out + (method === 'CASH' ? float : 0)),
    }
  })
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

export function totalVariance(lines: ReadonlyArray<{ varianceAmount: number }>): number {
  return round2(lines.reduce((sum, l) => sum + l.varianceAmount, 0))
}

/** Expected, received and refunded across every method, for the summary line. */
export function sumTotals(lines: ReadonlyArray<MethodTotal>): {
  received: number
  refunded: number
  expected: number
} {
  return {
    received: round2(lines.reduce((s, l) => s + l.received, 0)),
    refunded: round2(lines.reduce((s, l) => s + l.refunded, 0)),
    expected: round2(lines.reduce((s, l) => s + l.expected, 0)),
  }
}

/**
 * The methods the closing form asks the person to count.
 *
 * Cash always — the float is in the drawer even on a day with no takings — and
 * any other method that saw money in or out. A method with nothing expected and
 * nothing moved is counted as zero without asking, which is what it holds;
 * listing all six on a phone would bury the two that matter.
 */
export function methodsToCount(lines: ReadonlyArray<MethodTotal>): PaymentMethod[] {
  return lines
    .filter(
      (l) => l.paymentMethod === 'CASH' || l.received !== 0 || l.refunded !== 0 || l.expected !== 0
    )
    .map((l) => l.paymentMethod)
}

/**
 * A typed count, as a number, or null when it is not one.
 *
 * Blank is null rather than zero: the closing form will not let a method with
 * money expected in it be left blank, so that "I forgot to count the card
 * machine" is not recorded as "the card machine was empty".
 */
export function parseCount(input: string | null | undefined): number | null {
  const text = (input ?? '').replace(/,/g, '').trim()
  if (text === '') return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return null
  return round2(value)
}

/**
 * The totals of a closed session from its stamped count rows. Decimals come
 * back from the API as strings, so everything is read through Number().
 */
export function closedSessionTotals(
  counts: ReadonlyArray<{
    expectedAmount: number | string
    countedAmount: number | string
    varianceAmount: number | string
  }>
): { expected: number; counted: number; variance: number } {
  return {
    expected: round2(counts.reduce((s, c) => s + Number(c.expectedAmount), 0)),
    counted: round2(counts.reduce((s, c) => s + Number(c.countedAmount), 0)),
    variance: round2(counts.reduce((s, c) => s + Number(c.varianceAmount), 0)),
  }
}

/** How a variance reads at the desk: balanced, over or short. */
export function varianceKind(variance: number): 'balanced' | 'over' | 'short' {
  const v = round2(variance)
  if (v === 0) return 'balanced'
  return v > 0 ? 'over' : 'short'
}
