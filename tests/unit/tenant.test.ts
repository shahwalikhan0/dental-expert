/**
 * What a tenant is entitled to, and whether they may still write.
 *
 * The behaviour worth pinning down is what suspension does *not* do. A clinic
 * whose subscription has lapsed keeps its records and keeps being able to read
 * and export them. Locking a practice out of its own patient notes over an
 * unpaid invoice would make the platform a hostage-taker — and where a
 * records-retention duty applies, an unlawful one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import { getTenant, initialSubscription, statusPermitsWrites, tenantHasFeature } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'

function clinicOn(
  plan: string,
  subscription: Record<string, unknown> = {},
  hospital: Record<string, unknown> = {}
) {
  vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
    id: 'h1',
    name: 'Smile Clinic',
    slug: 'smile-clinic',
    isActive: true,
    onboardingCompleted: true,
    ...hospital,
    subscription: {
      plan,
      status: 'ACTIVE',
      currentPeriodEnd: null,
      trialEndsAt: null,
      patientLimitOverride: null,
      staffLimitOverride: null,
      storageLimitMbOverride: null,
      ...subscription,
    },
  } as never)
}

beforeEach(() => vi.clearAllMocks())

describe('getTenant', () => {
  it('reads the plan and its allowances in one query', async () => {
    clinicOn('FREE')

    const tenant = await getTenant('h1')

    expect(tenant).toMatchObject({
      id: 'h1',
      plan: 'FREE',
      status: 'ACTIVE',
      writable: true,
      entitlements: { patients: 100, staff: 3, storageMb: 500 },
    })
    expect(prisma.hospital.findUnique).toHaveBeenCalledTimes(1)
  })

  it('applies a negotiated override on top of the plan', async () => {
    clinicOn('FREE', { patientLimitOverride: 250 })

    expect((await getTenant('h1'))?.entitlements.patients).toBe(250)
  })

  it('returns null for a clinic that does not exist', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue(null as never)

    expect(await getTenant('nope')).toBeNull()
  })

  /**
   * A tenant created before subscriptions existed, or one caught mid-signup,
   * has no subscription row. Treating that as the free tier grants the least
   * that could be wrongly granted — and it is the one case getTenant has to
   * guess about, which is why every path that creates a clinic now writes one.
   */
  it('treats a clinic with no subscription as trialing on the free tier', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      name: 'Smile Clinic',
      slug: 'smile-clinic',
      isActive: true,
      onboardingCompleted: false,
      subscription: null,
    } as never)

    expect(await getTenant('h1')).toMatchObject({
      plan: 'FREE',
      status: 'TRIALING',
      writable: true,
    })
  })

  it('knows which features the plan bought', async () => {
    clinicOn('ENTERPRISE')
    const enterprise = (await getTenant('h1'))!
    expect(tenantHasFeature(enterprise, 'branches')).toBe(true)

    clinicOn('FREE')
    const free = (await getTenant('h1'))!
    expect(tenantHasFeature(free, 'branches')).toBe(false)
  })
})

describe('when a clinic may write', () => {
  it('lets a trial write', async () => {
    clinicOn('PROFESSIONAL', { status: 'TRIALING' })
    expect((await getTenant('h1'))?.writable).toBe(true)
  })

  /**
   * An overdue invoice is a conversation with the practice manager, not a
   * reason to stop a receptionist checking in the patient in front of her.
   * Suspension is the lever for a tenant who will not pay, and a person pulls it.
   */
  it('lets an overdue clinic carry on working', async () => {
    clinicOn('PROFESSIONAL', { status: 'PAST_DUE' })
    expect((await getTenant('h1'))?.writable).toBe(true)
  })

  it('stops a suspended or cancelled clinic writing', async () => {
    clinicOn('PROFESSIONAL', { status: 'SUSPENDED' })
    expect((await getTenant('h1'))?.writable).toBe(false)

    clinicOn('PROFESSIONAL', { status: 'CANCELLED' })
    expect((await getTenant('h1'))?.writable).toBe(false)
  })

  it('stops a clinic the platform has switched off, whatever the subscription says', async () => {
    clinicOn('PROFESSIONAL', { status: 'ACTIVE' }, { isActive: false })
    expect((await getTenant('h1'))?.writable).toBe(false)
  })

  it('agrees with statusPermitsWrites', () => {
    expect(statusPermitsWrites('ACTIVE')).toBe(true)
    expect(statusPermitsWrites('TRIALING')).toBe(true)
    expect(statusPermitsWrites('PAST_DUE')).toBe(true)
    expect(statusPermitsWrites('SUSPENDED')).toBe(false)
    expect(statusPermitsWrites('CANCELLED')).toBe(false)
    expect(statusPermitsWrites(null)).toBe(false)
  })
})

describe('initialSubscription', () => {
  it('starts a paid plan on its trial', () => {
    const sub = initialSubscription('PROFESSIONAL')
    expect(sub.plan).toBe('PROFESSIONAL')
    expect(sub.status).toBe('TRIALING')
    expect(sub.trialEndsAt).toBeInstanceOf(Date)
  })

  /**
   * Free never lapses, so it has no period end. An expiry of "never" written as
   * a far-future date is a date that eventually arrives — usually on a weekend.
   */
  it('gives the free tier no expiry at all', () => {
    const sub = initialSubscription('FREE')
    expect(sub.status).toBe('ACTIVE')
    expect(sub.trialEndsAt).toBeNull()
    expect(sub.currentPeriodEnd).toBeNull()
  })
})
