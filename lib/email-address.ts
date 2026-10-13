import { z } from 'zod'

/**
 * Email addresses, as the application stores and compares them.
 *
 * Nothing used to lower-case an address (bug report 12 Oct, finding 29). So
 * `QA.Store@clinic.test` became a second member of staff beside
 * `qa.store@clinic.test`, under the unique index that was meant to stop it,
 * and somebody who typed their address with a capital could not sign in.
 *
 * The local part of an address is case-sensitive on paper and on no mail
 * server anybody in a clinic uses. So addresses are trimmed and lower-cased on
 * the way in, everywhere one is written, and matched without regard to case
 * everywhere one is looked up — the second because rows written before this
 * change still carry whatever case they were typed in.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** Is this something mail could be sent to? Checked after normalising. */
export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && z.string().email().safeParse(normaliseEmail(value)).success
}

/**
 * A required email field: trimmed, lower-cased, then checked.
 *
 * The order matters. `z.string().email()` refuses `" a@b.com"`, and an address
 * pasted from an email signature usually brings a space with it.
 */
export function emailField(message = 'Please enter a valid email address') {
  return z.string().transform(normaliseEmail).pipe(z.string().email(message))
}

/**
 * The Prisma filter for "this address, in whatever case it was stored".
 *
 * For lookups that cannot use the `(hospitalId, email)` unique index directly
 * because an older row may hold the address in mixed case.
 */
export function emailEquals(email: string) {
  return { equals: normaliseEmail(email), mode: 'insensitive' as const }
}
