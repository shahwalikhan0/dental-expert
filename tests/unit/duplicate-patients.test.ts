import { describe, it, expect } from 'vitest'
import {
  birthDay,
  compare,
  editDistance,
  findDuplicates,
  nameSimilarity,
  normaliseCnic,
  normaliseName,
  normalisePhone,
  REPORT_THRESHOLD,
  type Candidate,
} from '@/lib/duplicate-patients'

/**
 * UAT-01 — "detect a likely duplicate".
 *
 * The exact-match blocks in the create route were never the hard part. This
 * covers the case they cannot see: the same person, registering again with a
 * different phone number.
 */

const sana: Candidate = {
  id: 'p1',
  patientId: 'PAT202600001',
  firstName: 'Sana',
  lastName: 'Malik',
  phone: '03211234599',
  email: 'sana@example.com',
  cnic: '3520112345678',
  dateOfBirth: new Date('1992-04-11T00:00:00.000Z'),
}

describe('normalising', () => {
  it('compares names on letters alone', () => {
    expect(normaliseName('Muhammad-Ali')).toBe('muhammad ali')
    expect(normaliseName('  MUHAMMAD   ali ')).toBe('muhammad ali')
  })

  it('compares phone numbers on the last nine digits', () => {
    expect(normalisePhone('0321-1234599')).toBe(normalisePhone('+92 321 1234599'))
    expect(normalisePhone('03211234599')).toBe('211234599')
  })

  it('keeps a short number whole rather than slicing it away', () => {
    expect(normalisePhone('12345')).toBe('12345')
  })

  it('treats a CNIC as its digits', () => {
    expect(normaliseCnic('35201-1234567-8')).toBe('3520112345678')
  })

  it('reads a date of birth as a calendar day', () => {
    expect(birthDay(new Date('1992-04-11T00:00:00.000Z'))).toBe('1992-04-11')
    expect(birthDay('1992-04-11T18:30:00.000Z')).toBe('1992-04-11')
    expect(birthDay(null)).toBe('')
    expect(birthDay(new Date('nonsense'))).toBe('')
  })
})

describe('name similarity', () => {
  it('is 1 for the same name', () => {
    expect(nameSimilarity('Sana Malik', 'sana  malik')).toBe(1)
  })

  it('ignores which half is the family name', () => {
    expect(nameSimilarity('Sana Malik', 'Malik Sana')).toBe(1)
  })

  it('tolerates a typo', () => {
    expect(nameSimilarity('Sanna Malik', 'Sana Malik')).toBeGreaterThan(0.85)
  })

  it('separates two different people', () => {
    expect(nameSimilarity('Bilal Ahmed', 'Sana Malik')).toBeLessThan(0.5)
  })

  it('measures edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('abc', 'abc')).toBe(0)
  })
})

describe('comparing an enquiry with an existing record', () => {
  it('warns on the same name and date of birth with a new phone number', () => {
    const match = compare(
      { firstName: 'Sana', lastName: 'Malik', phone: '03009999999', dateOfBirth: '1992-04-11' },
      sana
    )
    expect(match?.confidence).toBeGreaterThanOrEqual(0.9)
    expect(match?.matchFields).toContain('name')
    expect(match?.matchFields).toContain('date of birth')
  })

  it('is certain when the CNIC matches, whatever the name says', () => {
    const match = compare(
      {
        firstName: 'Totally',
        lastName: 'Different',
        phone: '03008887777',
        cnic: '35201-1234567-8',
      },
      sana
    )
    expect(match?.confidence).toBe(1)
    expect(match?.matchFields).toEqual(['CNIC'])
  })

  it('matches a phone number written a different way', () => {
    const match = compare({ firstName: 'Sana', lastName: 'Malik', phone: '+92 321 1234599' }, sana)
    expect(match?.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('does not warn on a shared name alone', () => {
    // Two unrelated people of the same name is a clinic, not a data problem.
    expect(compare({ firstName: 'Sana', lastName: 'Malik', phone: '03008887777' }, sana)).toBeNull()
  })

  it('does not warn on an unrelated person', () => {
    expect(
      compare(
        { firstName: 'Bilal', lastName: 'Ahmed', phone: '03451112223', dateOfBirth: '1980-01-01' },
        sana
      )
    ).toBeNull()
  })

  it('does not treat two people born on the same day as one', () => {
    expect(
      compare(
        { firstName: 'Bilal', lastName: 'Ahmed', phone: '03451112223', dateOfBirth: '1992-04-11' },
        sana
      )
    ).toBeNull()
  })

  it('never reports below the threshold', () => {
    const match = compare(
      { firstName: 'Sanna', lastName: 'Malik', phone: '03008887777', dateOfBirth: '1992-04-11' },
      sana
    )
    expect(match!.confidence).toBeGreaterThanOrEqual(REPORT_THRESHOLD)
  })
})

describe('findDuplicates', () => {
  const other: Candidate = { ...sana, id: 'p2', patientId: 'PAT202600002', phone: '03211234501' }

  it('puts the strongest match first', () => {
    const found = findDuplicates(
      { firstName: 'Sana', lastName: 'Malik', phone: '03211234501', dateOfBirth: '1992-04-11' },
      [sana, other]
    )
    expect(found[0].patientId).toBe('PAT202600002')
    expect(found[0].confidence).toBeGreaterThanOrEqual(found[1].confidence)
  })

  it('caps the list — a page of maybes is not a warning', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...sana,
      id: `p${i}`,
      patientId: `P${i}`,
    }))
    expect(
      findDuplicates({ firstName: 'Sana', lastName: 'Malik', phone: '03211234599' }, many)
    ).toHaveLength(5)
  })

  it('returns nothing when there is nothing to compare against', () => {
    expect(findDuplicates({ firstName: 'Sana', lastName: 'Malik', phone: '1' }, [])).toEqual([])
  })
})
