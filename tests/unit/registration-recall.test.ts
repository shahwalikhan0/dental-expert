/**
 * Bug report 12 Oct, finding 61: every new patient was put on the adult
 * hygiene recall, children included.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CHILD_RECALL_UNDER_AGE,
  isChildForRecall,
  startRegistrationRecare,
} from '@/lib/registration-recall'

const NOW = new Date('2026-10-12T09:00:00Z')

function fakeDb(types: { child?: object | null; adult?: object | null }) {
  return {
    recareType: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.isDefault ? (types.adult ?? null) : (types.child ?? null)
      ),
    },
    recare: { upsert: vi.fn() },
  } as any
}

describe('isChildForRecall', () => {
  it('treats an eleven-year-old as a child', () => {
    expect(isChildForRecall('2015-03-01', NOW)).toBe(true)
  })

  it(`treats ${CHILD_RECALL_UNDER_AGE} and over as an adult`, () => {
    expect(isChildForRecall('2013-01-01', NOW)).toBe(false)
  })

  it('treats an unknown age as an adult', () => {
    expect(isChildForRecall(null, NOW)).toBe(false)
  })
})

describe('startRegistrationRecare', () => {
  it('puts a child on the child check-up when the clinic has one', async () => {
    const db = fakeDb({
      child: { id: 'child', intervalMonths: 6 },
      adult: { id: 'scale', intervalMonths: 6 },
    })
    await startRegistrationRecare(db, 'h1', 'p1', '2015-03-01', NOW)

    expect(db.recare.upsert).toHaveBeenCalledTimes(1)
    expect(db.recare.upsert.mock.calls[0][0].create.recareTypeId).toBe('child')
  })

  it('falls back to the default for a child when there is no child type', async () => {
    const db = fakeDb({ child: null, adult: { id: 'scale', intervalMonths: 6 } })
    await startRegistrationRecare(db, 'h1', 'p1', '2015-03-01', NOW)

    expect(db.recare.upsert.mock.calls[0][0].create.recareTypeId).toBe('scale')
  })

  it('gives an adult, or a patient with no date of birth, the default', async () => {
    for (const dob of ['1985-06-01', null]) {
      const db = fakeDb({
        child: { id: 'child', intervalMonths: 6 },
        adult: { id: 'scale', intervalMonths: 6 },
      })
      await startRegistrationRecare(db, 'h1', 'p1', dob, NOW)
      expect(db.recare.upsert.mock.calls[0][0].create.recareTypeId).toBe('scale')
    }
  })
})
