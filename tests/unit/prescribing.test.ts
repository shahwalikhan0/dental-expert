/**
 * The rules a prescription is checked against on both sides (lib/prescribing.ts),
 * and when two catalogue entries are the same drug (lib/medication-catalogue.ts).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import {
  isEmptyLine,
  lineRefusal,
  prescriberName,
  prescriptionAllergyClashes,
  prescriptionLinesRefusal,
} from '@/lib/prescribing'
import { isSameMedication } from '@/lib/medication-catalogue'
import { isInactiveItem, usableTemplateItems } from '@/lib/prescription-templates'

const line = {
  medicationName: 'Amoxil 500mg',
  dosage: '1 capsule',
  frequency: 'TID',
  duration: '5 days',
}

describe('prescriptionLinesRefusal (finding 4)', () => {
  it('accepts complete rows', () => {
    expect(prescriptionLinesRefusal([line])).toBeNull()
  })

  it('refuses no rows at all', () => {
    expect(prescriptionLinesRefusal([])).toMatch(/at least one medication/)
    expect(prescriptionLinesRefusal(undefined)).toMatch(/at least one medication/)
  })

  it('names an empty row by its number', () => {
    expect(prescriptionLinesRefusal([line, { medicationName: '', dosage: '' }])).toMatch(
      /^Medication 2 is empty/
    )
  })

  it('names the row and the missing field', () => {
    expect(prescriptionLinesRefusal([{ ...line, frequency: ' ' }])).toBe(
      'Medication 1 (Amoxil 500mg) needs a frequency.'
    )
    expect(lineRefusal({ ...line, medicationName: '' }, 2)).toBe('Medication 3 needs the medicine.')
  })

  it('refuses a quantity that is not a whole number above zero', () => {
    expect(lineRefusal({ ...line, quantity: 0 }, 0)).toMatch(/quantity/)
    expect(lineRefusal({ ...line, quantity: 'ten' }, 0)).toMatch(/quantity/)
    expect(lineRefusal({ ...line, quantity: 10 }, 0)).toBeNull()
    expect(lineRefusal({ ...line, quantity: null }, 0)).toBeNull()
  })

  it('treats the starter row as empty', () => {
    expect(isEmptyLine({ medicationName: '', dosage: '', route: 'Oral', quantity: '' })).toBe(true)
    expect(isEmptyLine({ medicationName: '', dosage: '1 tab' })).toBe(false)
  })
})

describe('prescriptionAllergyClashes (finding 35)', () => {
  it('matches on the generic name and reports the line', () => {
    const clashes = prescriptionAllergyClashes(
      ['Penicillin'],
      [
        { name: 'Panadol', genericName: 'Paracetamol' },
        { name: 'Amoxil 500mg', genericName: 'Amoxicillin' },
      ]
    )
    expect(clashes).toHaveLength(1)
    expect(clashes[0]).toEqual(expect.objectContaining({ allergy: 'Penicillin', line: 1 }))
  })

  it('finds nothing when no allergies are recorded', () => {
    expect(prescriptionAllergyClashes([], [{ name: 'Amoxicillin' }])).toEqual([])
    expect(prescriptionAllergyClashes(null, [{ name: 'Amoxicillin' }])).toEqual([])
  })
})

describe('prescriberName (finding 66)', () => {
  it('adds the title once', () => {
    expect(prescriberName({ firstName: 'Qasim', lastName: 'Ali' })).toBe('Dr. Qasim Ali')
    expect(prescriberName({ firstName: 'Dr. Qasim', lastName: 'Admin' })).toBe('Dr. Qasim Admin')
    expect(prescriberName({ firstName: 'Dr Qasim', lastName: 'Admin' })).toBe('Dr Qasim Admin')
    expect(prescriberName({ firstName: 'dr.', lastName: 'Qasim' })).toBe('dr. Qasim')
  })

  it('does not mistake a name that starts with "Dr" for the title', () => {
    expect(prescriberName({ firstName: 'Drew', lastName: 'Khan' })).toBe('Dr. Drew Khan')
  })

  it('is empty when there is no prescriber', () => {
    expect(prescriberName(null)).toBe('')
  })
})

describe('isSameMedication (finding 56)', () => {
  const amoxil = { name: 'Amoxil', genericName: 'Amoxicillin', strength: '500mg', form: 'capsule' }

  it('ignores case, spacing and blank-versus-missing', () => {
    expect(
      isSameMedication(amoxil, {
        name: ' AMOXIL ',
        genericName: 'amoxicillin',
        strength: '500MG',
        form: 'Capsule',
      })
    ).toBe(true)
    expect(isSameMedication({ name: 'X', genericName: null }, { name: 'x', genericName: '' })).toBe(
      true
    )
  })

  it('tells strengths and forms apart', () => {
    expect(isSameMedication(amoxil, { ...amoxil, strength: '250mg' })).toBe(false)
    expect(isSameMedication(amoxil, { ...amoxil, form: 'suspension' })).toBe(false)
  })
})

describe('inactive template medicines (finding 48)', () => {
  const items = [
    { medicationName: 'Amoxil', dosage: '1', frequency: 'TID', duration: '5 days' },
    {
      medicationName: 'Retired drug',
      dosage: '1',
      frequency: 'BD',
      duration: '3 days',
      medication: { isActive: false },
    },
  ]

  it('splits what can be prescribed from what cannot', () => {
    const { usable, inactive } = usableTemplateItems(items)
    expect(usable.map((i) => i.medicationName)).toEqual(['Amoxil'])
    expect(inactive).toEqual(['Retired drug'])
    expect(isInactiveItem(items[1])).toBe(true)
    expect(isInactiveItem(items[0])).toBe(false)
  })
})
