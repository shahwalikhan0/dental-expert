import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
  formatCurrency as baseFormatCurrency,
  formatDate as baseFormatDate,
  formatDateTime as baseFormatDateTime,
} from '@/lib/i18n/format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, locale?: string): string {
  return baseFormatCurrency(amount, { locale })
}

export function formatDate(date: Date | string, locale?: string): string {
  return baseFormatDate(date, { locale })
}

export function formatDateTime(date: Date | string, locale?: string): string {
  return baseFormatDateTime(date, { locale })
}

/**
 * Display a Pakistani mobile number as `+92 3XX XXXXXXX`.
 *
 * Accepts the three shapes a clinic actually types: the national form with its
 * trunk zero (03001234567), the bare subscriber number (3001234567), and the
 * full international form (923001234567). Anything else is returned untouched
 * rather than mangled — a landline or a foreign number should still be legible.
 */
export function formatPhone(phone: string): string {
  if (!phone) return ''
  const cleaned = phone.replace(/\D/g, '')

  let subscriber: string | null = null
  if (cleaned.length === 10 && cleaned.startsWith('3')) {
    subscriber = cleaned
  } else if (cleaned.length === 11 && cleaned.startsWith('03')) {
    subscriber = cleaned.slice(1)
  } else if (cleaned.length === 12 && cleaned.startsWith('92')) {
    subscriber = cleaned.slice(2)
  }

  if (!subscriber) return phone
  return `+92 ${subscriber.slice(0, 3)} ${subscriber.slice(3)}`
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
