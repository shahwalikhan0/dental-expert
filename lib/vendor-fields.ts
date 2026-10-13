/**
 * Reading the free-form fields of a supplier or laboratory from a request.
 *
 * Suppliers and laboratories share the `Vendor` table and both screens post
 * the same fields, so the rules for them live here rather than in two route
 * files that would drift.
 */

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * A rating of 1 to 5, or null for "not rated".
 *
 * The Add Vendor form sent `rating: 0` for a laboratory nobody had rated, the
 * route stored `0 || null`, and the vendors page called `.toFixed` on the
 * null — so adding a laboratory the normal way broke the Lab Vendors screen
 * for everybody (bug report 12 Oct, finding 20). Zero, blank and absent now
 * all mean the same thing, and are stored the same way: null.
 *
 * `undefined` comes back as undefined, so an update that does not mention the
 * rating leaves it alone.
 */
export function parseRating(value: unknown): FieldResult<number | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null || value === '' || value === 0 || value === '0') {
    return { ok: true, value: null }
  }

  const rating = Number(value)
  // The column is an integer: a rating of 4.5 would be a Prisma validation
  // error, which is a 500.
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'The rating must be a whole number from 1 to 5' }
  }
  return { ok: true, value: rating }
}

/**
 * Payment terms as text, such as "Net 30".
 *
 * The column is text, and a supplier sent with `paymentTerms: 30` was a 500
 * (finding 49). A number is taken to mean days and written the way the screen
 * writes it; anything that is neither text nor a number is refused.
 *
 * `undefined` comes back as undefined, so an update that does not mention the
 * terms leaves them alone; blank is null.
 */
export function parsePaymentTerms(value: unknown): FieldResult<string | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null) return { ok: true, value: null }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, error: 'Payment terms must be text, such as "Net 30"' }
    }
    return { ok: true, value: `Net ${value}` }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return { ok: true, value: trimmed === '' ? null : trimmed }
  }

  return { ok: false, error: 'Payment terms must be text, such as "Net 30"' }
}

/**
 * A credit limit of zero or more, or null. A number arriving as text from a
 * form is accepted; text that is not a number is refused rather than handed
 * to the Decimal column to throw over.
 */
export function parseCreditLimit(value: unknown): FieldResult<number | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null || value === '') return { ok: true, value: null }

  const limit = Number(value)
  if (!Number.isFinite(limit) || limit < 0) {
    return { ok: false, error: 'The credit limit must be a number of zero or more' }
  }
  return { ok: true, value: limit }
}
