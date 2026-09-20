/**
 * Per-user data scoping — "own patients only".
 *
 * Specification §10 asks for it and it had never been built: every role holding
 * `patients:read` could open the entire register, so a locum covering two days
 * a month could read every record the practice had ever created, and nothing
 * anywhere recorded that they had.
 *
 * ## What "own" means
 *
 * A dentist's own patients are the ones they are actually involved with:
 *
 *   - somebody they have an appointment with, now or at any time;
 *   - somebody they have treated;
 *   - somebody whose chart or periodontal examination they recorded.
 *
 * The first is what makes this usable rather than a lock-out. A patient booked
 * in for tomorrow morning is in the dentist's list this afternoon, which is
 * when they want to read the history — a rule based only on past treatment
 * would hide the record right up until the moment it stopped being needed.
 *
 * ## Who it applies to
 *
 * Dentists, and only dentists. Not the front desk, management, accounts or
 * administration, whose jobs are the whole register by definition — you cannot
 * book, bill or audit a practice through a keyhole. And not dental assistants:
 * nothing in the schema connects an assistant to an appointment (it names the
 * dentist), so the only link an assistant could have is a chart entry they
 * recorded, and they cannot record one without first opening a record they
 * would not be allowed to open. A rule that starts every assistant with an
 * empty register and no way out of it is not a narrower permission, it is a
 * broken one.
 *
 * Somebody holding a dentist role *and* an unrestricted one — the owner who
 * also treats — is not scoped. Their other role already carries the whole
 * register, and taking it away because of a second role would be a demotion
 * nobody asked for.
 *
 * ## Off by default
 *
 * A single-dentist practice, which is most of them, would notice only the
 * missing rows. It is a setting: Settings → Security.
 */
import type { Prisma } from '@prisma/client'
import type { RoleHolder } from '@/lib/rbac'

/** Roles the restriction applies to. See the note above on assistants. */
export const SCOPED_ROLES = ['DOCTOR'] as const

/** Who is asking, in the two identities the relevant rows are keyed by. */
export interface ScopeActor {
  /** `User.id` — what a chart entry and a perio exam record as their author. */
  userId: string
  /** `Staff.id` — what an appointment and a treatment record as the dentist. */
  staffId?: string | null
  role?: string | null
  clinicalRole?: string | null
}

/**
 * Is this person restricted to their own patients?
 *
 * Restricted only when *every* role they hold is a scoped one. Holding any
 * other role means holding that role's access.
 */
export function isScoped(
  actor: RoleHolder & { role?: string | null },
  restrictToOwnPatients: boolean
): boolean {
  if (!restrictToOwnPatients) return false

  const held = [actor.role, actor.clinicalRole].filter(Boolean) as string[]
  if (held.length === 0) return false

  return held.every((role) => (SCOPED_ROLES as readonly string[]).includes(role))
}

/**
 * Could this person ever be scoped, whatever the setting says?
 *
 * Asked first so that the setting is only read for the roles it can apply to.
 * Every other role — the front desk loading the register all day — pays
 * nothing for a feature that can never restrict them.
 */
export function mayBeScoped(actor: RoleHolder & { role?: string | null }): boolean {
  return isScoped(actor, true)
}

/**
 * The `where` fragment that narrows a patient query to this person's own, or
 * null when they are not restricted.
 *
 * Returned as a fragment to be ANDed into an existing query rather than applied
 * here, because every caller already has a tenant filter and its own search and
 * sort, and a helper that owned the whole query would have to know about all of
 * them.
 *
 * A dentist with no `Staff` row — an account created but never given a staff
 * profile — matches on authorship alone. Not on nothing: returning an
 * impossible filter would show an empty register with no explanation, and
 * returning no filter would quietly defeat the setting.
 */
export function ownPatientsFilter(actor: ScopeActor): Prisma.PatientWhereInput {
  const or: Prisma.PatientWhereInput[] = [
    { dentalChart: { some: { recordedById: actor.userId } } },
    { perioExams: { some: { recordedById: actor.userId } } },
  ]

  if (actor.staffId) {
    or.unshift(
      { appointments: { some: { doctorId: actor.staffId } } },
      { treatments: { some: { doctorId: actor.staffId } } }
    )
  }

  return { OR: or }
}

/**
 * The fragment to AND into a patient query for this person, or null.
 *
 * The one call every route makes: it reads the setting, decides whether this
 * person is scoped, and hands back either a filter or nothing.
 */
export function patientScopeFilter(
  actor: ScopeActor,
  restrictToOwnPatients: boolean
): Prisma.PatientWhereInput | null {
  if (!isScoped(actor, restrictToOwnPatients)) return null
  return ownPatientsFilter(actor)
}

/** What the person is told when a record exists but is not theirs. */
export const OUT_OF_SCOPE_MESSAGE =
  'This patient is not one of yours. Your clinic limits each dentist to the patients they treat.'
