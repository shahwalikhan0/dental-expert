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
  allergyClashes,
  isBlankMedicalHistory,
  medicalAlerts,
  medicalHistoryInput,
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

describe('medicalHistoryInput', () => {
  it('keeps the three lists the form offers and nothing else', () => {
    // The POST route used to spread the request body straight into
    // `medicalHistory.create`, so a caller could set any column of the table.
    const input = medicalHistoryInput({
      allergies: ['Penicillin'],
      conditions: ['Diabetes'],
      currentMedications: ['Metformin 500mg'],
      id: 'forged',
      patientId: 'someone-else',
      isPregnant: true,
      dentalAnxietyLevel: 9,
    })

    expect(input).toEqual({
      allergies: ['Penicillin'],
      conditions: ['Diabetes'],
      currentMedications: ['Metformin 500mg'],
    })
  })

  it('tidies each list on the way in', () => {
    expect(medicalHistoryInput({ allergies: [' Latex ', 'latex', ''] }).allergies).toEqual([
      'Latex',
    ])
  })

  it('answers three empty lists for anything it cannot read', () => {
    expect(medicalHistoryInput(undefined)).toEqual({
      allergies: [],
      conditions: [],
      currentMedications: [],
    })
    expect(medicalHistoryInput('Penicillin').allergies).toEqual([])
  })
})

describe('isBlankMedicalHistory', () => {
  it('is true only when all three lists are empty', () => {
    expect(isBlankMedicalHistory(medicalHistoryInput({}))).toBe(true)
    expect(isBlankMedicalHistory(medicalHistoryInput({ conditions: ['Asthma'] }))).toBe(false)
  })

  // Registration skips the write in this case, so "nobody asked" reads
  // differently from "asked, nothing to report".
  it('does not count whitespace as something to record', () => {
    expect(isBlankMedicalHistory(medicalHistoryInput({ allergies: ['   ', ''] }))).toBe(true)
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

describe('allergyClashes', () => {
  const clash = (allergies: string[], name: string, genericName: string | null = null) =>
    allergyClashes(allergies, { name, genericName })

  it('catches the mistake it exists to catch', () => {
    // Amoxicillin to a penicillin-allergic patient.
    const found = clash(['Penicillin'], 'Amoxicillin 500mg')
    expect(found).toHaveLength(1)
    expect(found[0].allergy).toBe('Penicillin')
    expect(found[0].note).toBeUndefined()
  })

  it('catches a brand name as readily as a generic', () => {
    expect(clash(['Penicillin'], 'Augmentin 625')).toHaveLength(1)
    expect(clash(['Aspirin / NSAIDs'], 'Brufen 400')).toHaveLength(1)
  })

  it('matches on the generic when the brand alone would not', () => {
    expect(clash(['Penicillin'], 'Curam', 'co-amoxiclav')).toHaveLength(1)
  })

  it('flags a cephalosporin as a possibility, not a clash', () => {
    const found = clash(['Penicillin'], 'Cefixime 400mg')
    expect(found).toHaveLength(1)
    expect(found[0].note).toBe('possible cross-reaction')
  })

  it('reports an allergy once, not once per pattern that fired', () => {
    expect(clash(['Penicillin', 'penicillin'], 'Amoxicillin')).toHaveLength(1)
  })

  it('reads an allergy written as a sentence', () => {
    expect(clash(['allergic to penicillins'], 'Amoxicillin')).toHaveLength(1)
  })

  it('stays quiet when there is nothing to say', () => {
    expect(clash(['Penicillin'], 'Paracetamol 500mg')).toEqual([])
    expect(clash(['Latex'], 'Amoxicillin')).toEqual([])
    expect(clash([], 'Amoxicillin')).toEqual([])
    expect(clash(['Penicillin'], '')).toEqual([])
  })

  it('does not mistake one drug family for another', () => {
    expect(clash(['Sulfa drugs'], 'Amoxicillin')).toEqual([])
    expect(clash(['Penicillin'], 'Metronidazole')).toEqual([])
    expect(clash(['Aspirin / NSAIDs'], 'Paracetamol')).toEqual([])
  })

  it('covers the other families a dental clinic prescribes from', () => {
    expect(clash(['Local anaesthetic'], 'Lignocaine 2%')).toHaveLength(1)
    expect(clash(['Sulfa drugs'], 'Co-trimoxazole')).toHaveLength(1)
    expect(clash(['Metronidazole'], 'Flagyl 400')).toHaveLength(1)
    expect(clash(['Erythromycin'], 'Azithromycin 500')).toHaveLength(1)
    expect(clash(['Codeine'], 'Tramadol 50mg')).toHaveLength(1)
  })

  it('tolerates missing input rather than throwing', () => {
    expect(allergyClashes(null, { name: 'Amoxicillin' })).toEqual([])
    expect(allergyClashes(undefined, { name: 'Amoxicillin' })).toEqual([])
    expect(allergyClashes(['Penicillin'], { name: null, genericName: null })).toEqual([])
  })
})
