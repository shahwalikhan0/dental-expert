/**
 * Which set of teeth a mouth opens on.
 *
 * The tooth picker on the treatment and prescription forms, and the patient's
 * dental chart, both draw one dentition at a time (bug report 12 Oct, finding
 * 55). Opening on the wrong one is not an error anybody sees — it is a child's
 * 75 that the dentist has to know to switch views to find — so the rule is
 * pinned here.
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_PRIMARY_TEETH,
  ALL_TEETH,
  PRIMARY_DENTITION_AGE,
  defaultDentition,
  dentitionOf,
  formatTeeth,
  parseTeeth,
  readTeeth,
} from '@/lib/teeth'

describe('dentitionOf()', () => {
  it('puts every permanent tooth in the permanent dentition', () => {
    for (const tooth of ALL_TEETH) expect(dentitionOf(tooth)).toBe('permanent')
  })

  it('puts every primary tooth in the primary dentition', () => {
    for (const tooth of ALL_PRIMARY_TEETH) expect(dentitionOf(tooth)).toBe('primary')
  })

  it('is null for a number that is not a tooth', () => {
    for (const n of [0, 10, 19, 49, 50, 56, 60, 86, 99, 7.5]) expect(dentitionOf(n)).toBeNull()
  })
})

describe('defaultDentition()', () => {
  it('is permanent when there is nothing to go on', () => {
    expect(defaultDentition({})).toBe('permanent')
    expect(defaultDentition({ selected: [], age: null, findings: [] })).toBe('permanent')
  })

  it('opens on the primary teeth when everything selected is primary', () => {
    // Fatima, eleven, being treated on 75 — the case in the report.
    expect(defaultDentition({ selected: [75] })).toBe('primary')
    expect(defaultDentition({ selected: [54, 55, 64] })).toBe('primary')
  })

  it('lets a selection outrank the age', () => {
    // A prescription written from a treatment opens on that treatment's teeth.
    expect(defaultDentition({ selected: [75], age: 30 })).toBe('primary')
    expect(defaultDentition({ selected: [36], age: 8 })).toBe('permanent')
  })

  it('opens a child on the primary teeth', () => {
    expect(defaultDentition({ age: 4 })).toBe('primary')
    expect(defaultDentition({ age: PRIMARY_DENTITION_AGE - 1 })).toBe('primary')
  })

  it('opens anybody of the threshold age or older on the permanent teeth', () => {
    expect(defaultDentition({ age: PRIMARY_DENTITION_AGE })).toBe('permanent')
    expect(defaultDentition({ age: 45 })).toBe('permanent')
  })

  it('treats newborns as children, not as an unknown age', () => {
    expect(defaultDentition({ age: 0 })).toBe('primary')
  })

  it('lets the age decide a mixed selection', () => {
    expect(defaultDentition({ selected: [36, 75], age: 9 })).toBe('primary')
    expect(defaultDentition({ selected: [36, 75], age: 14 })).toBe('permanent')
    expect(defaultDentition({ selected: [36, 75] })).toBe('permanent')
  })

  it('ignores numbers in the selection that are not teeth', () => {
    expect(defaultDentition({ selected: [75, 99] })).toBe('primary')
    expect(defaultDentition({ selected: [99], age: 6 })).toBe('primary')
  })

  it('without an age, opens on the primary teeth when every finding is on one', () => {
    expect(defaultDentition({ findings: [74, 75] })).toBe('primary')
    expect(defaultDentition({ findings: [74, 46] })).toBe('permanent')
  })

  it('lets a known adult age outrank a chart of retained primary teeth', () => {
    // An adult's one retained 53 should not hide the other twenty-eight teeth.
    expect(defaultDentition({ findings: [53], age: 35 })).toBe('permanent')
  })
})

describe('primary teeth on the way to a column', () => {
  it('survives the round trip the forms make', () => {
    const picked = [75, 36, 51]
    const column = formatTeeth(picked)
    expect(column).toBe('36,51,75')
    expect(parseTeeth(column)).toEqual([36, 51, 75])
    expect(readTeeth(column)).toEqual({ ok: true, column: '36,51,75', teeth: [36, 51, 75] })
  })

  it('is accepted the way the treatment form sends it', () => {
    // The treatment form joins the picker's array itself.
    expect(readTeeth([85, 81].join(','))).toEqual({ ok: true, column: '81,85', teeth: [81, 85] })
  })
})
