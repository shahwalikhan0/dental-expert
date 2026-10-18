/**
 * Whether a signed-in account still stands, and what it may do now.
 *
 * A session token is issued at sign-in and lasts the clinic's timeout — eight
 * hours by default. Everything on it used to be read once, at that moment: a
 * person changed from Front Desk to Accounts kept Front Desk's access, menu and
 * colour until they signed out, and a person deactivated after they had left
 * went on reading and writing patient records for the rest of the shift (bug
 * report 16 Oct, findings 1 and 2).
 *
 * So the account is read again on every request that reaches the server with a
 * database to hand: every API route and every server-rendered page. Its role,
 * second role and clinic administration flag replace the token's, and an
 * account that has been deactivated, removed, moved to another clinic, or whose
 * clinic has been suspended, ends the session. It is one read by primary key,
 * the same cost as the clinic check it replaces in lib/api-helpers.ts.
 *
 * Middleware runs on the edge, where there is no database, and keeps reading
 * the token as it was. The token itself is rewritten whenever the browser asks
 * for its session (components/layout/session-watch.tsx does, every minute), so
 * the menus middleware gates catch up within that minute; what a person can
 * actually read or change is decided by the API, which is never behind.
 */
import type { JWT } from 'next-auth/jwt'
import { prisma } from './prisma'

export interface AccountStanding {
  role: string
  clinicalRole?: string
  staffId?: string
  isHospitalAdmin: boolean
  isPlatformAdmin: boolean
}

/**
 * The account as it stands now, or null when it may no longer be signed in to
 * this clinic. The same conditions sign-in refuses on (lib/login.ts).
 */
export async function accountStanding(
  userId: string,
  hospitalId: string
): Promise<AccountStanding | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      hospitalId: true,
      role: true,
      clinicalRole: true,
      isHospitalAdmin: true,
      isPlatformAdmin: true,
      hospital: { select: { isActive: true } },
      staff: { select: { id: true } },
    },
  })

  if (!user || !user.isActive || user.hospitalId !== hospitalId || !user.hospital?.isActive) {
    return null
  }

  return {
    role: user.role,
    clinicalRole: user.clinicalRole ?? undefined,
    staffId: user.staff?.id,
    isHospitalAdmin: user.isHospitalAdmin,
    isPlatformAdmin: user.isPlatformAdmin,
  }
}

/**
 * The token brought up to date, or null to end the session.
 *
 * If the database cannot be reached the token is kept as it is: the request
 * that follows needs the database too and will fail on its own, and signing
 * everybody out of the clinic over a dropped connection would turn a blip into
 * an outage.
 */
export async function refreshToken(token: JWT): Promise<JWT | null> {
  if (!token.id || !token.hospitalId) return token

  let standing: AccountStanding | null
  try {
    standing = await accountStanding(token.id, token.hospitalId)
  } catch (error) {
    console.error('Could not re-read the signed-in account:', error)
    return token
  }

  if (!standing) return null

  token.role = standing.role
  token.clinicalRole = standing.clinicalRole
  token.staffId = standing.staffId
  token.isHospitalAdmin = standing.isHospitalAdmin
  token.isPlatformAdmin = standing.isPlatformAdmin
  return token
}
