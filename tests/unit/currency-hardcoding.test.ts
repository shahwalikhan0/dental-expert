/**
 * No screen may quote a currency that is not the clinic's.
 *
 * This exists because the INR→PKR pass missed nine dashboard pages and two
 * patient-portal pages. Each had rolled its own formatter:
 *
 *     new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'INR' })
 *
 * An `en-PK` locale with an `INR` currency renders a rupee sign — so a
 * Pakistani patient opened their own bill and saw it billed in Indian rupees.
 * Nothing failed, nothing threw, and it survived a pass that was specifically
 * looking for hardcoded currency, because the search had been for the symbol
 * rather than for the currency code.
 *
 * A grep is the right shape of test for this: the defect is textual, spread
 * across files that share no code, and invisible to the type checker.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Razorpay, PhonePe and Paytm settle in INR and nothing else, so the checkout
 * path legitimately names it. Those gateways are India-only and do not onboard
 * Pakistani merchants; if a local processor is ever integrated, this list
 * should shrink, not grow.
 */
const GATEWAY_PATHS = [
  'lib/payment-gateways/',
  'app/api/payments/create-order/',
  'app/api/payments/public-order/',
  'app/pay/',
  'components/billing/payment-checkout.tsx',
]

/** The locale table defines every supported locale, India's included. */
const LOCALE_TABLE = 'lib/i18n/config.ts'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const ROOTS = ['app', 'lib', 'components']

/**
 * Comments are stripped first. The rule is about what the code does, and a
 * comment explaining that `Asia/Kolkata` used to be hardcoded here is exactly
 * the kind of note that should survive.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function offendingFiles(pattern: RegExp): string[] {
  const hits: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = file.replace(/\\/g, '/')
      if (rel === LOCALE_TABLE) continue
      if (GATEWAY_PATHS.some((p) => rel.startsWith(p) || rel === p)) continue
      if (pattern.test(stripComments(readFileSync(file, 'utf8')))) hits.push(rel)
    }
  }
  return hits
}

describe('currency is never hardcoded to another country', () => {
  it('no screen formats amounts as INR', () => {
    expect(offendingFiles(/['"]INR['"]/)).toEqual([])
  })

  // The symbol went in the first pass; the currency code is what was left.
  it('no screen prints a rupee sign directly', () => {
    expect(offendingFiles(/₹/)).toEqual([])
  })

  it('no screen formats dates or amounts against an Indian locale', () => {
    expect(offendingFiles(/['"]en-IN['"]/)).toEqual([])
  })

  // Asia/Kolkata was hardcoded on both ends of every synced calendar event,
  // putting a Pakistani clinic's invitations half an hour out.
  it('no code hardcodes an Indian timezone', () => {
    expect(offendingFiles(/Asia\/Kolkata/)).toEqual([])
  })
})
