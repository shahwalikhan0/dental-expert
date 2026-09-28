/**
 * The patient's session cookie.
 *
 * Deliberately not NextAuth. The staff session carries a `role`, and the whole
 * authorisation system — `holderCan`, `permissionForRoute`, `requirePermission`
 * — decides what someone may do by reading it. A patient inside that session
 * would be one missing branch away from being treated as staff, and the branch
 * that was missing would not announce itself. A separate cookie, a separate
 * verifier and a separate audience claim means the two can never be confused:
 * there is no code path that turns one into the other.
 *
 * Stateless, signed with the same secret. What is *not* in the token is the
 * point — no name, no patient number, no clinic name, nothing that would be a
 * disclosure if the cookie were read. Only the three ids needed to scope a
 * query, and every request re-reads the account to check it is still live.
 */
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

export const PORTAL_COOKIE = 'patient_session'

/**
 * The claim that keeps the two kinds of token apart.
 *
 * A staff token is signed with the same secret, so a signature check alone
 * would accept one here. `jwtVerify` is told to require this audience, which
 * makes a staff token fail verification rather than fail an `if` somebody
 * forgot to write.
 */
const AUDIENCE = 'patient-portal'

/**
 * Four hours.
 *
 * Shorter than the staff session, and not configurable per clinic. A patient
 * signs in to read something and closes the tab; a session that outlives that
 * is a session left open on a shared or borrowed phone, which is the realistic
 * threat here rather than an attacker with the cookie.
 */
const MAX_AGE_SECONDS = 4 * 60 * 60

export interface PortalSession {
  accountId: string
  patientId: string
  hospitalId: string
}

function secret(): Uint8Array {
  const value = process.env.NEXTAUTH_SECRET
  // Refuse rather than fall back to a default. A signing key with a known
  // value is not a session, it is a way in.
  if (!value) throw new Error('NEXTAUTH_SECRET is not set')
  return new TextEncoder().encode(value)
}

export async function issuePortalSession(session: PortalSession): Promise<void> {
  const token = await new SignJWT({
    patientId: session.patientId,
    hospitalId: session.hospitalId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.accountId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret())

  const jar = await cookies()
  jar.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

/** The session this request carries, or null. Never throws. */
export async function readPortalSession(): Promise<PortalSession | null> {
  try {
    const jar = await cookies()
    const token = jar.get(PORTAL_COOKIE)?.value
    if (!token) return null

    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
    })

    const accountId = payload.sub
    const patientId = payload.patientId
    const hospitalId = payload.hospitalId

    if (
      typeof accountId !== 'string' ||
      typeof patientId !== 'string' ||
      typeof hospitalId !== 'string'
    ) {
      return null
    }

    return { accountId, patientId, hospitalId }
  } catch {
    // Expired, tampered with, signed for another audience, or no secret to
    // check it against. All of them mean the same thing to the caller.
    return null
  }
}

export async function clearPortalSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(PORTAL_COOKIE)
}
