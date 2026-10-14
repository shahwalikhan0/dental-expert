import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
  formatCurrency as baseFormatCurrency,
  formatDate as baseFormatDate,
  formatDateTime as baseFormatDateTime,
} from '@/lib/i18n/format'
import { displayDate } from '@/lib/dates'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Money, `Rs 1,500.00`. Delegates to the one formatter in lib/i18n/format.ts. */
export function formatCurrency(
  amount: number | string | null | undefined,
  locale?: string
): string {
  return baseFormatCurrency(amount, { locale })
}

/**
 * A date, `20 Sept 2026`.
 *
 * @deprecated Import `displayDate` from lib/dates.ts. Without a locale this is
 * that function; with one it falls back to the locale-aware formatter, which is
 * only right for documents rendered for a non-en-PK clinic.
 */
export function formatDate(date: Date | string | null | undefined, locale?: string): string {
  return locale ? baseFormatDate(date, { locale }) : displayDate(date)
}

export function formatDateTime(date: Date | string, locale?: string): string {
  return baseFormatDateTime(date, { locale })
}

/**
 * The ten-digit subscriber part of a Pakistani mobile number, or null.
 *
 * Accepts every shape a clinic actually types or imports: the national form
 * with its trunk zero (`0300 1234567`), the bare subscriber number
 * (`3001234567`), the international form with or without a plus
 * (`+92 300 1234567`, `923001234567`) and the international dialling prefix
 * (`0092 300 1234567`). Spaces, dashes, dots and brackets are ignored.
 */
export function pakistanMobileSubscriber(phone: string | null | undefined): string | null {
  if (!phone) return null
  const cleaned = phone.replace(/\D/g, '')

  let subscriber: string | null = null
  if (cleaned.length === 10) subscriber = cleaned
  else if (cleaned.length === 11 && cleaned.startsWith('0')) subscriber = cleaned.slice(1)
  else if (cleaned.length === 12 && cleaned.startsWith('92')) subscriber = cleaned.slice(2)
  else if (cleaned.length === 14 && cleaned.startsWith('0092')) subscriber = cleaned.slice(4)

  // Every PTA-allocated mobile prefix is 3XX.
  return subscriber && /^3\d{9}$/.test(subscriber) ? subscriber : null
}

/**
 * Display a phone number as a Pakistani reader writes it: `0300 1234567`.
 *
 * It used to produce `+92 300 1234567` while every phone field's placeholder
 * asked for `0300 1234567`, so the number somebody typed came back in a shape
 * they had not typed — and nothing called it, so phones were shown raw.
 * The national form is what a receptionist dials and reads aloud; the
 * international one is for SMS gateways, which normalise for themselves.
 *
 * Anything that is not a Pakistani mobile — a landline, a foreign number — is
 * returned trimmed rather than mangled. Null and undefined give `''`.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const subscriber = pakistanMobileSubscriber(phone)
  if (!subscriber) return phone.trim()
  return `0${subscriber.slice(0, 3)} ${subscriber.slice(3)}`
}

/**
 * The form a phone number is stored in: `03001234567`, digits only.
 *
 * Digits only because the patient search matches phones with a literal
 * `contains` — a stored `0300 1234567` is not found by somebody typing
 * `03001234567`, and the reverse. The trunk zero is kept because it is how the
 * number is read and searched at the desk (`0300…`). Not a Pakistani mobile:
 * returned trimmed, with its own punctuation, so a landline is not altered.
 */
export function normalisePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const subscriber = pakistanMobileSubscriber(phone)
  return subscriber ? `0${subscriber}` : phone.trim()
}

export function generatePatientId(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0')
  return `PAT${year}${month}${random}`
}

export function generateInvoiceNo(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear())
  const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0')
  return `INV-${year}${month}-${random}`
}

/**
 * A Pakistani mobile number. Every PTA-allocated mobile prefix is 3XX, so the
 * subscriber part is ten digits beginning with 3 — the equivalent of India's
 * [6-9] rule this replaced.
 */
export function validatePakistanPhone(phone: string): boolean {
  let cleaned = phone.replace(/\D/g, '')
  // Strip the country code or the national trunk zero if present
  if (cleaned.length === 12 && cleaned.startsWith('92')) {
    cleaned = cleaned.slice(2)
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1)
  }
  return /^3\d{9}$/.test(cleaned)
}

// `calculateGST`, `validateAadhar` and `validateGSTIN` used to live here.
//
// All three were India-specific and all three were dead: nothing in the
// application imported them, only tests did. `calculateGST` was also a second,
// divergent copy of the one in lib/billing-utils. Tax now goes through
// `calculateTax` there; Pakistani identity and tax numbers (CNIC, NTN, STRN)
// have no validator yet, which is honest — there is nothing to validate until
// the clinic registers.
