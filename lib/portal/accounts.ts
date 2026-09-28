/**
 * Issuing, checking and withdrawing a patient's portal credentials.
 *
 * The password is generated here and shown to the desk exactly once. It is
 * never stored in the clear, never emailed and never written to the audit log
 * — the audit records *that* a credential was issued and by whom, which is the
 * part anybody will need to answer for later.
 */
import { randomInt } from 'crypto'
import bcrypt from 'bcryptjs'
import type { Prisma, PrismaClient } from '@prisma/client'
import { readSecuritySettings } from '@/lib/security-settings'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * The alphabet a temporary password is drawn from.
 *
 * No 0/O, no 1/l/I. Somebody at the desk reads this down a telephone or writes
 * it on a card, and a patient who cannot sign in because of a character they
 * could not tell apart will telephone the clinic — which costs more than the
 * two bits of entropy dropping them saves.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** Long enough that the alphabet's omissions do not matter: ~70 bits. */
const TEMPORARY_LENGTH = 12

export function generateTemporaryPassword(): string {
  let out = ''
  for (let i = 0; i < TEMPORARY_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)]
  }
  return out
}

/** Work factor 12, the same as the staff accounts use. */
export async function hashPortalPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export interface PortalLockout {
  locked: boolean
  until: Date | null
}

/**
 * Whether this account is locked, and until when.
 *
 * A counter on the row rather than the audit-log reconstruction the staff
 * lockout uses (`lib/lockout.ts`). That one counts `AuditLog` rows keyed by
 * `userId`, which is a foreign key to `User` — a patient has no `User` row, so
 * there is nothing to key on. The counter is reset on every success and on
 * every reissue.
 */
export function portalLockout(
  account: { failedAttempts: number; lockedUntil: Date | null },
  now: Date = new Date()
): PortalLockout {
  if (account.lockedUntil && account.lockedUntil > now) {
    return { locked: true, until: account.lockedUntil }
  }
  return { locked: false, until: null }
}

/**
 * Count a wrong password, and lock the account if that was one too many.
 *
 * The clinic's own `maxLoginAttempts` and `lockoutDurationMinutes`, so a clinic
 * that has decided how tolerant it wants to be does not have to decide twice.
 */
export async function recordPortalFailure(
  db: Db,
  { accountId, hospitalId, now = new Date() }: { accountId: string; hospitalId: string; now?: Date }
): Promise<void> {
  const settings = await readSecuritySettings(db, hospitalId)

  const account = await db.patientPortalAccount.findUnique({
    where: { id: accountId },
    select: { failedAttempts: true, lockedUntil: true },
  })
  if (!account) return

  // A lapsed lock starts the count again rather than continuing it, so an
  // account is not permanently one mistake from being locked.
  const expired = account.lockedUntil !== null && account.lockedUntil <= now
  const attempts = (expired ? 0 : account.failedAttempts) + 1

  const trips = attempts >= settings.maxLoginAttempts

  await db.patientPortalAccount.update({
    where: { id: accountId },
    data: {
      failedAttempts: trips ? 0 : attempts,
      lockedUntil: trips
        ? new Date(now.getTime() + settings.lockoutDurationMinutes * 60_000)
        : expired
          ? null
          : account.lockedUntil,
    },
  })
}

export async function clearPortalFailures(db: Db, accountId: string): Promise<void> {
  await db.patientPortalAccount.update({
    where: { id: accountId },
    data: { failedAttempts: 0, lockedUntil: null },
  })
}
