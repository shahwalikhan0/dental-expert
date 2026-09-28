// @vitest-environment node
/**
 * The patient session, and the wall between it and the staff session.
 *
 * Both are HS256 tokens signed with `NEXTAUTH_SECRET`, so a signature check
 * alone would accept either one anywhere. What keeps them apart is the audience
 * claim, and that is worth a test of its own: if it ever stops being required,
 * a staff token becomes a valid patient session and every portal route starts
 * answering to it. Nothing about that failure would look wrong in review.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT } from 'jose'

const store = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { name, value: store.get(name) } : undefined),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  }),
}))

process.env.NEXTAUTH_SECRET = 'a-test-secret-that-is-long-enough'

const { PORTAL_COOKIE, clearPortalSession, issuePortalSession, readPortalSession } =
  await import('@/lib/portal/session')

const session = {
  accountId: 'acc_1',
  patientId: 'pat_1',
  hospitalId: 'hos_1',
}

describe('portal session', () => {
  beforeEach(() => store.clear())

  it('reads back what it issued', async () => {
    await issuePortalSession(session)
    expect(await readPortalSession()).toEqual(session)
  })

  it('is nothing when there is no cookie', async () => {
    expect(await readPortalSession()).toBeNull()
  })

  it('is nothing after signing out', async () => {
    await issuePortalSession(session)
    await clearPortalSession()
    expect(await readPortalSession()).toBeNull()
  })

  it('refuses a token that has been edited', async () => {
    await issuePortalSession(session)
    const token = store.get(PORTAL_COOKIE)!
    const [header, payload, signature] = token.split('.')
    // Same signature, different claims — which is the whole point of signing.
    const tampered = JSON.parse(Buffer.from(payload, 'base64url').toString())
    tampered.patientId = 'pat_someone_else'
    store.set(
      PORTAL_COOKIE,
      `${header}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`
    )
    expect(await readPortalSession()).toBeNull()
  })

  /**
   * The one that matters. A token signed with the same secret, carrying a
   * staff-shaped payload, must not open a patient session.
   */
  it('refuses a staff token signed with the same secret', async () => {
    const staffToken = await new SignJWT({ role: 'ADMIN', hospitalId: 'hos_1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET!))

    store.set(PORTAL_COOKIE, staffToken)
    expect(await readPortalSession()).toBeNull()
  })

  it('refuses a token signed with a different secret', async () => {
    const foreign = await new SignJWT({ patientId: 'pat_1', hospitalId: 'hos_1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('acc_1')
      .setAudience('patient-portal')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret-entirely-xxxxx'))

    store.set(PORTAL_COOKIE, foreign)
    expect(await readPortalSession()).toBeNull()
  })

  it('refuses one that has expired', async () => {
    const expired = await new SignJWT({ patientId: 'pat_1', hospitalId: 'hos_1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('acc_1')
      .setAudience('patient-portal')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET!))

    store.set(PORTAL_COOKIE, expired)
    expect(await readPortalSession()).toBeNull()
  })

  it('carries nothing but the three ids', async () => {
    await issuePortalSession(session)
    const payload = JSON.parse(
      Buffer.from(store.get(PORTAL_COOKIE)!.split('.')[1], 'base64url').toString()
    )
    // No name, no patient number, no clinic name: a cookie is a thing that
    // travels, and none of that needs to.
    expect(Object.keys(payload).sort()).toEqual(
      ['aud', 'exp', 'hospitalId', 'iat', 'patientId', 'sub'].sort()
    )
  })
})
