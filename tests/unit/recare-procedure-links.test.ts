import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import {
  DEFAULT_RECARE_TYPES,
  checkRecareProcedureIds,
  defaultProcedureLinks,
  parseProcedureIds,
  recaresForProcedureWhere,
} from '@/lib/recare'

/**
 * Which procedures move which recalls (bug report 12 Oct, finding 46).
 *
 * Completing Fatima's scaling left her "Scale and polish" recall due on the
 * old date. The link is now stored on the recall type and chosen by the
 * clinic; completion reads that link and nothing else, and the defaults a new
 * clinic starts with are linked to the procedures that are their visit.
 */

describe('recaresForProcedureWhere', () => {
  it('finds the patient’s recalls whose type is linked to the procedure', () => {
    expect(
      recaresForProcedureWhere({ hospitalId: 'h1', patientId: 'p1', procedureId: 'scaling' })
    ).toEqual({
      hospitalId: 'h1',
      patientId: 'p1',
      recareType: { hospitalId: 'h1', procedures: { some: { id: 'scaling' } } },
    })
  })

  // Mark as done, or a recall named by the caller, has already moved it; the
  // same visit must not move it twice.
  it('leaves out recalls the caller has already moved', () => {
    expect(
      recaresForProcedureWhere({
        hospitalId: 'h1',
        patientId: 'p1',
        procedureId: 'scaling',
        except: ['r1'],
      })
    ).toMatchObject({ id: { notIn: ['r1'] } })
  })

  it('does not filter by id when nothing has been moved yet', () => {
    expect(
      recaresForProcedureWhere({ hospitalId: 'h1', patientId: 'p1', procedureId: 'x', except: [] })
    ).not.toHaveProperty('id')
  })
})

describe('parseProcedureIds', () => {
  it('accepts a list of ids, trimmed', () => {
    expect(parseProcedureIds([' a ', 'b'])).toEqual(['a', 'b'])
    expect(parseProcedureIds([])).toEqual([])
  })

  it('refuses anything that is not a list of ids', () => {
    expect(() => parseProcedureIds('a')).toThrow(ZodError)
    expect(() => parseProcedureIds([1, 2])).toThrow(ZodError)
    expect(() => parseProcedureIds([''])).toThrow(ZodError)
    expect(() => parseProcedureIds(null)).toThrow(ZodError)
  })
})

describe('checkRecareProcedureIds', () => {
  const scaling = { id: 'scaling', name: 'Dental Cleaning (Scaling)', isActive: true }
  const polish = { id: 'polish', name: 'Polishing', isActive: false }

  it('accepts this clinic’s active procedures, once each', () => {
    expect(checkRecareProcedureIds(['scaling', 'scaling'], [scaling])).toEqual({
      ok: true,
      ids: ['scaling'],
    })
  })

  it('accepts an empty list — the clinic can unlink everything', () => {
    expect(checkRecareProcedureIds([], [])).toEqual({ ok: true, ids: [] })
  })

  // `found` is only this clinic's procedures, so another clinic's id is
  // missing from it.
  it('refuses a procedure that is not in this clinic’s catalogue', () => {
    const result = checkRecareProcedureIds(['scaling', 'other-clinic'], [scaling])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('not in this clinic')
  })

  it('refuses newly linking an inactive procedure, by name', () => {
    const result = checkRecareProcedureIds(['scaling', 'polish'], [scaling, polish])
    expect(result).toEqual({
      ok: false,
      error: 'Polishing is inactive and cannot be linked to a recall',
    })
  })

  it('keeps an inactive procedure that was already linked', () => {
    expect(checkRecareProcedureIds(['scaling', 'polish'], [scaling, polish], ['polish'])).toEqual({
      ok: true,
      ids: ['scaling', 'polish'],
    })
  })
})

describe('defaultProcedureLinks', () => {
  const types = [
    { id: 't-hyg', name: 'Scale and polish' },
    { id: 't-child', name: 'Child check-up' },
    { id: 't-perio', name: 'Periodontal maintenance' },
    { id: 't-own', name: 'Ortho review' },
  ]
  const procedures = [
    { id: 'consult', name: 'Consultation', category: 'DIAGNOSTIC', isActive: true },
    {
      id: 'exam',
      name: 'Comprehensive Oral Examination',
      category: 'DIAGNOSTIC',
      isActive: true,
    },
    { id: 'scaling', name: 'Dental Cleaning (Scaling)', category: 'PREVENTIVE', isActive: true },
    {
      id: 'srp',
      name: 'Deep Cleaning (Scaling & Root Planing)',
      category: 'PREVENTIVE',
      isActive: true,
    },
    { id: 'perio', name: 'Periodontal Scaling', category: 'PERIODONTIC', isActive: true },
    { id: 'filling', name: 'Composite Filling', category: 'RESTORATIVE', isActive: true },
    { id: 'old', name: 'Prophylaxis (old)', category: 'PREVENTIVE', isActive: false },
  ]

  const linksFor = (typeId: string) =>
    defaultProcedureLinks(types, procedures).find((link) => link.recareTypeId === typeId)
      ?.procedureIds

  it('links scale and polish to the scalings and cleanings', () => {
    expect(linksFor('t-hyg')).toEqual(['scaling', 'srp', 'perio'])
  })

  it('links the check-up to the examination, not the consultation', () => {
    expect(linksFor('t-child')).toEqual(['exam'])
  })

  // A routine scale and polish is not periodontal care.
  it('links periodontal maintenance to periodontal care only', () => {
    expect(linksFor('t-perio')).toEqual(['srp', 'perio'])
  })

  it('never links a filling, an inactive procedure, or a type the clinic made', () => {
    const all = defaultProcedureLinks(types, procedures)
    expect(all.flatMap((link) => link.procedureIds)).not.toContain('filling')
    expect(all.flatMap((link) => link.procedureIds)).not.toContain('old')
    expect(linksFor('t-own')).toBeUndefined()
  })

  it('matches a default type by its name, whatever the case', () => {
    expect(
      defaultProcedureLinks([{ id: 't', name: ' scale AND polish ' }], procedures)[0]?.procedureIds
    ).toEqual(['scaling', 'srp', 'perio'])
  })

  it('considers only the procedures it is given — a procedure just added', () => {
    expect(defaultProcedureLinks(types, [procedures[2]])).toEqual([
      { recareTypeId: 't-hyg', procedureIds: ['scaling'] },
    ])
  })

  it('has a rule for every default recall type', () => {
    for (const type of DEFAULT_RECARE_TYPES) {
      expect(type.satisfiedBy.categories.length).toBeGreaterThan(0)
    }
  })
})
