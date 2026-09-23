/**
 * Templates, and the one rule that makes them safe.
 *
 * Issuing copies. If a prescription read its dosages through `templateId`,
 * editing a template would rewrite what was prescribed to every patient who
 * ever received it. These tests are mostly about the copy being a copy and
 * about the append not eating somebody's typing.
 */
import { describe, it, expect } from 'vitest'
import {
  appendTemplateLines,
  isBlankLine,
  linesFromTemplate,
  templateRefusal,
  type PrescriptionLine,
} from '@/lib/prescription-templates'

const line = (over: Partial<PrescriptionLine> = {}): PrescriptionLine => ({
  medicationId: null,
  medicationName: 'Ibuprofen 400mg',
  dosage: '1 tablet',
  frequency: 'Three times a day',
  duration: '3 days',
  route: 'Oral',
  timing: 'After food',
  quantity: '9',
  instructions: '',
  ...over,
})

describe('linesFromTemplate', () => {
  it('copies every field rather than referencing the template', () => {
    const items = [
      {
        medicationId: 'med_1',
        medicationName: 'Amoxicillin 500mg',
        dosage: '1 capsule',
        frequency: 'Three times a day',
        duration: '5 days',
        route: 'Oral',
        timing: 'After food',
        quantity: 15,
        instructions: 'Finish the course',
        medication: { genericName: 'amoxicillin' },
      },
    ]
    expect(linesFromTemplate(items)).toEqual([
      {
        medicationId: 'med_1',
        medicationName: 'Amoxicillin 500mg',
        genericName: 'amoxicillin',
        dosage: '1 capsule',
        frequency: 'Three times a day',
        duration: '5 days',
        route: 'Oral',
        timing: 'After food',
        quantity: '15',
        instructions: 'Finish the course',
      },
    ])
  })

  it('mutating the copy cannot reach the template', () => {
    const items = [
      {
        medicationName: 'Amoxicillin 500mg',
        dosage: '1 capsule',
        frequency: 'TDS',
        duration: '5 days',
      },
    ]
    const copied = linesFromTemplate(items)
    copied[0].dosage = '2 capsules'
    expect(items[0].dosage).toBe('1 capsule')
  })

  it('fills the defaults a template may not carry', () => {
    const [copied] = linesFromTemplate([
      {
        medicationName: 'Chlorhexidine',
        dosage: '10ml',
        frequency: 'Twice a day',
        duration: '7 days',
      },
    ])
    expect(copied.route).toBe('Oral')
    expect(copied.timing).toBe('')
    // An unspecified quantity is an empty box, not a zero.
    expect(copied.quantity).toBe('')
  })
})

describe('appendTemplateLines', () => {
  it('adds to what is already typed rather than replacing it', () => {
    const existing = [line({ medicationName: 'Paracetamol 500mg' })]
    const result = appendTemplateLines(existing, [line({ medicationName: 'Amoxicillin 500mg' })])

    expect(result.lines.map((l) => l.medicationName)).toEqual([
      'Paracetamol 500mg',
      'Amoxicillin 500mg',
    ])
    expect(result.added).toBe(1)
  })

  it('drops the blank starter row a new form opens with', () => {
    const blank = line({
      medicationName: '',
      dosage: '',
      frequency: '',
      duration: '',
      instructions: '',
    })
    const result = appendTemplateLines([blank], [line({ medicationName: 'Amoxicillin 500mg' })])
    expect(result.lines).toHaveLength(1)
  })

  it('adds a medicine that is already there, and names it', () => {
    // Refusing would be wrong: the same drug at two strengths is a real
    // prescription. Adding it silently is how somebody dispenses twice.
    const existing = [line({ medicationName: 'Amoxicillin 500mg' })]
    const result = appendTemplateLines(existing, [line({ medicationName: 'amoxicillin 500MG' })])

    expect(result.lines).toHaveLength(2)
    expect(result.duplicates).toEqual(['amoxicillin 500MG'])
  })

  it('names a duplicate once however many times it appears', () => {
    const existing = [line({ medicationName: 'Ibuprofen 400mg' })]
    const result = appendTemplateLines(existing, [
      line({ medicationName: 'Ibuprofen 400mg' }),
      line({ medicationName: 'Ibuprofen 400mg' }),
    ])
    expect(result.duplicates).toEqual(['Ibuprofen 400mg'])
  })

  it('reports nothing to warn about when there is no overlap', () => {
    const result = appendTemplateLines(
      [line({ medicationName: 'Paracetamol 500mg' })],
      [line({ medicationName: 'Amoxicillin 500mg' })]
    )
    expect(result.duplicates).toEqual([])
  })
})

describe('isBlankLine', () => {
  it('is not fooled by the route, which every row has by default', () => {
    expect(isBlankLine({ route: 'Oral', medicationName: '', dosage: '' })).toBe(true)
    expect(isBlankLine({ route: 'Oral', medicationName: 'Amoxicillin' })).toBe(false)
  })
})

describe('templateRefusal', () => {
  it('wants a name', () => {
    expect(templateRefusal({ name: '  ', items: [line()] })).toMatch(/name/i)
  })

  it('wants at least one medicine', () => {
    expect(templateRefusal({ name: 'Post-extraction', items: [] })).toMatch(/at least one/i)
  })

  it('does not count blank rows as medicines', () => {
    const blank = { medicationName: '', dosage: '', frequency: '', duration: '' }
    expect(templateRefusal({ name: 'Post-extraction', items: [blank] })).toMatch(/at least one/i)
  })

  it('wants a dosage and a frequency, naming the line that lacks them', () => {
    const refusal = templateRefusal({
      name: 'Post-extraction',
      items: [line({ medicationName: 'Amoxicillin 500mg', dosage: '' })],
    })
    expect(refusal).toContain('Amoxicillin 500mg')
  })

  it('accepts a template with no duration — some medicines are taken as needed', () => {
    expect(templateRefusal({ name: 'PRN analgesia', items: [line({ duration: '' })] })).toBeNull()
  })
})
