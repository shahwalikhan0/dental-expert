/**
 * The change detection behind FR-007.
 *
 * Getting this wrong in either direction is bad: miss a change and a signed
 * note is silently overwritten, which is the thing the requirement exists to
 * stop; invent one and every routine save demands an amendment reason, and
 * people learn to type "fix" into it.
 */
import { describe, it, expect } from 'vitest'
import {
  CLINICAL_NOTE_FIELDS,
  NON_CLINICAL_FIELDS,
  diffClinicalFields,
  isSigned,
  isUsableReason,
  MIN_REASON_LENGTH,
} from '@/lib/clinical-notes'

const NOTE = {
  toothNumbers: '26',
  chiefComplaint: 'Pain on chewing',
  diagnosis: 'Irreversible pulpitis',
  findings: 'Deep caries, distal',
  procedureNotes: 'Access cavity prepared',
  materialsUsed: 'Gutta-percha',
  complications: null,
  followUpRequired: true,
  followUpDate: new Date('2026-10-01T00:00:00.000Z'),
  followUpNotes: null,
  cost: 15000,
  status: 'COMPLETED',
}

describe('isSigned', () => {
  it('is signed only once there is a signature', () => {
    expect(isSigned({ signedAt: new Date() })).toBe(true)
    expect(isSigned({ signedAt: null })).toBe(false)
    expect(isSigned({})).toBe(false)
  })

  // COMPLETED is a workflow status, not an attestation — that distinction is
  // the reason this requirement was outstanding.
  it('does not treat a completed treatment as signed', () => {
    expect(isSigned({ status: 'COMPLETED', signedAt: null })).toBe(false)
  })
})

describe('diffClinicalFields', () => {
  it('finds a changed clinical field and keeps both values', () => {
    const changes = diffClinicalFields(NOTE, { toothNumbers: '27' })
    expect(changes).toEqual({ toothNumbers: { from: '26', to: '27' } })
  })

  it('finds several at once', () => {
    const changes = diffClinicalFields(NOTE, {
      diagnosis: 'Necrotic pulp',
      findings: 'Deep caries, mesial',
    })
    expect(Object.keys(changes).sort()).toEqual(['diagnosis', 'findings'])
  })

  // Resubmitting a form unchanged must not manufacture an amendment.
  it('ignores a field resubmitted with the same value', () => {
    expect(diffClinicalFields(NOTE, { toothNumbers: '26', diagnosis: NOTE.diagnosis })).toEqual({})
  })

  it('ignores fields the request does not mention', () => {
    expect(diffClinicalFields(NOTE, {})).toEqual({})
  })

  // Billing and workflow are not the clinical record: correcting a price on a
  // signed note has not changed what was recorded about the patient.
  it('does not count cost or status as a clinical amendment', () => {
    expect(diffClinicalFields(NOTE, { cost: 18000, status: 'CANCELLED' })).toEqual({})
    expect(NON_CLINICAL_FIELDS).toEqual(['cost', 'status'])
  })

  // null and '' both mean "not recorded" in these columns.
  it('treats null and empty string as the same absence', () => {
    expect(diffClinicalFields(NOTE, { complications: '' })).toEqual({})
    expect(diffClinicalFields({ ...NOTE, complications: '' }, { complications: null })).toEqual({})
  })

  it('catches text being added where there was none', () => {
    const changes = diffClinicalFields(NOTE, { complications: 'Slight bleeding' })
    expect(changes.complications).toEqual({ from: null, to: 'Slight bleeding' })
  })

  it('catches text being removed', () => {
    const changes = diffClinicalFields(NOTE, { diagnosis: '' })
    expect(changes.diagnosis.from).toBe('Irreversible pulpitis')
  })

  // Dates arrive as ISO strings from the request and as Date from the
  // database. Comparing them raw would flag an amendment on every save.
  it('compares a date string against a stored Date by instant', () => {
    expect(diffClinicalFields(NOTE, { followUpDate: '2026-10-01T00:00:00.000Z' })).toEqual({})
    expect(Object.keys(diffClinicalFields(NOTE, { followUpDate: '2026-11-01' }))).toEqual([
      'followUpDate',
    ])
  })

  it('compares booleans by value, not by identity', () => {
    expect(diffClinicalFields(NOTE, { followUpRequired: true })).toEqual({})
    expect(Object.keys(diffClinicalFields(NOTE, { followUpRequired: false }))).toEqual([
      'followUpRequired',
    ])
  })

  it('covers every field the note records clinically', () => {
    expect(CLINICAL_NOTE_FIELDS).toContain('diagnosis')
    expect(CLINICAL_NOTE_FIELDS).toContain('findings')
    expect(CLINICAL_NOTE_FIELDS).toContain('procedureNotes')
    expect(CLINICAL_NOTE_FIELDS).not.toContain('cost')
  })
})

describe('isUsableReason', () => {
  // "fix" and "." are what get typed when a field is merely required.
  it('rejects the reasons people type to get past a required field', () => {
    expect(isUsableReason('fix')).toBe(false)
    expect(isUsableReason('typo')).toBe(false)
    expect(isUsableReason('.')).toBe(false)
    expect(isUsableReason('   ')).toBe(false)
  })

  it('rejects a missing reason', () => {
    expect(isUsableReason(undefined)).toBe(false)
    expect(isUsableReason(null)).toBe(false)
    expect(isUsableReason(42)).toBe(false)
  })

  it('accepts one that says what was wrong', () => {
    expect(isUsableReason('Tooth number recorded as 26, work was on 27')).toBe(true)
  })

  it('measures the trimmed length', () => {
    expect(isUsableReason(' '.repeat(20) + 'fix')).toBe(false)
    expect(isUsableReason('x'.repeat(MIN_REASON_LENGTH))).toBe(true)
  })
})
