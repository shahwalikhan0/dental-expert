/**
 * The platform console.
 *
 * These are the only endpoints in the application that deliberately read across
 * clinics, so the question that matters is who can reach them. The answer must
 * not be "an ADMIN", because every clinic has one of those and none of them has
 * any business seeing another clinic's row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GET as LIST_TENANTS } from '@/app/api/platform/tenants/route'
import { PATCH as UPDATE_TENANT } from '@/app/api/platform/tenants/[id]/route'

function signedIn(user: Record<string, unknown> | null) {
  vi.mocked(auth).mockResolvedValue(user ? ({ user } as never) : (null as never))
}

/** What the database says about the caller, which is what actually decides. */
function callerIs(record: Record<string, unknown> | null) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue(record as never)
}

const PLATFORM_ADMIN = {
  id: 'u1',
  email: 'ops@platform.example',
  name: 'Ops',
  hospitalId: 'h-internal',
  isActive: true,
  isPlatformAdmin: true,
}

const listRequest = () => new NextRequest('http://localhost/api/platform/tenants')

const patchRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/platform/tenants/h1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const params = { params: Promise.resolve({ id: 'h1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'a1' } as never)
  vi.mocked(prisma.$transaction).mockImplementation(((fn: never) =>
    (fn as unknown as (tx: unknown) => unknown)(prisma)) as never)
})

describe('who may reach the platform console', () => {
  it('turns away someone who is not signed in', async () => {
    signedIn(null)
    expect((await LIST_TENANTS(listRequest())).status).toBe(401)
  })

  /**
   * 404, not 403. Telling a clinic's administrator that a platform console
   * exists behind this URL invites them to go looking for a way in; there is
   * nothing here for them, so the answer is that there is nothing here.
   */
  it('shows a clinic administrator nothing, and does not admit the console exists', async () => {
    signedIn({ id: 'u9', role: 'ADMIN', hospitalId: 'h1', isHospitalAdmin: true })
    callerIs({ ...PLATFORM_ADMIN, id: 'u9', isPlatformAdmin: false })

    expect((await LIST_TENANTS(listRequest())).status).toBe(404)
  })

  /**
   * The flag is in the session token too, and the token lives eight hours. For
   * the one privilege that crosses every tenant boundary, waiting up to eight
   * hours for its removal to take effect is not an answer.
   */
  it('does not take the caller’s word for it from the session', async () => {
    signedIn({ id: 'u9', role: 'RECEPTIONIST', hospitalId: 'h1', isPlatformAdmin: true })
    callerIs({ ...PLATFORM_ADMIN, id: 'u9', isPlatformAdmin: false })

    expect((await LIST_TENANTS(listRequest())).status).toBe(404)
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u9' } })
    )
  })

  it('turns away a deactivated platform admin', async () => {
    signedIn({ id: 'u1', role: 'ADMIN', hospitalId: 'h-internal' })
    callerIs({ ...PLATFORM_ADMIN, isActive: false })

    expect((await LIST_TENANTS(listRequest())).status).toBe(404)
  })
})

describe('the tenant list', () => {
  beforeEach(() => {
    signedIn({ id: 'u1', role: 'ADMIN', hospitalId: 'h-internal' })
    callerIs(PLATFORM_ADMIN)
  })

  it('reports each clinic against the allowance its plan grants', async () => {
    vi.mocked(prisma.hospital.findMany).mockResolvedValue([
      {
        id: 'h1',
        name: 'Smile Clinic',
        slug: 'smile-clinic',
        email: 'hi@smile.example',
        phone: null,
        city: 'Lahore',
        isActive: true,
        onboardingCompleted: true,
        createdAt: new Date('2026-01-01'),
        subscription: {
          plan: 'FREE',
          status: 'ACTIVE',
          currentPeriodEnd: null,
          trialEndsAt: null,
          patientLimitOverride: null,
          staffLimitOverride: null,
          storageLimitMbOverride: null,
        },
        _count: { patients: 84, users: 2 },
      },
    ] as never)

    const body = await (await LIST_TENANTS(listRequest())).json()

    expect(body.tenants[0]).toMatchObject({
      name: 'Smile Clinic',
      plan: 'FREE',
      planName: 'Free',
      status: 'ACTIVE',
      patients: 84,
      entitlements: { patients: 100, staff: 3, storageMb: 500 },
    })
  })

  // Operational facts only. Nothing from inside anybody's records.
  it('returns nothing from inside a clinic', async () => {
    vi.mocked(prisma.hospital.findMany).mockResolvedValue([] as never)
    await LIST_TENANTS(listRequest())

    const select = vi.mocked(prisma.hospital.findMany).mock.calls[0][0]!.select as Record<
      string,
      unknown
    >
    expect(Object.keys(select).sort()).toEqual(
      [
        '_count',
        'city',
        'createdAt',
        'email',
        'id',
        'isActive',
        'name',
        'onboardingCompleted',
        'phone',
        'slug',
        'subscription',
      ].sort()
    )
  })
})

describe('changing a tenant', () => {
  const EXISTING = {
    id: 'h1',
    name: 'Smile Clinic',
    isActive: true,
    subscription: {
      id: 'sub1',
      plan: 'FREE',
      status: 'ACTIVE',
      currentPeriodEnd: null,
      cancelledAt: null,
      patientLimitOverride: null,
      staffLimitOverride: null,
      storageLimitMbOverride: null,
    },
  }

  beforeEach(() => {
    signedIn({ id: 'u1', role: 'ADMIN', hospitalId: 'h-internal' })
    callerIs(PLATFORM_ADMIN)
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue(EXISTING as never)
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({} as never)
    vi.mocked(prisma.hospital.update).mockResolvedValue({} as never)
  })

  it('moves a clinic onto another plan', async () => {
    const res = await UPDATE_TENANT(patchRequest({ plan: 'PROFESSIONAL' }), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.subscription.upsert).mock.calls[0][0].update).toMatchObject({
      plan: 'PROFESSIONAL',
    })
  })

  it('refuses a plan that does not exist', async () => {
    expect((await UPDATE_TENANT(patchRequest({ plan: 'GOLD' }), params)).status).toBe(400)
  })

  it('creates the subscription for a tenant that predates them', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      ...EXISTING,
      subscription: null,
    } as never)

    await UPDATE_TENANT(patchRequest({ plan: 'ENTERPRISE' }), params)

    expect(vi.mocked(prisma.subscription.upsert).mock.calls[0][0].create).toMatchObject({
      hospitalId: 'h1',
      plan: 'ENTERPRISE',
    })
  })

  /**
   * Written to the *clinic's* own audit log, not to a separate platform ledger.
   * A practice whose plan was changed or whose account was suspended is
   * entitled to see that it happened and at whose hand — §10 asks for
   * configuration changes to be recorded, and "the platform did it" does not
   * make it less of one.
   */
  it('records the change in the clinic’s own audit trail', async () => {
    vi.mocked(prisma.hospital.findUnique)
      .mockResolvedValueOnce(EXISTING as never)
      .mockResolvedValueOnce({
        ...EXISTING,
        subscription: { ...EXISTING.subscription, plan: 'PROFESSIONAL' },
      } as never)

    await UPDATE_TENANT(patchRequest({ plan: 'PROFESSIONAL' }), params)

    const entry = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data
    expect(entry).toMatchObject({
      hospitalId: 'h1',
      userId: 'u1',
      action: 'platform.tenant.plan_changed',
      entityType: 'Subscription',
    })
  })

  it('names a suspension a suspension', async () => {
    vi.mocked(prisma.hospital.findUnique)
      .mockResolvedValueOnce(EXISTING as never)
      .mockResolvedValueOnce({ ...EXISTING, isActive: false } as never)

    await UPDATE_TENANT(patchRequest({ isActive: false }), params)

    expect(vi.mocked(prisma.auditLog.create).mock.calls[0][0].data.action).toBe(
      'platform.tenant.suspended'
    )
  })

  it('404s on a clinic that does not exist', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue(null as never)

    expect((await UPDATE_TENANT(patchRequest({ plan: 'FREE' }), params)).status).toBe(404)
  })
})
