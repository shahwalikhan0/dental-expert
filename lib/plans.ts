/**
 * The plan catalogue — what a tenant gets for what they pay.
 *
 * This product is sold to many clinics, so "which plan is this clinic on" is a
 * question the code asks constantly. Before this file the answer lived in three
 * places that could disagree:
 *
 *   1. `PLAN_LIMITS` in lib/api-helpers.ts, consulted at signup;
 *   2. `patientLimit` / `staffLimit` / `storageLimitMb` **copied onto every
 *      Hospital row**, consulted at every write;
 *   3. the feature bullets hardcoded in app/(auth)/pricing/page.tsx, shown to
 *      the person deciding whether to buy.
 *
 * Copy (2) is the dangerous one. Raising the free tier from 100 patients to 250
 * changed the constant and the marketing page, and left every clinic that had
 * already signed up capped at 100 for ever — with nothing anywhere to say why.
 * Entitlements are now *derived from the plan*, so changing the plan changes
 * what every tenant on it gets, immediately and everywhere.
 *
 * A negotiated exception is still possible, but it has to be written down as
 * one: `Subscription.patientLimitOverride` and friends are NULL for everybody
 * except the tenants somebody deliberately agreed something else with.
 */
import type { Plan } from '@prisma/client'

/** An entitlement of -1 is unlimited, matching the convention in the database. */
export const UNLIMITED = -1

export type Entitlements = {
  /** Maximum patient records. */
  patients: number
  /** Maximum active staff accounts. */
  staff: number
  /** Maximum uploaded-file storage, in megabytes. */
  storageMb: number
}

/**
 * Capabilities a plan may or may not include.
 *
 * Deliberately coarse. These gate whole modules, not individual buttons — what
 * a *user* may do is `lib/rbac.ts`, and the two are different questions: RBAC
 * asks "is this person allowed", a plan asks "has this clinic bought it".
 */
export const PLAN_FEATURES = [
  'branches', // more than one location under one tenant
  'labModule', // §5.8 dental laboratory coordination
  'bulkCommunications', // campaign sends, as opposed to one-off reminders
  'dataImport', // ERP migration tooling
  'apiAccess', // outward integrations
  'prioritySupport',
] as const

export type PlanFeature = (typeof PLAN_FEATURES)[number]

export type BillingInterval = 'MONTHLY' | 'ONE_TIME' | 'CUSTOM'

export interface PlanDefinition {
  id: Plan
  name: string
  blurb: string
  /**
   * Price in whole rupees, or null when there is no list price.
   *
   * Currency is the *platform's*, not the tenant's: a clinic may bill its own
   * patients in any currency it likes, but it pays us in ours.
   */
  price: number | null
  interval: BillingInterval
  entitlements: Entitlements
  features: readonly PlanFeature[]
  /** Days of full access before the first payment is due. 0 = none. */
  trialDays: number
}

export const PLATFORM_BILLING_CURRENCY = 'PKR'

/**
 * Ordered cheapest first — the pricing page and the upgrade picker both render
 * them in this order, so the order is part of the definition rather than
 * something each screen re-sorts.
 */
export const PLANS: readonly PlanDefinition[] = [
  {
    id: 'FREE',
    name: 'Free',
    blurb: 'For a single practitioner finding their feet.',
    price: 0,
    interval: 'MONTHLY',
    entitlements: { patients: 100, staff: 3, storageMb: 500 },
    features: [],
    trialDays: 0,
  },
  {
    id: 'PROFESSIONAL',
    name: 'Professional',
    blurb: 'For an established clinic running its whole day on the system.',
    price: 2999,
    interval: 'MONTHLY',
    entitlements: { patients: UNLIMITED, staff: UNLIMITED, storageMb: UNLIMITED },
    features: ['labModule', 'bulkCommunications', 'dataImport'],
    trialDays: 14,
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    blurb: 'For a group practice with several locations.',
    price: null,
    interval: 'CUSTOM',
    entitlements: { patients: UNLIMITED, staff: UNLIMITED, storageMb: UNLIMITED },
    features: [
      'branches',
      'labModule',
      'bulkCommunications',
      'dataImport',
      'apiAccess',
      'prioritySupport',
    ],
    trialDays: 14,
  },
  {
    id: 'SELF_HOSTED',
    name: 'Self-Hosted',
    blurb: 'Your own server, your own database, a perpetual licence.',
    price: 49999,
    interval: 'ONE_TIME',
    entitlements: { patients: UNLIMITED, staff: UNLIMITED, storageMb: UNLIMITED },
    features: ['labModule', 'bulkCommunications', 'dataImport', 'apiAccess'],
    trialDays: 0,
  },
]

const BY_ID = new Map<string, PlanDefinition>(PLANS.map((p) => [p.id, p]))

/**
 * The plan a tenant is on.
 *
 * Falls back to Free rather than throwing: an unrecognised plan means somebody
 * removed a tier that live tenants were still on, and the right behaviour then
 * is the most restrictive one, not a 500 on every request.
 */
export function planFor(plan: Plan | string | null | undefined): PlanDefinition {
  return BY_ID.get(String(plan)) ?? PLANS[0]
}

export function planName(plan: Plan | string | null | undefined): string {
  return planFor(plan).name
}

/** Whether a plan includes a feature. */
export function planHasFeature(plan: Plan | string | null | undefined, feature: PlanFeature) {
  return planFor(plan).features.includes(feature)
}

export type EntitlementOverrides = Partial<Record<keyof Entitlements, number | null | undefined>>

/**
 * A tenant's effective entitlements: the plan's, unless someone negotiated
 * otherwise and wrote it on the subscription.
 */
export function entitlementsFor(
  plan: Plan | string | null | undefined,
  overrides?: EntitlementOverrides | null
): Entitlements {
  const base = planFor(plan).entitlements
  if (!overrides) return { ...base }
  return {
    patients: overrides.patients ?? base.patients,
    staff: overrides.staff ?? base.staff,
    storageMb: overrides.storageMb ?? base.storageMb,
  }
}

export function isUnlimited(limit: number): boolean {
  return limit === UNLIMITED
}

/**
 * Whether one more record fits.
 *
 * Takes the count rather than fetching it, so the caller decides whether the
 * count is worth a query — on an unlimited plan it never is.
 */
export function withinLimit(current: number, limit: number): boolean {
  return isUnlimited(limit) || current < limit
}
