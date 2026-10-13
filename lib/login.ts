/**
 * Working out who is signing in, and to which clinic.
 *
 * On a single-clinic install this is one lookup: an email address identifies a
 * person, a person belongs to the clinic, done. On a platform serving many
 * clinics it is not, because the same address can legitimately belong to an
 * account at more than one of them — a dentist with Tuesday sessions at one
 * practice and Thursdays at another, a locum, an accountant doing the books for
 * three clinics.
 *
 * The old schema made that impossible by holding `User.email` unique across the
 * entire platform. The second clinic to try was told "an account with this
 * email already exists" — about a clinic they cannot see, have no relationship
 * with, and cannot be told about.
 *
 * So the address is now unique *within* a clinic, and this file turns an email
 * and a password into at most one account:
 *
 *   1. a clinic slug, if the sign-in page was given one (`?clinic=`), narrows
 *      the candidates before anything else happens;
 *   2. the password is checked against every remaining candidate, and only the
 *      accounts it actually opens survive;
 *   3. if that leaves exactly one, they are signed in.
 *
 * Step 2 is what makes step 3 safe to report on. The list of clinics returned
 * by an ambiguous result is only ever shown to someone who has already proved
 * they hold the password for every clinic in it, so it discloses nothing they
 * did not already know.
 */
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { AUDIT_ACTIONS, recordAudit } from './audit'
import { decideIp, parseIpRules } from './ip-rules'
import { lockoutState, minutesRemaining } from './lockout'
import { passwordHasExpired } from './password-policy'
import { readSecuritySettings, type SecuritySettings } from './security-settings'
import { emailEquals } from './email-address'

export interface LoginIdentity {
  id: string
  email: string
  name: string
  role: string
  clinicalRole?: string
  staffId?: string
  hospitalId: string
  isHospitalAdmin: boolean
  isPlatformAdmin: boolean
  image?: string | null
  /**
   * How long this session may last, from the clinic's security settings.
   *
   * Carried on the identity so the token can be stamped with it at sign-in.
   * The alternative — reading the setting on every request — would put a
   * database query in the JWT callback, which runs for every page and every
   * API call. A change to the timeout therefore takes effect at the next
   * sign-in rather than immediately, which is the right trade for a setting
   * whose whole purpose is to bound a session that has already started.
   */
  sessionTimeoutMinutes: number
  /**
   * The password has expired, or an administrator set a temporary one. The
   * person is signed in and is sent straight to the change-password form; see
   * middleware.ts.
   */
  mustChangePassword: boolean
}

export interface ClinicChoice {
  slug: string
  name: string
}

export type LoginOutcome =
  /** Signed in. */
  | { status: 'ok'; identity: LoginIdentity }
  /** No account anywhere matches this address and password. */
  | { status: 'invalid' }
  /** The account exists and the password is right, but the account is off. */
  | { status: 'user_inactive' }
  /** …or the clinic is. */
  | { status: 'clinic_inactive' }
  /**
   * Too many wrong passwords. Refused before the password is even checked —
   * see the note in resolveLogin on what that discloses and why it is the
   * right way round.
   */
  | { status: 'locked_out'; minutes: number }
  /** The clinic's address rules do not permit signing in from here. */
  | { status: 'ip_refused' }
  /**
   * The same address and password open accounts at several clinics. Nothing
   * has failed; the caller has to say which one they meant.
   */
  | { status: 'ambiguous'; clinics: ClinicChoice[] }

export interface ResolveLoginOptions {
  email: string
  password: string
  /** From `?clinic=<slug>` on the sign-in page, or the clinic picker. */
  clinicSlug?: string | null
  /** Request metadata for the audit trail. */
  context?: { ipAddress?: string | null; userAgent?: string | null }
  /**
   * Whether to write audit entries. The clinic-picker endpoint re-runs this
   * to list the choices and must not log a second attempt for the same one.
   */
  audit?: boolean
}

export async function resolveLogin({
  email,
  password,
  clinicSlug,
  context = {},
  audit = true,
}: ResolveLoginOptions): Promise<LoginOutcome> {
  /**
   * Matched without regard to case (finding 29). Addresses are lower-cased
   * where they are written now, but accounts made before that may hold a
   * capital, and their owners type their address however they type it.
   */
  const candidates = await prisma.user.findMany({
    where: {
      email: emailEquals(email),
      ...(clinicSlug ? { hospital: { slug: clinicSlug } } : {}),
    },
    include: { staff: true, hospital: true },
  })

  /**
   * An unknown address is deliberately not recorded. `AuditLog` hangs off a
   * clinic, and an address matching no user belongs to no clinic — and writing
   * those somewhere would let an unauthenticated caller fill the table at will.
   */
  if (candidates.length === 0) return { status: 'invalid' }

  /**
   * The clinic's own security settings, one read per clinic in play.
   *
   * Almost always exactly one. A shared address across several clinics reads
   * each of them, because the lockout and the address rules belong to the
   * clinic being signed in to, not to the person doing it.
   */
  const settingsByClinic = new Map<string, SecuritySettings>()
  for (const candidate of candidates) {
    if (!settingsByClinic.has(candidate.hospitalId)) {
      settingsByClinic.set(
        candidate.hospitalId,
        await readSecuritySettings(prisma, candidate.hospitalId)
      )
    }
  }

  /**
   * Where the attempt came from, against the clinic's address lists.
   *
   * Checked before the password, because an address the clinic has excluded
   * should not get to make guesses at all. A candidate refused here drops out;
   * if every candidate drops out, that is what is reported.
   */
  const permitted: typeof candidates = []
  for (const candidate of candidates) {
    const settings = settingsByClinic.get(candidate.hospitalId)!
    const decision = decideIp(context.ipAddress, {
      allowed: parseIpRules(settings.allowedIPs),
      blocked: parseIpRules(settings.blockedIPs),
    })

    if (decision.allowed) {
      permitted.push(candidate)
      continue
    }

    if (audit) {
      await recordAudit({
        hospitalId: candidate.hospitalId,
        userId: candidate.id,
        action: AUDIT_ACTIONS.LOGIN_BLOCKED_IP,
        entityType: 'User',
        entityId: candidate.id,
        newValues: { reason: decision.reason },
        ...context,
      })
    }
  }

  if (permitted.length === 0) return { status: 'ip_refused' }

  /**
   * Locked accounts, before the password is compared.
   *
   * Order matters and it is worth being explicit about the trade. Checking the
   * password first and only then reporting the lock would mean an attacker is
   * never slowed — every guess still costs a bcrypt comparison and none of
   * them is ever refused — which is to say the setting would do nothing, which
   * is the state this whole change exists to correct. Refusing first means the
   * refusal itself confirms that an account exists at that address. That is a
   * disclosure, it is the ordinary behaviour of every lockout, and it is the
   * lesser of the two.
   */
  const unlocked: typeof candidates = []
  let lockedUntil: Date | null = null

  for (const candidate of permitted) {
    const settings = settingsByClinic.get(candidate.hospitalId)!
    const state = await lockoutState(prisma, {
      hospitalId: candidate.hospitalId,
      userId: candidate.id,
      policy: settings,
    })

    if (!state.locked) {
      unlocked.push(candidate)
      continue
    }

    // The soonest any of them opens again, so somebody with accounts at two
    // clinics is told the shorter wait rather than the longer.
    if (!lockedUntil || state.until! < lockedUntil) lockedUntil = state.until

    if (audit) {
      await recordAudit({
        hospitalId: candidate.hospitalId,
        userId: candidate.id,
        action: AUDIT_ACTIONS.LOGIN_BLOCKED_LOCKOUT,
        entityType: 'User',
        entityId: candidate.id,
        newValues: { attempts: state.attempts, until: state.until?.toISOString() },
        ...context,
      })
    }
  }

  if (unlocked.length === 0 && lockedUntil) {
    return { status: 'locked_out', minutes: minutesRemaining(lockedUntil) }
  }

  const opened: typeof candidates = []
  for (const candidate of unlocked) {
    // A row with no password is an invitation that has not been accepted, not
    // an account — see lib/invitations.ts. Checked before bcrypt rather than
    // left to it: `compare` against a null hash is not a comparison anybody
    // should be relying on to return false.
    if (candidate.password === null) continue
    if (await bcrypt.compare(password, candidate.password)) opened.push(candidate)
  }

  if (opened.length === 0) {
    if (audit) {
      await Promise.all(
        unlocked.map((user) =>
          recordAudit({
            hospitalId: user.hospitalId,
            userId: user.id,
            action: AUDIT_ACTIONS.LOGIN_FAILED_PASSWORD,
            entityType: 'User',
            entityId: user.id,
            ...context,
          })
        )
      )
    }
    return { status: 'invalid' }
  }

  const usable = opened.filter((u) => u.isActive && u.hospital?.isActive)

  if (usable.length === 0) {
    // Report the more specific of the two reasons. A deactivated account is the
    // clinic's own decision about a person; a deactivated clinic is ours about
    // the clinic, and the two want different follow-up.
    const blocked = opened[0]
    const reason = !blocked.isActive
      ? AUDIT_ACTIONS.LOGIN_FAILED_USER_INACTIVE
      : AUDIT_ACTIONS.LOGIN_FAILED_CLINIC_INACTIVE
    if (audit) {
      await recordAudit({
        hospitalId: blocked.hospitalId,
        userId: blocked.id,
        action: reason,
        entityType: 'User',
        entityId: blocked.id,
        ...context,
      })
    }
    return { status: !blocked.isActive ? 'user_inactive' : 'clinic_inactive' }
  }

  if (usable.length > 1) {
    return {
      status: 'ambiguous',
      clinics: usable
        .map((u) => ({ slug: u.hospital!.slug, name: u.hospital!.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  const user = usable[0]
  const settings = settingsByClinic.get(user.hospitalId)!

  /**
   * An expired password does not refuse the sign-in; it forces the next step.
   *
   * Turning somebody away at the door would leave them no way back in but to
   * telephone an administrator, and there is no self-service reset in this
   * application yet. Signing them in and sending them straight to the
   * change-password form achieves what the policy is for without making the
   * clinic's own staff dependent on somebody else to do their job.
   */
  const expired = passwordHasExpired(user.passwordChangedAt, settings.passwordExpiryDays)

  if (audit) {
    await recordAudit({
      hospitalId: user.hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      entityType: 'User',
      entityId: user.id,
      // The role is worth having on the entry: reading the trail later, "who
      // could do what at the time" is the question being asked.
      newValues: { role: user.role, clinicalRole: user.clinicalRole },
      ...context,
    })
  }

  return {
    status: 'ok',
    identity: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      clinicalRole: user.clinicalRole ?? undefined,
      staffId: user.staff?.id,
      hospitalId: user.hospitalId,
      isHospitalAdmin: user.isHospitalAdmin,
      isPlatformAdmin: user.isPlatformAdmin,
      image: user.image,
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
      mustChangePassword: user.mustChangePassword || expired,
    },
  }
}
