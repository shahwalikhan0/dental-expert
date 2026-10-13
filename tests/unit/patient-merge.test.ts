/**
 * Merging two records that turned out to be one person.
 *
 * The rules that matter are all about not losing anything: an allergy on the
 * record being retired is still an allergy, and a blank on the surviving record
 * is worth filling. The decisions are pure functions so that they can be
 * checked without a database.
 */
import { describe, it, expect } from 'vitest'
import {
  fillableFrom,
  mergeMedicalHistory,
  mergeRefusal,
  resolveRecallCollisions,
  type MergeableRecall,
} from '@/lib/patient-merge'

describe('fillableFrom', () => {
  it('fills the surviving record’s blanks', () => {
    const patch = fillableFrom(
      { email: null, city: '', cnic: null },
      { email: 'a@b.pk', city: 'Lahore', cnic: '3520212345671' }
    )
    expect(patch).toEqual({ email: 'a@b.pk', city: 'Lahore', cnic: '3520212345671' })
  })

  it('never overwrites a value somebody has already confirmed', () => {
    const patch = fillableFrom(
      { email: 'kept@clinic.pk', city: 'Karachi' },
      { email: 'other@clinic.pk', city: 'Lahore' }
    )
    expect(patch).toEqual({})
  })

  it('ignores fields that are blank on both', () => {
    expect(fillableFrom({ email: null }, { email: null })).toEqual({})
    expect(fillableFrom({ email: '' }, { email: '' })).toEqual({})
  })

  it('does not touch fields outside the list it is allowed to fill', () => {
    const patch = fillableFrom({ firstName: '', phone: '' }, { firstName: 'Ali', phone: '0300' })
    expect(patch).toEqual({})
  })
})

describe('mergeMedicalHistory', () => {
  it('keeps an allergy that only one of the two records knew about', () => {
    const merged = mergeMedicalHistory({ allergies: ['Penicillin'] }, { allergies: ['Latex'] })
    expect(merged.allergies).toEqual(['Penicillin', 'Latex'])
  })

  it('does not record the same thing twice because it was spelled differently', () => {
    const merged = mergeMedicalHistory(
      { allergies: ['Penicillin'] },
      { allergies: ['penicillin', ' Latex '] }
    )
    expect(merged.allergies).toEqual(['Penicillin', 'Latex'])
  })

  it('unions conditions and current medications too', () => {
    const merged = mergeMedicalHistory(
      { conditions: ['Diabetes'], currentMedications: ['Metformin'] },
      { conditions: ['Hypertension'], currentMedications: ['Amlodipine'] }
    )
    expect(merged.conditions).toEqual(['Diabetes', 'Hypertension'])
    expect(merged.currentMedications).toEqual(['Metformin', 'Amlodipine'])
  })

  it('errs towards pregnancy if either record says so', () => {
    expect(mergeMedicalHistory({ isPregnant: false }, { isPregnant: true }).isPregnant).toBe(true)
    expect(mergeMedicalHistory({ isPregnant: true }, { isPregnant: false }).isPregnant).toBe(true)
    expect(mergeMedicalHistory({ isPregnant: false }, { isPregnant: false }).isPregnant).toBe(false)
  })

  it('copes with either side having no history at all', () => {
    expect(mergeMedicalHistory(null, { allergies: ['Latex'] }).allergies).toEqual(['Latex'])
    expect(mergeMedicalHistory({ allergies: ['Latex'] }, null).allergies).toEqual(['Latex'])
    expect(mergeMedicalHistory(null, null).allergies).toEqual([])
  })
})

describe('mergeRefusal', () => {
  const patient = (
    over: Partial<{ id: string; hospitalId: string; mergedIntoId: string | null }>
  ) => ({
    id: 'a',
    hospitalId: 'h1',
    mergedIntoId: null,
    ...over,
  })

  it('allows an ordinary merge', () => {
    expect(mergeRefusal(patient({ id: 'a' }), patient({ id: 'b' }))).toBeNull()
  })

  it('refuses to merge a record into itself', () => {
    expect(mergeRefusal(patient({ id: 'a' }), patient({ id: 'a' }))).toMatch(/into itself/)
  })

  it('refuses across clinics', () => {
    expect(mergeRefusal(patient({ id: 'a' }), patient({ id: 'b', hospitalId: 'h2' }))).toMatch(
      /different clinics/
    )
  })

  it('refuses a record that has already been merged away', () => {
    expect(mergeRefusal(patient({ id: 'a' }), patient({ id: 'b', mergedIntoId: 'c' }))).toMatch(
      /already been merged/
    )
  })

  it('refuses to merge into a record that is itself a duplicate', () => {
    expect(mergeRefusal(patient({ id: 'a', mergedIntoId: 'c' }), patient({ id: 'b' }))).toMatch(
      /merged into another/
    )
  })

  it('says so when a record is missing', () => {
    expect(mergeRefusal(null, patient({ id: 'b' }))).toMatch(/could not be found/)
    expect(mergeRefusal(patient({ id: 'a' }), null)).toMatch(/could not be found/)
  })
})

describe('resolveRecallCollisions', () => {
  const recall = (overrides: Partial<MergeableRecall>): MergeableRecall => ({
    id: 'r',
    recareTypeId: 'scale',
    dueDate: new Date('2027-01-01'),
    lastDoneAt: null,
    snoozedUntil: null,
    snoozeReason: null,
    status: 'ACTIVE',
    notes: null,
    lastContactedAt: null,
    contactAttempts: 0,
    ...overrides,
  })

  // Bug report 12 Oct, finding 23: both records had the default recall from
  // registration, the merge moved the retired one across, and the unique
  // (patientId, recareTypeId) index refused it — every merge failed.
  it('drops the retired record’s recall of a kind the surviving one already has', () => {
    const result = resolveRecallCollisions(
      [recall({ id: 'keep-scale' })],
      [recall({ id: 'retire-scale' }), recall({ id: 'retire-child', recareTypeId: 'child' })]
    )
    expect(result.drop).toEqual(['retire-scale'])
    expect(result.update).toEqual([])
  })

  it('takes the retired recall’s schedule when it was done more recently', () => {
    const result = resolveRecallCollisions(
      [recall({ id: 'keep', lastDoneAt: new Date('2026-01-10'), dueDate: new Date('2026-07-10') })],
      [
        recall({
          id: 'retire',
          lastDoneAt: new Date('2026-09-01'),
          dueDate: new Date('2027-03-01'),
        }),
      ]
    )
    expect(result.drop).toEqual(['retire'])
    expect(result.update).toEqual([
      {
        id: 'keep',
        data: expect.objectContaining({
          lastDoneAt: new Date('2026-09-01'),
          dueDate: new Date('2027-03-01'),
        }),
      },
    ])
  })

  it('keeps the surviving recall’s schedule when it is the more recent', () => {
    const result = resolveRecallCollisions(
      [recall({ id: 'keep', lastDoneAt: new Date('2026-09-01') })],
      [recall({ id: 'retire', lastDoneAt: new Date('2026-01-10') })]
    )
    expect(result.update).toEqual([])
  })

  it('adds up the contact history, so nobody is rung as if for the first time', () => {
    const result = resolveRecallCollisions(
      [recall({ id: 'keep', contactAttempts: 1, lastContactedAt: new Date('2026-08-01') })],
      [recall({ id: 'retire', contactAttempts: 2, lastContactedAt: new Date('2026-09-01') })]
    )
    expect(result.update[0].data).toEqual({
      contactAttempts: 3,
      lastContactedAt: new Date('2026-09-01'),
    })
  })
})
