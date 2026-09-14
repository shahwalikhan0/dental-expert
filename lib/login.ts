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
  const candidates = await prisma.user.findMany({
    where: {
      email,
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

  const opened: typeof candidates = []
  for (const candidate of candidates) {
    if (await bcrypt.compare(password, candidate.password)) opened.push(candidate)
  }

  if (opened.length === 0) {
    if (audit) {
      await Promise.all(
        candidates.map((user) =>
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
    },
  }
}
