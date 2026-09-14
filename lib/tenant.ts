/**
 * The tenant a request belongs to, and what that tenant is entitled to.
 *
 * This product is one installation serving many clinics. Every row in the
 * database already carries a `hospitalId` and every route already filters on
 * it, so *isolation* was never the gap — what was missing was the other half of
 * multi-tenancy: knowing what each tenant has bought, and what happens when
 * they stop paying.
 *
 * Three questions are answered here, and only here:
 *
 *   1. **Is this tenant switched on at all?** (`Hospital.isActive`)
 *   2. **Is their subscription in a state that permits writing?**
 *   3. **How much of the thing they are about to create are they allowed?**
 *
 * Note what suspension does *not* do. A clinic whose subscription has lapsed
 * keeps its data and keeps being able to read and export it; what it loses is
 * the ability to write. Locking a practice out of its own patient records over
 * an unpaid invoice would make the platform a hostage-taker, and in several
 * jurisdictions an unlawful one — the records are the clinic's, and a
 * retention obligation does not pause because a card expired.
 */
import { prisma } from '@/lib/prisma'
import {
  entitlementsFor,
  planFor,
  withinLimit,
  type Entitlements,
  type PlanDefinition,
  type PlanFeature,
} from '@/lib/plans'
import type { Plan, SubscriptionStatus } from '@prisma/client'

/** Subscription states in which the clinic may still change its data. */
const WRITABLE_STATUSES: readonly SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE']

/**
 * PAST_DUE is deliberately on that list. An overdue invoice is a conversation
 * to have with the practice manager, not a reason to stop a receptionist
 * checking in the patient standing in front of her. Suspension is the lever for
 * a tenant who will not pay, and it is pulled by a person.
 */
export function statusPermitsWrites(status: SubscriptionStatus | null | undefined): boolean {
  return !!status && WRITABLE_STATUSES.includes(status)
}

export interface TenantContext {
  id: string
  name: string
  slug: string
  /** False when the platform has switched the tenant off entirely. */
  isActive: boolean
  onboardingCompleted: boolean

  plan: Plan
  planDefinition: PlanDefinition
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  trialEndsAt: Date | null

  /** The plan's allowances, with any negotiated overrides already applied. */
  entitlements: Entitlements
  /** Whether this tenant may currently change data. */
  writable: boolean
}

/**
 * Everything a request needs to know about its tenant, in one query.
 *
 * Returns null for a clinic that does not exist. A clinic that exists but has
 * no subscription row is *not* an error — it is a tenant created before
 * subscriptions existed, or one mid-signup — and is treated as being on the
 * free tier, which is the least that can be wrongly granted.
 */
export async function getTenant(hospitalId: string): Promise<TenantContext | null> {
  const hospital = await prisma.hospital.findUnique({
    where: { id: hospitalId },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      onboardingCompleted: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          patientLimitOverride: true,
          staffLimitOverride: true,
          storageLimitMbOverride: true,
        },
      },
    },
  })

  if (!hospital) return null

  const sub = hospital.subscription
  const plan: Plan = sub?.plan ?? 'FREE'
  const status: SubscriptionStatus = sub?.status ?? 'TRIALING'

  return {
    id: hospital.id,
    name: hospital.name,
    slug: hospital.slug,
    isActive: hospital.isActive,
    onboardingCompleted: hospital.onboardingCompleted,
    plan,
    planDefinition: planFor(plan),
    status,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    trialEndsAt: sub?.trialEndsAt ?? null,
    entitlements: entitlementsFor(plan, {
      patients: sub?.patientLimitOverride,
      staff: sub?.staffLimitOverride,
      storageMb: sub?.storageLimitMbOverride,
    }),
    writable: hospital.isActive && statusPermitsWrites(status),
  }
}

export function tenantHasFeature(tenant: TenantContext, feature: PlanFeature): boolean {
  return tenant.planDefinition.features.includes(feature)
}

export interface LimitCheck {
  allowed: boolean
  current: number
  max: number
}

/**
 * Whether one more patient fits.
 *
 * The count is only taken when there is a limit to compare it against. On an
 * unlimited plan — which is every paid plan — counting every patient record in
 * the clinic on every registration would be a table scan to learn nothing.
 */
export async function checkPatientEntitlement(hospitalId: string): Promise<LimitCheck> {
  const tenant = await getTenant(hospitalId)
  if (!tenant) return { allowed: false, current: 0, max: 0 }

  const max = tenant.entitlements.patients
  if (max < 0) return { allowed: true, current: 0, max }

  const current = await prisma.patient.count({ where: { hospitalId } })
  return { allowed: withinLimit(current, max), current, max }
}

/** Whether one more staff account fits. Only active accounts count. */
export async function checkStaffEntitlement(hospitalId: string): Promise<LimitCheck> {
  const tenant = await getTenant(hospitalId)
  if (!tenant) return { allowed: false, current: 0, max: 0 }

  const max = tenant.entitlements.staff
  if (max < 0) return { allowed: true, current: 0, max }

  const current = await prisma.user.count({ where: { hospitalId, isActive: true } })
  return { allowed: withinLimit(current, max), current, max }
}

/**
 * The subscription a brand-new tenant starts with.
 *
 * Kept here rather than inline in the signup route so that every way a clinic
 * can come into existence — self-service signup, an import, a tenant the
 * platform creates by hand — produces the same starting state. A tenant with no
 * subscription row at all is the one case `getTenant` has to guess about, and
 * guessing is worth avoiding.
 */
export function initialSubscription(plan: Plan = 'FREE') {
  const definition = planFor(plan)
  const trialEndsAt =
    definition.trialDays > 0
      ? new Date(Date.now() + definition.trialDays * 24 * 60 * 60 * 1000)
      : null

  return {
    plan,
    status: (trialEndsAt ? 'TRIALING' : 'ACTIVE') as SubscriptionStatus,
    trialEndsAt,
    // Free and the perpetual self-hosted licence never lapse, so they have no
    // period end — an expiry date of "never" written as a far-future timestamp
    // is a date that eventually arrives.
    currentPeriodEnd: trialEndsAt,
  }
}
