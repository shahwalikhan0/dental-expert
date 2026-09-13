/**
 * CNIC — Pakistan's national identity number, replacing Aadhaar.
 *
 * Thirteen digits rather than Aadhaar's twelve, so a validator carried over
 * unchanged would have rejected every real Pakistani CNIC.
 */
import { describe, it, expect } from 'vitest'
import {
  CNIC_LENGTH,
  formatCNIC,
  formatCNICInput,
  normalizeCNIC,
  parseOptionalCNIC,
  validateCNIC,
} from '@/lib/cnic'

describe('normalizeCNIC', () => {
  it('keeps only the digits, however it was typed', () => {
    expect(normalizeCNIC('35202-1234567-1')).toBe('3520212345671')
    expect(normalizeCNIC('35202 1234567 1')).toBe('3520212345671')
    expect(normalizeCNIC('3520212345671')).toBe('3520212345671')
  })

  it('handles nothing at all', () => {
    expect(normalizeCNIC(null)).toBe('')
    expect(normalizeCNIC(undefined)).toBe('')
    expect(normalizeCNIC('')).toBe('')
  })
})

describe('validateCNIC', () => {
  it('accepts a valid CNIC in any of the ways people write it', () => {
    expect(validateCNIC('35202-1234567-1')).toBe(true)
    expect(validateCNIC('3520212345671')).toBe(true)
    expect(validateCNIC('35202 1234567 1')).toBe(true)
  })

  // The length is the whole reason this replaces the Aadhaar validator.
  it('rejects a 12-digit Aadhaar number', () => {
    expect(validateCNIC('123456789012')).toBe(false)
  })

  it('rejects anything of the wrong length', () => {
    expect(validateCNIC('352021234567')).toBe(false)
    expect(validateCNIC('35202123456712')).toBe(false)
    expect(validateCNIC('')).toBe(false)
  })

  it('rejects letters', () => {
    expect(validateCNIC('3520A-1234567-1')).toBe(false)
  })

  // The first digit is the province: 1 KP, 2 FATA, 3 Punjab, 4 Sindh,
  // 5 Balochistan, 6 Islamabad, 7 Gilgit-Baltistan.
  it('accepts every issued province code', () => {
    for (const province of [1, 2, 3, 4, 5, 6, 7]) {
      expect(validateCNIC(`${province}520212345671`.slice(0, 13))).toBe(true)
    }
  })

  it('rejects a province code that is never issued', () => {
    expect(validateCNIC('0520212345671')).toBe(false)
    expect(validateCNIC('8520212345671')).toBe(false)
    expect(validateCNIC('9520212345671')).toBe(false)
  })

  /**
   * The last digit is odd for male and even for female, but this deliberately
   * does not check it against the patient's recorded gender: the two disagree
   * for transgender citizens, for records NADRA has amended, and for anyone
   * whose gender is recorded here as something the card does not carry.
   */
  it('accepts both gender digits regardless of anything else', () => {
    expect(validateCNIC('3520212345671')).toBe(true)
    expect(validateCNIC('3520212345672')).toBe(true)
  })
})

describe('formatCNIC', () => {
  it('groups the digits the way the card prints them', () => {
    expect(formatCNIC('3520212345671')).toBe('35202-1234567-1')
  })

  it('reformats something already hyphenated', () => {
    expect(formatCNIC('35202 1234567 1')).toBe('35202-1234567-1')
  })

  // A stored value of the wrong length is shown as-is rather than mangled into
  // a shape that would suggest it is valid.
  it('leaves a value it cannot format alone', () => {
    expect(formatCNIC('123456789012')).toBe('123456789012')
    expect(formatCNIC(null)).toBe('')
  })
})

describe('formatCNICInput', () => {
  it('adds each hyphen as the digit before it is typed', () => {
    expect(formatCNICInput('3')).toBe('3')
    expect(formatCNICInput('35202')).toBe('35202')
    expect(formatCNICInput('352021')).toBe('35202-1')
    expect(formatCNICInput('352021234567')).toBe('35202-1234567')
    expect(formatCNICInput('3520212345671')).toBe('35202-1234567-1')
  })

  it('stops at thirteen digits', () => {
    expect(formatCNICInput('352021234567199')).toBe('35202-1234567-1')
  })

  // Backspacing over a hyphen must not fight the user.
  it('survives re-formatting its own output', () => {
    expect(formatCNICInput(formatCNICInput('3520212345671'))).toBe('35202-1234567-1')
  })

  it('ignores anything that is not a digit', () => {
    expect(formatCNICInput('abc35202')).toBe('35202')
  })
})

describe('parseOptionalCNIC', () => {
  // Children hold a B-Form rather than a CNIC, and plenty of adults will not
  // have theirs at the desk.
  it('treats blank as absent, not as an error', () => {
    expect(parseOptionalCNIC(undefined)).toEqual({ ok: true, value: null })
    expect(parseOptionalCNIC(null)).toEqual({ ok: true, value: null })
    expect(parseOptionalCNIC('')).toEqual({ ok: true, value: null })
    expect(parseOptionalCNIC('   ')).toEqual({ ok: true, value: null })
  })

  // Stored without punctuation so that the same person typed three different
  // ways is one record.
  it('stores the digits alone', () => {
    expect(parseOptionalCNIC('35202-1234567-1')).toEqual({ ok: true, value: '3520212345671' })
    expect(parseOptionalCNIC('35202 1234567 1')).toEqual({ ok: true, value: '3520212345671' })
  })

  it('refuses a malformed number with a message naming the shape', () => {
    const result = parseOptionalCNIC('12345')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('00000-0000000-0')
  })

  // Telling someone staring at a 13-digit number that it "must be 13 digits"
  // tells them nothing about what is actually wrong with it.
  it('says what is wrong when the length is right but the province is not', () => {
    const result = parseOptionalCNIC('9520212345671')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('province')
      expect(result.error).not.toContain('13 digits')
    }
  })

  it('refuses a non-string', () => {
    expect(parseOptionalCNIC(3520212345671).ok).toBe(false)
  })

  it('agrees with CNIC_LENGTH', () => {
    expect(CNIC_LENGTH).toBe(13)
    expect(parseOptionalCNIC('3'.repeat(CNIC_LENGTH)).ok).toBe(true)
  })
})
