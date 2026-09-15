/**
 * The plan catalogue.
 *
 * These numbers used to exist in three places — a constant in api-helpers, a
 * copy on every clinic's own row, and the bullets on the pricing page — and
 * they had drifted. The tests that matter here are the ones that would catch
 * that happening again.
 */
import { describe, it, expect } from 'vitest'
import {
  PLANS,
  PLAN_FEATURES,
  UNLIMITED,
  entitlementsFor,
  isUnlimited,
  planFor,
  planHasFeature,
  planName,
  withinLimit,
} from '@/lib/plans'

describe('the catalogue', () => {
  it('offers the four tiers the pricing page sells', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['FREE', 'PROFESSIONAL', 'ENTERPRISE', 'SELF_HOSTED'])
  })

  it('names a price for every tier that has one', () => {
    for (const plan of PLANS) {
      if (plan.interval === 'CUSTOM') expect(plan.price).toBeNull()
      else expect(typeof plan.price).toBe('number')
    }
  })

  it('caps the free tier and nothing else', () => {
    const free = planFor('FREE').entitlements
    expect(free.patients).toBe(100)
    expect(free.staff).toBe(3)
    expect(free.storageMb).toBe(500)

    for (const id of ['PROFESSIONAL', 'ENTERPRISE', 'SELF_HOSTED'] as const) {
      const e = planFor(id).entitlements
      expect(e.patients, id).toBe(UNLIMITED)
      expect(e.staff, id).toBe(UNLIMITED)
      expect(e.storageMb, id).toBe(UNLIMITED)
    }
  })

  // Each tier should be worth buying over the one below it, and the feature
  // list is how that is expressed. A paid tier with nothing extra is a pricing
  // mistake, not a plan.
  it('gives every paid tier something the free one does not have', () => {
    for (const plan of PLANS.filter((p) => p.id !== 'FREE')) {
      expect(plan.features.length, plan.id).toBeGreaterThan(0)
    }
  })

  it('only claims features the catalogue defines', () => {
    for (const plan of PLANS) {
      for (const feature of plan.features) {
        expect(PLAN_FEATURES, `${plan.id}: ${feature}`).toContain(feature)
      }
    }
  })

  // Several locations under one account is the Enterprise pitch, so it must not
  // quietly appear on a cheaper tier.
  it('sells nothing the database cannot hold', () => {
    // `branches` was a plan feature and a line on the pricing page —
    // "Several locations under one account" — with no location anywhere in
    // the schema. A paid plan promising a feature that does not exist is the
    // one version of this that is not acceptable.
    expect(PLAN_FEATURES).not.toContain('branches')
    for (const plan of PLANS) {
      expect(plan.features).not.toContain('branches')
    }
  })
})

describe('planFor', () => {
  it('finds a plan by its enum value', () => {
    expect(planName('PROFESSIONAL')).toBe('Professional')
  })

  /**
   * Falling back rather than throwing. An unrecognised plan means a tier was
   * removed while live tenants were still on it, and the right answer then is
   * the most restrictive one — not a 500 on every request that clinic makes.
   */
  it('falls back to the free tier for a plan it does not know', () => {
    expect(planFor('LEGACY_GOLD').id).toBe('FREE')
    expect(planFor(null).id).toBe('FREE')
    expect(planFor(undefined).id).toBe('FREE')
  })
})

describe('entitlementsFor', () => {
  it('uses the plan when nothing was negotiated', () => {
    expect(entitlementsFor('FREE')).toEqual({ patients: 100, staff: 3, storageMb: 500 })
    expect(entitlementsFor('FREE', null)).toEqual({ patients: 100, staff: 3, storageMb: 500 })
  })

  it('applies an override where one was agreed', () => {
    expect(entitlementsFor('FREE', { patients: 250 })).toEqual({
      patients: 250,
      staff: 3,
      storageMb: 500,
    })
  })

  /**
   * The whole reason the numbers left the clinic's row. NULL has to mean "ask
   * the plan", not "no limit" and not "zero" — otherwise raising a tier's
   * allowance would leave every tenant already on it stuck where they were.
   */
  it('treats a null override as absent, not as zero', () => {
    expect(entitlementsFor('FREE', { patients: null, staff: undefined })).toEqual({
      patients: 100,
      staff: 3,
      storageMb: 500,
    })
  })

  it('lets an override cut a tenant down as well as raise them', () => {
    expect(entitlementsFor('PROFESSIONAL', { patients: 5000 }).patients).toBe(5000)
  })
})

describe('withinLimit', () => {
  it('lets anything through when unlimited', () => {
    expect(withinLimit(0, UNLIMITED)).toBe(true)
    expect(withinLimit(1_000_000, UNLIMITED)).toBe(true)
    expect(isUnlimited(UNLIMITED)).toBe(true)
  })

  // The boundary is the allowance itself: a clinic entitled to 100 patients
  // may hold 100, and the 101st is the one that is refused.
  it('refuses at the allowance, not one past it', () => {
    expect(withinLimit(99, 100)).toBe(true)
    expect(withinLimit(100, 100)).toBe(false)
    expect(withinLimit(101, 100)).toBe(false)
  })
})
