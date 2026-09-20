import { describe, it, expect } from 'vitest'
import {
  canDecideOn,
  splitName,
  subjectName,
  subjectPhone,
  validateVisitor,
  visitorState,
} from '@/lib/visitors'

/**
 * Walk-ins.
 *
 * An appointment belongs to a patient or to a visitor, and exactly one of the
 * two. The front desk should not have to invent a patient record for somebody
 * who may never come back.
 */

describe('visitorState', () => {
  it('is open until somebody decides', () => {
    expect(visitorState({ convertedAt: null, discardedAt: null })).toBe('OPEN')
  })

  it('reads converted and discarded', () => {
    expect(visitorState({ convertedAt: new Date(), discardedAt: null })).toBe('CONVERTED')
    expect(visitorState({ convertedAt: null, discardedAt: new Date() })).toBe('DISCARDED')
  })

  // Converting wins if both are somehow set: a registered patient is the more
  // consequential fact, and reading it as "discarded" would hide a real record.
  it('prefers converted when both are set', () => {
    expect(visitorState({ convertedAt: new Date(), discardedAt: new Date() })).toBe('CONVERTED')
  })

  it('only allows a decision once', () => {
    expect(canDecideOn({ convertedAt: null, discardedAt: null })).toBe(true)
    expect(canDecideOn({ convertedAt: new Date(), discardedAt: null })).toBe(false)
    expect(canDecideOn({ convertedAt: null, discardedAt: new Date() })).toBe(false)
  })
})

describe('splitName', () => {
  it('takes the last word as the family name', () => {
    expect(splitName('Sana Malik')).toEqual({ firstName: 'Sana', lastName: 'Malik' })
  })

  // A guess, and the conversion screen shows it for correction rather than
  // committing it silently — which is the whole reason this is a guess and not
  // a rule.
  it('keeps everything before the last word together', () => {
    expect(splitName('Muhammad Ali Khan')).toEqual({
      firstName: 'Muhammad Ali',
      lastName: 'Khan',
    })
  })

  it('survives one word, extra spaces and nothing at all', () => {
    expect(splitName('Bilal')).toEqual({ firstName: 'Bilal', lastName: '' })
    expect(splitName('  Sana   Malik  ')).toEqual({ firstName: 'Sana', lastName: 'Malik' })
    expect(splitName('')).toEqual({ firstName: '', lastName: '' })
  })
})

describe('validateVisitor', () => {
  it('needs a name and nothing else', () => {
    expect(validateVisitor({ name: 'Bilal Ahmed' })).toBeNull()
    expect(validateVisitor({ name: 'Bilal Ahmed', phone: '03211234567' })).toBeNull()
  })

  it('refuses an empty or absurd name', () => {
    expect(validateVisitor({ name: '' })).toMatch(/needs a name/)
    expect(validateVisitor({ name: 'A' })).toMatch(/needs a name/)
    expect(validateVisitor({ name: 'x'.repeat(200) })).toMatch(/too long/)
  })

  it('refuses a phone number that cannot be one', () => {
    expect(validateVisitor({ name: 'Bilal', phone: '123' })).toMatch(/phone/)
    expect(validateVisitor({ name: 'Bilal', phone: '1'.repeat(20) })).toMatch(/phone/)
  })

  // Blank is not wrong. A walk-in who will not give a number is still somebody
  // the clinic is about to see.
  it('accepts a blank phone number', () => {
    expect(validateVisitor({ name: 'Bilal', phone: '' })).toBeNull()
    expect(validateVisitor({ name: 'Bilal', phone: null })).toBeNull()
  })
})

describe('subjectName and subjectPhone', () => {
  it('reads a registered patient', () => {
    const appointment = {
      patient: { firstName: 'Sana', lastName: 'Malik', phone: '03211234599' },
      visitor: null,
    }
    expect(subjectName(appointment)).toBe('Sana Malik')
    expect(subjectPhone(appointment)).toBe('03211234599')
  })

  it('reads a walk-in', () => {
    const appointment = {
      patient: null,
      visitor: { name: 'Bilal Ahmed', phone: '03009998877' },
    }
    expect(subjectName(appointment)).toBe('Bilal Ahmed')
    expect(subjectPhone(appointment)).toBe('03009998877')
  })

  it('says so when it is neither', () => {
    expect(subjectName({ patient: null, visitor: null })).toBe('Unknown')
    expect(subjectPhone({ patient: null, visitor: null })).toBeNull()
  })
})
