/**
 * Locking an account after repeated wrong passwords.
 *
 * Settings → Security has always offered "maximum login attempts" and "lockout
 * duration". Nothing enforced either, so the real policy was unlimited guesses
 * at unlimited speed — and there is no rate limiting anywhere in this
 * application, so the only thing standing between a list of leaked passwords
 * and a clinic's patient records was how fast the attacker's connection is.
 *
 * ## Counted from the audit log, not from a column
 *
 * `AuditLog` already records every wrong password with a user, a clinic and a
 * timestamp — that is what §10 asked for and what `resolveLogin` has always
 * written. Counting those rows means the lockout needs no new column, no
 * cleanup job for stale counters, and no second version of the truth that can
 * disagree with the trail an auditor reads.
 *
 * It also means the counter resets the way a person expects: attempts are
 * counted **since the last successful sign-in**, so getting it right clears the
 * slate, and older failures age out of the window on their own.
 *
 * The cost is one indexed query per sign-in attempt, on a table indexed by
 * clinic and user. Sign-in is not a hot path.
 *
 * ## What it is not
 *
 * This locks an *account*, not an address. Someone spraying one password
 * across many accounts is not slowed by it, and nothing here pretends
 * otherwise — that is the job of a rate limit at the edge, which this
 * application does not have and which is recorded as outstanding in
 * docs/ROADMAP.md.
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import { AUDIT_ACTIONS } from '@/lib/audit'

type Db = PrismaClient | Prisma.TransactionClient

export interface LockoutPolicy {
  maxLoginAttempts: number
  lockoutDurationMinutes: number
}

export interface LockoutState {
  locked: boolean
  /** Wrong passwords counted in the window. */
  attempts: number
  /** When the lock lifts, or null when it is not locked. */
  until: Date | null
}

/**
 * How many wrong passwords this account has had, and whether it is locked.
 *
 * The window is the lockout duration, measured back from now. A failure older
 * than the window does not count, which is what makes the lock lift by itself:
 * after `lockoutDurationMinutes` of not trying, the oldest failure falls out of
 * the count and the account opens again — no scheduled job, no stored expiry.
 */
export async function lockoutState(
  db: Db,
  {
    hospitalId,
    userId,
    policy,
    now = new Date(),
  }: { hospitalId: string; userId: string; policy: LockoutPolicy; now?: Date }
): Promise<LockoutState> {
  const windowStart = new Date(now.getTime() - policy.lockoutDurationMinutes * 60_000)

  // A success inside the window wipes what came before it. Without this, a
  // person who mistypes four times, signs in, then mistypes once more would be
  // locked out by failures they had already corrected.
  const lastSuccess = await db.auditLog.findFirst({
    where: {
      hospitalId,
      userId,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })

  const since = lastSuccess ? lastSuccess.createdAt : windowStart

  const failures = await db.auditLog.findMany({
    where: {
      hospitalId,
      userId,
      action: AUDIT_ACTIONS.LOGIN_FAILED_PASSWORD,
      createdAt: { gt: since },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })

  const attempts = failures.length

  if (attempts < policy.maxLoginAttempts) {
    return { locked: false, attempts, until: null }
  }

  // The lock lifts a full duration after the failure that tripped it — the
  // Nth, not the most recent. Measuring from the most recent would extend the
  // lock every time anybody tried again, including the account's real owner
  // discovering they are locked out, which turns a thirty-minute inconvenience
  // into an indefinite one.
  const tripping = failures[policy.maxLoginAttempts - 1]
  const until = new Date(tripping.createdAt.getTime() + policy.lockoutDurationMinutes * 60_000)

  if (until <= now) return { locked: false, attempts, until: null }

  return { locked: true, attempts, until }
}

/** How long is left, in whole minutes, for the message shown to the person. */
export function minutesRemaining(until: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000))
}
