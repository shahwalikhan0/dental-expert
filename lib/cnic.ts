/**
 * CNIC — Pakistan's Computerised National Identity Card number, issued by
 * NADRA. Replaces Aadhaar, which is India's.
 *
 * Thirteen digits, written `00000-0000000-0`:
 *
 *   - the first five are the locality, and the very first digit is the
 *     province or region (1 KP, 2 FATA, 3 Punjab, 4 Sindh, 5 Balochistan,
 *     6 Islamabad, 7 Gilgit-Baltistan)
 *   - the next seven identify the family and the individual within it
 *   - the last is a gender digit, odd for male and even for female
 *
 * Stored as digits alone and formatted for display, so that a number typed
 * with hyphens, with spaces, or without either is the same record — which
 * matters when the CNIC is what tells two patients of the same name apart.
 */

export const CNIC_LENGTH = 13

/** Strip everything that is not a digit. Safe to call on already-clean input. */
export function normalizeCNIC(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\D/g, '')
}

/**
 * Is this a well-formed CNIC?
 *
 * Checks length and the province digit. It deliberately does **not** check the
 * gender digit against the patient's recorded gender: the two disagree for
 * transgender citizens, for records NADRA has since amended, and for anyone
 * whose gender is recorded here as something the card does not carry. A
 * clinical system refusing a valid identity document over that would be both
 * wrong and unkind.
 *
 * There is no checksum in a CNIC, so a transposition inside the middle seven
 * digits cannot be caught here. This catches the common cases: wrong length,
 * letters, and an impossible province.
 */
export function validateCNIC(value: string | null | undefined): boolean {
  const digits = normalizeCNIC(value)
  if (digits.length !== CNIC_LENGTH) return false
  // 0, 8 and 9 are not issued as province codes.
  return /^[1-7]/.test(digits)
}

/** `1234512345671` -> `12345-1234567-1`. Returns input unchanged if not 13 digits. */
export function formatCNIC(value: string | null | undefined): string {
  const digits = normalizeCNIC(value)
  if (digits.length !== CNIC_LENGTH) return value?.trim() ?? ''
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
}

/**
 * Format as someone types, so the hyphens appear on their own.
 *
 * Kept separate from `formatCNIC` because a half-typed number is not a valid
 * CNIC, and the display formatter should not pretend otherwise.
 */
export function formatCNICInput(value: string): string {
  const digits = normalizeCNIC(value).slice(0, CNIC_LENGTH)
  if (digits.length <= 5) return digits
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
}

export const CNIC_PLACEHOLDER = '00000-0000000-0'

/**
 * Validate an optional CNIC on the way into the database.
 *
 * Returns the digits to store, or an error message. Blank is not an error —
 * children hold a B-Form rather than a CNIC, and plenty of patients will not
 * have theirs to hand at the desk.
 */
export function parseOptionalCNIC(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null }
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'CNIC must be text' }
  }
  // Only genuinely blank input counts as absent. Text that happens to contain
  // no digits — "N/A", "none", a mistyped word — is rejected rather than
  // quietly dropped: someone who typed something and got a saved record with
  // an empty field would reasonably think it had been stored.
  if (value.trim() === '') {
    return { ok: true, value: null }
  }
  const digits = normalizeCNIC(value)
  if (digits.length !== CNIC_LENGTH) {
    return {
      ok: false,
      error: `CNIC must be ${CNIC_LENGTH} digits in the form ${CNIC_PLACEHOLDER}`,
    }
  }
  // Separated from the length message on purpose: telling someone staring at a
  // 13-digit number that it "must be 13 digits" tells them nothing.
  if (!validateCNIC(digits)) {
    return {
      ok: false,
      error: 'A CNIC starts with a province digit from 1 to 7',
    }
  }
  return { ok: true, value: digits }
}
