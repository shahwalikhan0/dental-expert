// Billing & Financial Management Utilities

import { InvoiceStatus, PaymentMethod, PaymentStatus, DiscountType } from '@prisma/client'
import type { Prisma, PrismaClient } from '@prisma/client'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { dayRangeIn, localDay } from '@/lib/appointment-time'
import { round2 } from '@/lib/till'

type Db = PrismaClient | Prisma.TransactionClient
import {
  formatCurrency as baseFormatCurrency,
  formatDate as baseFormatDate,
  formatDateTime as baseFormatDateTime,
} from '@/lib/i18n/format'

// Invoice Status Configuration
export const invoiceStatusConfig: Record<
  InvoiceStatus,
  {
    label: string
    color: string
    bgColor: string
    description: string
  }
> = {
  DRAFT: {
    label: 'Draft',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    description: 'Invoice is being prepared',
  },
  PENDING: {
    label: 'Pending',
    color: 'text-yellow-700 dark:text-yellow-300',
    bgColor: 'bg-yellow-100 dark:bg-yellow-950/40',
    description: 'Invoice sent, awaiting payment',
  },
  PARTIALLY_PAID: {
    label: 'Partially Paid',
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-100 dark:bg-blue-950/40',
    description: 'Partial payment received',
  },
  PAID: {
    label: 'Paid',
    color: 'text-green-700 dark:text-green-300',
    bgColor: 'bg-green-100 dark:bg-green-950/40',
    description: 'Full payment received',
  },
  OVERDUE: {
    label: 'Overdue',
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-950/40',
    description: 'Payment past due date',
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    description: 'Invoice has been cancelled',
  },
  REFUNDED: {
    label: 'Refunded',
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-100 dark:bg-purple-950/40',
    description: 'Payment has been refunded',
  },
}

// Payment Method Configuration
export const paymentMethodConfig: Record<
  PaymentMethod,
  {
    label: string
    icon: string
    description: string
  }
> = {
  CASH: {
    label: 'Cash',
    icon: 'Banknote',
    description: 'Cash payment',
  },
  CARD: {
    label: 'Card',
    icon: 'CreditCard',
    description: 'Debit/Credit card',
  },
  BANK_TRANSFER: {
    label: 'Bank Transfer',
    icon: 'Building2',
    // Was "NEFT/RTGS/IMPS" — India's three interbank rails.
    description: 'Raast or interbank transfer',
  },
  CHEQUE: {
    label: 'Cheque',
    icon: 'FileText',
    description: 'Cheque payment',
  },
  WALLET: {
    label: 'Mobile Wallet',
    icon: 'Smartphone',
    description: 'JazzCash, Easypaisa, SadaPay',
  },
  ONLINE: {
    label: 'Online',
    icon: 'Globe',
    description: 'Online payment gateway',
  },
}

// Payment Status Configuration
export const paymentStatusConfig: Record<
  PaymentStatus,
  {
    label: string
    color: string
    bgColor: string
  }
> = {
  PENDING: {
    label: 'Pending',
    color: 'text-yellow-700 dark:text-yellow-300',
    bgColor: 'bg-yellow-100 dark:bg-yellow-950/40',
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-green-700 dark:text-green-300',
    bgColor: 'bg-green-100 dark:bg-green-950/40',
  },
  FAILED: {
    label: 'Failed',
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-950/40',
  },
  PARTIALLY_REFUNDED: {
    label: 'Partially Refunded',
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
  },
  REFUNDED: {
    label: 'Refunded',
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-100 dark:bg-purple-950/40',
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
}

// Discount Type Configuration
export const discountTypeConfig: Record<
  DiscountType,
  {
    label: string
    symbol: string
  }
> = {
  PERCENTAGE: {
    label: 'Percentage',
    symbol: '%',
  },
  FIXED: {
    label: 'Fixed Amount',
    symbol: 'Rs',
  },
}

/**
 * Sales tax on services.
 *
 * Upstream hardcoded India's two-component GST — CGST 9% + SGST 9%, plus an
 * 18% inter-state IGST — in the calculation *and* in the Invoice columns. This
 * clinic is in Pakistan, where sales tax on services is a single provincial
 * levy and dental services are exempt, so the default is no tax at all.
 *
 * It stays configurable rather than being removed: `Hospital.taxEnabled`,
 * `taxRate` and `taxLabel` turn it on without a migration, and the rate that
 * applied is stamped onto each invoice so reprints stay faithful.
 */
export const taxConfig = {
  /** Off by default — dental services are exempt for this clinic. */
  rate: 0,
  /** Printed beside the tax line when there is one. */
  label: 'Sales Tax',
  defaultTaxable: true,
}

/**
 * The rate to apply to a new invoice for this clinic.
 *
 * Reads the clinic record rather than a constant, so enabling tax is a
 * settings change. `taxEnabled` is checked separately from the rate: a clinic
 * that switches tax off should stop charging immediately without having to
 * zero the rate it will want back later.
 */
export function resolveTaxRate(
  hospital: { taxEnabled?: boolean | null; taxRate?: unknown } | null | undefined
): number {
  if (!hospital?.taxEnabled) return 0
  const rate = Number(hospital.taxRate ?? 0)
  return Number.isFinite(rate) && rate > 0 ? rate : 0
}

// Calculate discount
export function calculateDiscount(
  subtotal: number,
  discountType: DiscountType,
  discountValue: number
): {
  discountAmount: number
  afterDiscount: number
} {
  let discountAmount: number

  if (discountType === 'PERCENTAGE') {
    discountAmount = (subtotal * discountValue) / 100
  } else {
    discountAmount = discountValue
  }

  // Never more than the bill and never negative; the server refuses either
  // outright (`discountProblem`), this keeps a preview of a half-typed value sane.
  discountAmount = round2(Math.max(0, Math.min(Number(discountAmount) || 0, subtotal)))

  return {
    discountAmount,
    afterDiscount: round2(subtotal - discountAmount),
  }
}

/**
 * Why a discount cannot be applied to this subtotal, or null if it can.
 *
 * `calculateDiscount` clamps a discount to the subtotal, which is right for a
 * form previewing what is being typed and wrong for the server: a 150%
 * discount, or Rs 5,000 off a Rs 1,500 bill, was accepted and quietly billed
 * at zero (bug report 12 Oct, finding 37). Whoever typed it meant something
 * else, and the invoice should say so rather than guess.
 */
export function discountProblem(
  subtotal: number,
  discountType: DiscountType | string | null | undefined,
  discountValue: unknown
): string | null {
  const value = Number(discountValue ?? 0)
  if (!Number.isFinite(value) || value < 0) return 'The discount must be zero or more'
  if (discountType !== 'PERCENTAGE' && discountType !== 'FIXED') {
    return 'The discount type must be PERCENTAGE or FIXED'
  }
  if (discountType === 'PERCENTAGE' && value > 100) {
    return 'A percentage discount must be between 0 and 100'
  }
  if (discountType === 'FIXED' && value > Math.round(subtotal * 100) / 100) {
    return `A discount of ${value} is more than the ${Math.round(subtotal * 100) / 100} being billed`
  }
  return null
}

/** One line of an invoice, as far as its money goes. */
export interface InvoiceLineMoney {
  quantity: number
  unitPrice: number
  taxable: boolean
}

export interface InvoiceTotals {
  /** Each line as it is stored: price and amount to the paisa, in input order. */
  lines: Array<{ quantity: number; unitPrice: number; amount: number; taxable: boolean }>
  subtotal: number
  discountAmount: number
  /** The taxable lines after their share of the discount — what tax is charged on. */
  taxableAmount: number
  nonTaxableAmount: number
  taxAmount: number
  totalAmount: number
}

/**
 * The money on an invoice, from its lines, discount and tax rate.
 *
 * The one implementation: the create and edit routes, the issue step and both
 * invoice forms all call it, so what the form previews is what gets stored.
 *
 * Every figure is rounded to the paisa *before* the next one is built from it,
 * and the total is assembled from those rounded parts. This used to round each
 * output on its own from unrounded intermediates, so the printed lines could
 * disagree with the printed total: Rs 3,333 at 2.5% off printed
 * 3,333.00 − 83.33 = 3,249.67 beside a Total of 3,249.68 (invoice review 1.3).
 *
 *  - a unit price is taken to 2 dp, as the column stores it, and each line's
 *    amount is quantity × that price, rounded — the line the patient reads;
 *  - the subtotal is the sum of those amounts;
 *  - the discount is clamped to the subtotal and rounded;
 *  - it is shared pro rata between taxable and exempt lines (review 1.4), the
 *    taxable share rounded and the exempt share taking the remainder, so the
 *    two shares always add back to the discount;
 *  - tax is the rate on the taxable value, rounded;
 *  - total = subtotal − discount + tax, exactly.
 */
export function calculateInvoiceTotals(
  items: InvoiceLineMoney[],
  discountType: DiscountType = 'FIXED',
  discountValue: number = 0,
  taxRate: number = taxConfig.rate
): InvoiceTotals {
  const lines = items.map((item) => {
    const quantity = Number(item.quantity) || 0
    const unitPrice = round2(Number(item.unitPrice) || 0)
    return { quantity, unitPrice, amount: round2(quantity * unitPrice), taxable: !!item.taxable }
  })

  const taxableSubtotal = round2(
    lines.filter((l) => l.taxable).reduce((sum, l) => sum + l.amount, 0)
  )
  const nonTaxableSubtotal = round2(
    lines.filter((l) => !l.taxable).reduce((sum, l) => sum + l.amount, 0)
  )
  const subtotal = round2(taxableSubtotal + nonTaxableSubtotal)

  const { discountAmount } = calculateDiscount(subtotal, discountType, discountValue)

  const taxableDiscount = subtotal > 0 ? round2((discountAmount * taxableSubtotal) / subtotal) : 0
  const nonTaxableDiscount = round2(discountAmount - taxableDiscount)

  const taxableAmount = round2(taxableSubtotal - taxableDiscount)
  const nonTaxableAmount = round2(nonTaxableSubtotal - nonTaxableDiscount)
  const rate = Number(taxRate) > 0 ? Number(taxRate) : 0
  const taxAmount = round2((taxableAmount * rate) / 100)

  return {
    lines,
    subtotal,
    discountAmount,
    taxableAmount,
    nonTaxableAmount,
    taxAmount,
    totalAmount: round2(subtotal - discountAmount + taxAmount),
  }
}

// Invoices always show both decimal places, unlike the summary figures
// elsewhere in the app.
export function formatCurrency(
  amount: number | string | null | undefined,
  locale?: string
): string {
  return baseFormatCurrency(amount, {
    locale,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Format date for display
export function formatDate(date: Date | string | null | undefined, locale?: string): string {
  return baseFormatDate(date, { locale })
}

// Format date-time for display
export function formatDateTime(date: Date | string | null | undefined, locale?: string): string {
  return baseFormatDateTime(date, { locale, hour12: true })
}

/**
 * The next invoice number for a clinic, as `INV-202609-0001`.
 *
 * Two changes from what this replaced. It is **atomic**, so two receptionists
 * billing in the same second get two numbers rather than one number and a 500.
 * And it is **per clinic**: the old version scanned every invoice in the
 * database regardless of who it belonged to, so one clinic's numbering jumped
 * whenever another clinic billed.
 */
export async function generateInvoiceNo(
  db: Db,
  hospitalId: string,
  prefix: string = 'INV'
): Promise<string> {
  const now = new Date()
  const series = `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`

  return nextInSeries(db, {
    hospitalId,
    prefix: series,
    width: 4,
    currentMax: async () => {
      const last = await db.invoice.findFirst({
        where: { hospitalId, invoiceNo: { startsWith: series } },
        orderBy: { invoiceNo: 'desc' },
        select: { invoiceNo: true },
      })
      return trailingNumber(last?.invoiceNo, 4)
    },
  })
}

/** The next payment number for a clinic, as `PAY-202609-0001`. */
export async function generatePaymentNo(
  db: Db,
  hospitalId: string,
  prefix: string = 'PAY'
): Promise<string> {
  const now = new Date()
  const series = `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`

  return nextInSeries(db, {
    hospitalId,
    prefix: series,
    width: 4,
    currentMax: async () => {
      const last = await db.payment.findFirst({
        where: { hospitalId, paymentNo: { startsWith: series } },
        orderBy: { paymentNo: 'desc' },
        select: { paymentNo: true },
      })
      return trailingNumber(last?.paymentNo, 4)
    },
  })
}

// Get patient display name
export function getPatientName(
  patient: {
    firstName: string
    lastName: string
    patientId?: string
  } | null
): string {
  if (!patient) return 'Unknown Patient'
  return `${patient.firstName} ${patient.lastName}`
}

// Payment method icons mapping for Lucide icons
export const paymentMethodIcons = {
  CASH: 'Banknote',
  CARD: 'CreditCard',
  BANK_TRANSFER: 'Building2',
  CHEQUE: 'FileText',
  WALLET: 'Wallet',
  ONLINE: 'Globe',
} as const

// Common payment terms
export const paymentTermsOptions = [
  { value: 0, label: 'Due on Receipt' },
  { value: 7, label: 'Net 7 Days' },
  { value: 15, label: 'Net 15 Days' },
  { value: 30, label: 'Net 30 Days' },
  { value: 45, label: 'Net 45 Days' },
  { value: 60, label: 'Net 60 Days' },
]

// Number to words for invoice amounts, in rupees and paisa.
//
// Lakh and crore rather than million: that is how amounts are written in
// Pakistan, on cheques and invoices alike.
export function numberToWords(num: number): string {
  if (num === 0) return 'Zero'

  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ]

  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ]

  const scales = ['', 'Thousand', 'Lakh', 'Crore']

  function convertGroup(n: number): string {
    if (n === 0) return ''
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertGroup(n % 100) : '')
  }

  // Lakh/crore grouping
  const rupees = Math.floor(num)
  const paisa = Math.round((num - rupees) * 100)

  let result = ''

  // Crores (10,000,000+)
  if (rupees >= 10000000) {
    result += convertGroup(Math.floor(rupees / 10000000)) + ' Crore '
  }

  // Lakhs (100,000 - 9,999,999)
  const afterCrore = rupees % 10000000
  if (afterCrore >= 100000) {
    result += convertGroup(Math.floor(afterCrore / 100000)) + ' Lakh '
  }

  // Thousands (1,000 - 99,999)
  const afterLakh = afterCrore % 100000
  if (afterLakh >= 1000) {
    result += convertGroup(Math.floor(afterLakh / 1000)) + ' Thousand '
  }

  // Hundreds and below
  const afterThousand = afterLakh % 1000
  if (afterThousand > 0) {
    result += convertGroup(afterThousand)
  }

  result = result.trim() + ' Rupees'

  if (paisa > 0) {
    result += ' and ' + convertGroup(paisa) + ' Paisa'
  }

  result += ' Only'

  return result.replace(/\s+/g, ' ').trim()
}

// Report date range presets
export const dateRangePresets = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'this_week' },
  { label: 'Last Week', value: 'last_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last Month', value: 'last_month' },
  { label: 'This Quarter', value: 'this_quarter' },
  { label: 'Last Quarter', value: 'last_quarter' },
  { label: 'This Year', value: 'this_year' },
  { label: 'Last Year', value: 'last_year' },
  { label: 'Custom Range', value: 'custom' },
]

/**
 * `YYYY-MM-DD` for a year, month (1-based) and day, letting the day or month
 * run over — day 0 is the last day of the month before — the way `Date.UTC`
 * does.
 */
function ymdOf(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

/**
 * The instants covering whole days `from` to `to` on the clinic's calendar,
 * both included. `endDate` is the last millisecond of `to`, so callers can
 * keep filtering with `lte`.
 *
 * `new Date('2026-10-14')` is UTC midnight, and `setHours(23, 59, 59)` is the
 * *server's* end of day: a custom range in Reports started five hours late
 * and ended in the wrong zone. Built from the clinic's midnight instead, the
 * way `dayRangeIn` builds the appointment day.
 */
export function dateRangeFromDays(
  from: string,
  to: string,
  timezone: string
): { startDate: Date; endDate: Date } {
  return {
    startDate: dayRangeIn(from, timezone).gte,
    endDate: new Date(dayRangeIn(to, timezone).lt.getTime() - 1),
  }
}

/**
 * The instants a report preset covers, on the clinic's calendar.
 *
 * This used to be built from the server's midnight. On a host in UTC a
 * Karachi clinic's "today" started at five in the morning, and the billing
 * summary, the payments report and the dashboard each drew the edge of a day
 * in a different place (invoice review, 14 Oct, §3.2). Current periods run to
 * the end of today; weeks start on Sunday.
 */
export function getDateRangeFromPreset(
  preset: string,
  timezone: string,
  now: Date = new Date()
): {
  startDate: Date
  endDate: Date
} {
  const today = localDay(now, timezone)
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const date = Number(today.slice(8, 10))
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay()
  const range = (from: string, to: string) => dateRangeFromDays(from, to, timezone)

  switch (preset) {
    case 'today':
      return range(today, today)

    case 'yesterday': {
      const yesterday = ymdOf(year, month, date - 1)
      return range(yesterday, yesterday)
    }

    case 'this_week':
      return range(ymdOf(year, month, date - weekday), today)

    case 'last_week':
      return range(ymdOf(year, month, date - weekday - 7), ymdOf(year, month, date - weekday - 1))

    case 'this_month':
      return range(ymdOf(year, month, 1), today)

    case 'last_month':
      return range(ymdOf(year, month - 1, 1), ymdOf(year, month, 0))

    case 'this_quarter': {
      const first = Math.floor((month - 1) / 3) * 3 + 1
      return range(ymdOf(year, first, 1), today)
    }

    case 'last_quarter': {
      const first = Math.floor((month - 1) / 3) * 3 + 1
      return range(ymdOf(year, first - 3, 1), ymdOf(year, first, 0))
    }

    case 'this_year':
      return range(ymdOf(year, 1, 1), today)

    case 'last_year':
      return range(ymdOf(year - 1, 1, 1), ymdOf(year - 1, 12, 31))

    default:
      return range(today, today)
  }
}
