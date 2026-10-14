/**
 * The single locale-aware formatting module.
 *
 * Before this existed there were three near-duplicate `formatCurrency`
 * implementations (lib/utils.ts, lib/billing-utils.ts, lib/treatment-utils.ts),
 * each hardcoding `en-IN` and `INR` with slightly different fraction-digit
 * rules. Those modules now delegate here and keep their own defaults, so
 * behaviour is unchanged while there is finally one place to add a locale.
 *
 * See docs/LOCALIZATION.md.
 */
import { defaultLocale, getLocaleDefaults, resolveLocale } from './config'

export interface CurrencyFormatOptions {
  locale?: string
  /** ISO 4217. Defaults to the locale's currency (PKR for en-PK). */
  currency?: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  /** Returned when the input is null, undefined or unparseable. */
  fallback?: string
}

export interface DateFormatOptions extends Intl.DateTimeFormatOptions {
  locale?: string
  /** Returned when the input is missing or not a valid date. */
  fallback?: string
}

function toNumber(amount: number | string | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === '') return null
  const value = typeof amount === 'string' ? parseFloat(amount) : amount
  return Number.isNaN(value) ? null : value
}

function toDate(date: Date | string | number | null | undefined): Date | null {
  if (date === null || date === undefined || date === '') return null
  const value = date instanceof Date ? date : new Date(date)
  return Number.isNaN(value.getTime()) ? null : value
}

/**
 * Format a monetary amount — **the** money formatter. Every screen shows money
 * through this (directly, or through the `formatCurrency` re-exports in
 * lib/utils, lib/billing-utils and lib/treatment-utils, which delegate here).
 *
 * Always two decimals by default: `Rs 1,500.00`. It used to be 0–2 here and
 * exactly 2 in billing, so the same fee read "Rs 1,500" on the treatment and
 * "Rs 1,500.00" on the invoice raised for it, and a patient comparing the two
 * reasonably asked which was right. Invoices, receipts and the till have to
 * show paisa, so everything else now does too. A chart axis or a dashboard
 * tile that genuinely wants whole rupees passes `maximumFractionDigits: 0`
 * explicitly, which makes the exception visible at the call site.
 *
 * Note that digit grouping is locale-specific, not just the symbol: en-IN
 * groups 100000 as `1,00,000`, en-US as `100,000`.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  options: CurrencyFormatOptions = {}
): string {
  const locale = resolveLocale(options.locale)
  const currency = options.currency ?? getLocaleDefaults(locale).currency
  const {
    maximumFractionDigits = 2,
    // Never above the maximum: Intl throws a RangeError when min > max, which
    // a caller asking for `maximumFractionDigits: 0` would otherwise hit.
    minimumFractionDigits = Math.min(2, maximumFractionDigits),
    // Format the fallback rather than hardcoding a symbol, so a non-PKR
    // clinic does not get a stray rupee sign on empty values.
    fallback = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(0),
  } = options

  const value = toNumber(amount)
  if (value === null) return fallback

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)
}

/** Format a plain number (no currency symbol) with locale digit grouping. */
export function formatNumber(
  value: number | string | null | undefined,
  options: { locale?: string; fallback?: string } & Intl.NumberFormatOptions = {}
): string {
  const { locale, fallback = '-', ...numberFormatOptions } = options
  const parsed = toNumber(value)
  if (parsed === null) return fallback
  return new Intl.NumberFormat(resolveLocale(locale), numberFormatOptions).format(parsed)
}

const DATE_DEFAULTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}

/**
 * A date in a given locale, with Intl options.
 *
 * @deprecated for anything drawn on a screen — use `displayDate` from
 * lib/dates.ts, which reads a bare `YYYY-MM-DD` as that calendar day (this one
 * reads it as UTC midnight, the day before for anyone west of Greenwich) and
 * writes a blank as an em dash like the rest of the application. Kept for the
 * server-side callers that need a specific locale or `timeZone` — documents
 * and messages rendered for a clinic that is not en-PK.
 */
export function formatDate(
  date: Date | string | number | null | undefined,
  options: DateFormatOptions = {}
): string {
  const { locale, fallback = '-', ...dateTimeOptions } = options
  const value = toDate(date)
  if (value === null) return fallback

  return new Intl.DateTimeFormat(resolveLocale(locale), {
    ...DATE_DEFAULTS,
    ...dateTimeOptions,
  }).format(value)
}

export function formatDateTime(
  date: Date | string | number | null | undefined,
  options: DateFormatOptions = {}
): string {
  const { locale, fallback = '-', ...dateTimeOptions } = options
  const value = toDate(date)
  if (value === null) return fallback

  return new Intl.DateTimeFormat(resolveLocale(locale), {
    ...DATE_DEFAULTS,
    hour: '2-digit',
    minute: '2-digit',
    ...dateTimeOptions,
  }).format(value)
}

/**
 * Build a set of formatters bound to one clinic's locale, so call sites in a
 * request handler do not have to thread the locale through every call.
 */
export function createFormatters(locale: string | null | undefined = defaultLocale) {
  const resolved = resolveLocale(locale)
  const { currency } = getLocaleDefaults(resolved)

  return {
    locale: resolved,
    currency,
    formatCurrency: (amount: number | string | null | undefined, o: CurrencyFormatOptions = {}) =>
      formatCurrency(amount, { locale: resolved, currency, ...o }),
    formatNumber: (value: number | string | null | undefined, o: Intl.NumberFormatOptions = {}) =>
      formatNumber(value, { locale: resolved, ...o }),
    formatDate: (date: Date | string | number | null | undefined, o: DateFormatOptions = {}) =>
      formatDate(date, { locale: resolved, ...o }),
    formatDateTime: (date: Date | string | number | null | undefined, o: DateFormatOptions = {}) =>
      formatDateTime(date, { locale: resolved, ...o }),
  }
}
