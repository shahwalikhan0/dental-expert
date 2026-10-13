/**
 * Signing in to the right clinic.
 *
 * The case this file exists for: one email address, accounts at two clinics.
 * That was impossible while `User.email` was unique across the whole platform,
 * and the refusal leaked — the second clinic to try was told "an account with
 * this email already exists" about a clinic it cannot see.
 *
 * The password is what decides. A candidate account only enters the reckoning
 * once bcrypt has opened it, which is why an ambiguous result can safely name
 * the clinics involved: whoever is asking can already sign in to all of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('bcryptjs', () => ({
  default: {
    // Fixtures store the plaintext they expect in `password`, so "the right
    // password" is simply equality — no hashing in a unit test.
    compare: vi.fn(async (plain: string, stored: string) => plain === stored),
  },
}))

import { resolveLogin } from '@/lib/login'
import { prisma } from '@/lib/prisma'

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'dr.sana@example.com',
    name: 'Sana Khalid',
    password: 'correct-horse',
    role: 'DOCTOR',
    clinicalRole: null,
    isActive: true,
    isHospitalAdmin: false,
    isPlatformAdmin: false,
    image: null,
    hospitalId: 'h1',
    staff: { id: 's1' },
    hospital: { id: 'h1', slug: 'smile-clinic', name: 'Smile Clinic', isActive: true },
    ...overrides,
  }
}

const SECOND_CLINIC = account({
  id: 'u2',
  hospitalId: 'h2',
  staff: { id: 's2' },
  hospital: { id: 'h2', slug: 'city-dental', name: 'City Dental', isActive: true },
})

const found = (rows: unknown[]) => vi.mocked(prisma.user.findMany).mockResolvedValue(rows as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'a1' } as never)
})

describe('one account', () => {
  it('signs in and hands back the clinic the account belongs to', async () => {
    found([account()])

    const outcome = await resolveLogin({ email: 'dr.sana@example.com', password: 'correct-horse' })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') {
      expect(outcome.identity).toMatchObject({
        id: 'u1',
        hospitalId: 'h1',
        role: 'DOCTOR',
        staffId: 's1',
        isPlatformAdmin: false,
      })
    }
  })

  it('looks across every clinic when no clinic was named', async () => {
    found([account()])
    await resolveLogin({ email: 'dr.sana@example.com', password: 'correct-horse' })

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      // Without regard to case (finding 29): accounts stored before addresses
      // were lower-cased may still carry a capital.
      where: { email: { equals: 'dr.sana@example.com', mode: 'insensitive' } },
      include: { staff: true, hospital: true },
    })
  })

  it('finds an account typed with capitals and spaces', async () => {
    found([account()])
    await resolveLogin({ email: '  Dr.Sana@Example.COM ', password: 'correct-horse' })

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: 'dr.sana@example.com', mode: 'insensitive' } },
      })
    )
  })

  it('narrows to one clinic when the sign-in page named one', async () => {
    found([account()])
    await resolveLogin({
      email: 'dr.sana@example.com',
      password: 'correct-horse',
      clinicSlug: 'smile-clinic',
    })

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        email: { equals: 'dr.sana@example.com', mode: 'insensitive' },
        hospital: { slug: 'smile-clinic' },
      },
      include: { staff: true, hospital: true },
    })
  })

  it('refuses a wrong password', async () => {
    found([account()])
    expect((await resolveLogin({ email: 'dr.sana@example.com', password: 'wrong' })).status).toBe(
      'invalid'
    )
  })

  it('refuses an address nobody holds', async () => {
    found([])
    expect((await resolveLogin({ email: 'nobody@example.com', password: 'x' })).status).toBe(
      'invalid'
    )
  })

  it('tells a deactivated account apart from a deactivated clinic', async () => {
    found([account({ isActive: false })])
    expect(
      (await resolveLogin({ email: 'dr.sana@example.com', password: 'correct-horse' })).status
    ).toBe('user_inactive')

    found([account({ hospital: { id: 'h1', slug: 's', name: 'S', isActive: false } })])
    expect(
      (await resolveLogin({ email: 'dr.sana@example.com', password: 'correct-horse' })).status
    ).toBe('clinic_inactive')
  })
})

describe('the same person at two clinics', () => {
  it('asks which one, rather than picking', async () => {
    found([account(), SECOND_CLINIC])

    const outcome = await resolveLogin({
      email: 'dr.sana@example.com',
      password: 'correct-horse',
    })

    expect(outcome.status).toBe('ambiguous')
    if (outcome.status === 'ambiguous') {
      expect(outcome.clinics).toEqual([
        { slug: 'city-dental', name: 'City Dental' },
        { slug: 'smile-clinic', name: 'Smile Clinic' },
      ])
    }
  })

  /**
   * The ordinary case, and the one that would otherwise be broken by the move
   * to per-clinic addresses: two people at two clinics who happen to share an
   * address are not ambiguous, because only one of the passwords opens.
   */
  it('is not ambiguous when only one password opens', async () => {
    found([account(), account({ id: 'u2', hospitalId: 'h2', password: 'something-else' })])

    const outcome = await resolveLogin({
      email: 'dr.sana@example.com',
      password: 'correct-horse',
    })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') expect(outcome.identity.hospitalId).toBe('h1')
  })

  it('signs straight in once a clinic is picked', async () => {
    found([SECOND_CLINIC])

    const outcome = await resolveLogin({
      email: 'dr.sana@example.com',
      password: 'correct-horse',
      clinicSlug: 'city-dental',
    })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') expect(outcome.identity.hospitalId).toBe('h2')
  })

  it('ignores a clinic whose account is switched off', async () => {
    found([account(), { ...SECOND_CLINIC, isActive: false }])

    const outcome = await resolveLogin({
      email: 'dr.sana@example.com',
      password: 'correct-horse',
    })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') expect(outcome.identity.hospitalId).toBe('h1')
  })
})

describe('the audit trail — specification §10', () => {
  const actions = () =>
    vi.mocked(prisma.auditLog.create).mock.calls.map((c) => (c[0] as any).data.action)

  it('records a successful sign-in with the role held at the time', async () => {
    found([account()])
    await resolveLogin({
      email: 'dr.sana@example.com',
      password: 'correct-horse',
      context: { ipAddress: '203.0.113.7', userAgent: 'Firefox' },
    })

    const entry = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any
    expect(entry.data).toMatchObject({
      hospitalId: 'h1',
      userId: 'u1',
      action: 'login.success',
      ipAddress: '203.0.113.7',
    })
    expect(JSON.parse(entry.data.newValues)).toMatchObject({ role: 'DOCTOR' })
  })

  /**
   * Both clinics get an entry. A run of wrong-password attempts against an
   * address is exactly what an audit trail is for, and each clinic can only
   * see its own log — so recording it in one of the two would hide the attempt
   * from the other.
   */
  it('records a failed attempt at every clinic the address is held at', async () => {
    found([account(), SECOND_CLINIC])
    await resolveLogin({ email: 'dr.sana@example.com', password: 'wrong' })

    expect(actions()).toEqual(['login.failed.password', 'login.failed.password'])
  })

  it('records nothing for an address that matches nobody', async () => {
    found([])
    await resolveLogin({ email: 'nobody@example.com', password: 'wrong' })

    // AuditLog hangs off a clinic, and an unknown address belongs to none —
    // so an unauthenticated caller cannot fill the table by guessing addresses.
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it('records nothing when the clinic picker re-runs the same attempt', async () => {
    found([account(), SECOND_CLINIC])
    await resolveLogin({ email: 'dr.sana@example.com', password: 'correct-horse', audit: false })

    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })
})

/**
 * An invitation is a `User` row with no password — see lib/invitations.ts. That
 * puts rows in the users table that must never open, so this is the boundary
 * the merge has to hold.
 */
describe('a row that is an invitation, not an account', () => {
  const invited = account({
    id: 'u3',
    password: null,
    isActive: false,
    staff: null,
  })

  it('cannot be signed in to, whatever is typed', async () => {
    found([invited])

    for (const attempt of ['', 'correct-horse', 'null', 'undefined']) {
      expect(await resolveLogin({ email: invited.email, password: attempt })).toEqual({
        status: 'invalid',
      })
    }
  })

  it('never reaches bcrypt at all', async () => {
    found([invited])
    const bcrypt = (await import('bcryptjs')).default

    await resolveLogin({ email: invited.email, password: 'anything' })

    // Comparing against a null hash is not something to leave to the library.
    expect(bcrypt.compare).not.toHaveBeenCalled()
  })

  it('does not make a real account at another clinic ambiguous', async () => {
    // The same address invited to one clinic and holding an account at another:
    // signing in must go straight to the account, with no clinic picker.
    found([invited, SECOND_CLINIC])

    const outcome = await resolveLogin({
      email: invited.email,
      password: 'correct-horse',
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.status === 'ok' && outcome.identity.hospitalId).toBe('h2')
  })
})
