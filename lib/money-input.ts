/**
 * Reading an amount of money somebody typed.
 *
 * Every money field in the dashboard was `type="number"` read with
 * `Number(value) || 0`, which turns a typo, a blank and "1,500" alike into
 * zero — a free treatment nobody meant to give. `parseMoney` says null for
 * anything that is not an amount, and the form decides what a blank means.
 *
 * Kept apart from the component so it can be tested and used in validation.
 */

/** Characters people type around an amount that are not part of it. */
const DECORATION = /[\s,]|^rs\.?|^pkr/gi

/**
 * The amount in `raw`, or null.
 *
 * Accepts `1500`, `1,500`, `1500.5`, `1,500.50`, `Rs 1,500`, ` 1500 `.
 * Null for a blank, a negative, more than two decimal places (rather than
 * rounding something the person did not type), or anything else.
 */
export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null
  const cleaned = raw.trim().replace(DECORATION, '')
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Whether `raw` is something other than blank that does not parse — the case
 * a field should flag at once rather than wait for a save.
 */
export function isInvalidMoney(raw: string | null | undefined): boolean {
  return Boolean(raw && raw.trim()) && parseMoney(raw) === null
}

/**
 * The text a money field is tidied to on blur: grouping commas and the "Rs"
 * dropped, the digits otherwise as typed. Unparseable text is left alone so
 * the person can see and fix it.
 */
export function tidyMoney(raw: string): string {
  const value = parseMoney(raw)
  return value === null ? raw : raw.trim().replace(DECORATION, '')
}
