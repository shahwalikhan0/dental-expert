/**
 * What happens to a clinic that stops paying.
 *
 * The rule, stated once: **they keep their records and keep being able to read
 * and export them; they cannot write.** Locking a practice out of its own
 * patient notes over an unpaid invoice would make the platform a hostage-taker,
 * and where a records-retention duty applies, an unlawful one.
 *
 * The other half of the rule is the ordering. A receptionist who was never
 * allowed to approve a refund is told they are not allowed — not that their
 * clinic owes us money. Authorisation first, billing second.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireAllPermissions, requirePermission } from '@/lib/api-helpers'
import { PERMISSIONS, READ_ONLY_PERMISSIONS, isReadOnlyPermission } from '@/lib/rbac'

function signedInAs(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: 'u1', role, hospitalId: 'h1', email: 'a@b.c', name: 'A', isHospitalAdmin: true },
  } as never)
}

function subscriptionIs(status: string, hospitalActive = true) {
  vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
    id: 'h1',
    name: 'Smile Clinic',
    slug: 'smile-clinic',
    isActive: hospitalActive,
    onboardingCompleted: true,
    subscription: {
      plan: 'PROFESSIONAL',
      status,
      currentPeriodEnd: null,
      trialEndsAt: null,
      patientLimitOverride: null,
      staffLimitOverride: null,
      storageLimitMbOverride: null,
    },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('ADMIN')
})

describe('a suspended clinic', () => {
  it('is refused a write, with a reason that is not "forbidden"', async () => {
    subscriptionIs('SUSPENDED')

    const { error } = await requirePermission('patients:write')

    expect(error?.status).toBe(402)
    const body = await error!.json()
    expect(body.code).toBe('SUBSCRIPTION_INACTIVE')
    expect(body.status).toBe('SUSPENDED')
  })

  it('may still read its own records', async () => {
    subscriptionIs('SUSPENDED')

    expect((await requirePermission('patients:read')).error).toBeNull()
    expect((await requirePermission('clinical:read')).error).toBeNull()
  })

  /**
   * The one that matters most. A clinic being cut off is exactly when it needs
   * to take its data somewhere else, so the export must keep working.
   */
  it('may still export', async () => {
    subscriptionIs('SUSPENDED')

    expect((await requirePermission('reports:export')).error).toBeNull()
  })

  it('does not even look up the subscription for a read', async () => {
    subscriptionIs('SUSPENDED')

    await requirePermission('billing:read')

    expect(prisma.hospital.findUnique).not.toHaveBeenCalled()
  })

  it('is refused when only one of several capabilities writes', async () => {
    subscriptionIs('SUSPENDED')

    const { error } = await requireAllPermissions(['clinical:read', 'billing:write'])
    expect(error?.status).toBe(402)
  })
})

describe('a clinic that is still in good standing', () => {
  it('writes normally while trialing', async () => {
    subscriptionIs('TRIALING')
    expect((await requirePermission('patients:write')).error).toBeNull()
  })

  it('writes normally while active', async () => {
    subscriptionIs('ACTIVE')
    expect((await requirePermission('patients:write')).error).toBeNull()
  })

  /**
   * An overdue invoice is a conversation with the practice manager, not a
   * reason to stop a receptionist checking in the patient in front of her.
   */
  it('writes normally while overdue', async () => {
    subscriptionIs('PAST_DUE')
    expect((await requirePermission('appointments:write')).error).toBeNull()
  })
})

describe('a clinic the platform has switched off', () => {
  it('cannot write even on an active subscription', async () => {
    subscriptionIs('ACTIVE', false)

    const { error } = await requirePermission('patients:write')
    expect(error?.status).toBe(402)
    expect((await error!.json()).error).toContain('suspended')
  })
})

describe('ordering', () => {
  /**
   * A receptionist has no `billing:refund`. If billing were checked first they
   * would be told their clinic's subscription had lapsed — information about
   * the clinic's commercial standing, handed to whoever tries a URL they are
   * not allowed to use in the first place.
   */
  it('reports the permission failure, not the billing one', async () => {
    signedInAs('RECEPTIONIST')
    subscriptionIs('SUSPENDED')

    const { error } = await requirePermission('billing:refund')

    expect(error?.status).toBe(403)
    expect(prisma.hospital.findUnique).not.toHaveBeenCalled()
  })
})

describe('the read-only list', () => {
  it('names only real capabilities', () => {
    for (const permission of READ_ONLY_PERMISSIONS) {
      expect(PERMISSIONS, permission).toContain(permission)
    }
  })

  /**
   * The list is written out rather than derived from the `:read` suffix, so
   * something has to notice when a capability is added. A new one counts as a
   * write until somebody decides otherwise, which is the safe default — this
   * only asserts the two are consistent about which is which.
   */
  it('classifies every capability one way or the other', () => {
    const reads = PERMISSIONS.filter(isReadOnlyPermission)
    const writes = PERMISSIONS.filter((p) => !isReadOnlyPermission(p))

    expect(reads.length + writes.length).toBe(PERMISSIONS.length)
    expect(reads).toEqual([...READ_ONLY_PERMISSIONS])
  })

  it('counts the obvious writes as writes', () => {
    for (const permission of [
      'patients:write',
      'clinical:write',
      'clinical:sign',
      'billing:discount',
      'billing:refund',
      'billing:closing',
      'settings:write',
      'users:manage',
    ] as const) {
      expect(isReadOnlyPermission(permission), permission).toBe(false)
    }
  })

  /**
   * `ai:use` reads nothing but costs the platform money on every call, so a
   * lapsed tenant does not get it. That is a deliberate choice, not an
   * oversight, and this is where it is written down.
   */
  it('treats AI assistance as a write', () => {
    expect(isReadOnlyPermission('ai:use')).toBe(false)
  })
})
