/**
 * Medical history as three lists rather than sixteen booleans.
 *
 * The booleans could only record what somebody thought of when the schema was
 * written. A patient on warfarin, a transplant recipient, anyone on a
 * bisphosphonate — all of them matter more to an extraction than several of the
 * conditions that did get a column, and all of them ended up crammed into
 * `otherConditions` as prose that no alert ever read.
 */
import { describe, it, expect } from 'vitest'
import {
  COMMON_ALLERGIES,
  COMMON_CONDITIONS,
  medicalAlerts,
  normalizeList,
} from '@/lib/medical-history'

describe('normalizeList', () => {
  it('trims and drops blanks', () => {
    expect(normalizeList(['  Penicillin ', '', '   ', 'Latex'])).toEqual(['Penicillin', 'Latex'])
  })

  // "Penicillin, penicillin" on one record is a record somebody stops trusting.
  it('removes duplicates that differ only in case', () => {
    expect(normalizeList(['Penicillin', 'penicillin', 'PENICILLIN'])).toEqual(['Penicillin'])
  })

  it('keeps the spelling that was actually typed', () => {
    expect(normalizeList(['latex', 'Latex'])).toEqual(['latex'])
  })

  it('ignores anything that is not a string', () => {
    expect(normalizeList(['Latex', 42, null, { a: 1 }])).toEqual(['Latex'])
  })

  it('copes with something that is not a list at all', () => {
    expect(normalizeList(null)).toEqual([])
    expect(normalizeList('Penicillin')).toEqual([])
  })
})

describe('the lists the form offers', () => {
  it('leads with the conditions that change what happens in the chair', () => {
    // Not alphabetical: a form that buries a bleeding disorder under "Asthma"
    // is a form people scroll past.
    expect(COMMON_CONDITIONS.slice(0, 3)).toEqual([
      'Bleeding disorder',
      'Anticoagulant therapy',
      'Heart disease',
    ])
  })

  it('includes the conditions the old boolean columns could not express', () => {
    for (const condition of [
      'Anticoagulant therapy',
      'Bisphosphonate therapy',
      'Immunosuppression',
    ])
      expect(COMMON_CONDITIONS).toContain(condition)
  })

  it('prompts for the allergies a dental clinic actually has to hand', () => {
    for (const allergy of ['Penicillin', 'Local anaesthetic', 'Latex'])
      expect(COMMON_ALLERGIES).toContain(allergy)
  })
})

describe('medicalAlerts', () => {
  it('names the allergy rather than saying there is one', () => {
    // The old badge said "Allergies" and left the clinician to go and look.
    expect(medicalAlerts({ allergies: ['Penicillin'] })).toEqual([
      { label: 'Allergy: Penicillin', tone: 'danger' },
    ])
  })

  it('treats every allergy as urgent', () => {
    const alerts = medicalAlerts({ allergies: ['Latex', 'Local anaesthetic'] })
    expect(alerts).toHaveLength(2)
    expect(alerts.every((a) => a.tone === 'danger')).toBe(true)
  })

  it('raises a pregnancy, which changes what may be prescribed today', () => {
    expect(medicalAlerts({ isPregnant: true })).toContainEqual({
      label: 'Pregnant',
      tone: 'danger',
    })
  })

  // The distinction that matters: something that changes whether an extraction
  // happens today, versus something to be aware of.
  it('marks bleeding and cardiac risk as urgent and the rest as a warning', () => {
    const alerts = medicalAlerts({ conditions: ['Anticoagulant therapy', 'Asthma'] })
    expect(alerts).toEqual([
      { label: 'Anticoagulant therapy', tone: 'danger' },
      { label: 'Asthma', tone: 'warning' },
    ])
  })

  it('recognises urgency in a clinic’s own wording, not only the picklist', () => {
    expect(medicalAlerts({ conditions: ['On warfarin since March'] })[0].tone).toBe('danger')
    expect(medicalAlerts({ conditions: ['Haemophilia A'] })[0].tone).toBe('danger')
  })

  it('returns nothing for a patient with nothing recorded', () => {
    expect(medicalAlerts({})).toEqual([])
    expect(medicalAlerts({ allergies: [], conditions: [], isPregnant: false })).toEqual([])
  })
})
