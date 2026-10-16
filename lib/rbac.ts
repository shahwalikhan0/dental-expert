/**
 * Role-based access control — the single source of truth.
 *
 * Before this existed, authorisation was scattered three ways: a route map in
 * middleware.ts that only gated browser navigation, `requireAuthAndRole([...])`
 * with hand-written role arrays in 59 route files, and inline
 * `session.user.role !== 'ADMIN'` checks in 30 more. 66 route files had no check
 * at all, so any signed-in staff member could call them directly — the
 * middleware map never ran for `/api/*`, which means it was only ever hiding
 * menu items.
 *
 * The fix is to name the *capability* rather than the roles. A route says what
 * it needs (`clinical:write`); this file decides who has it. That way the
 * "Restricted From" column of specification §4 is stated once, in one table
 * that can be read end to end and tested directly, instead of being implied by
 * 155 scattered role arrays that drift apart the moment someone adds a role.
 *
 * Adding a Role enum value grants nothing until it appears in ROLE_PERMISSIONS.
 */
import type { Role } from '@prisma/client'

/**
 * Every capability in the system.
 *
 * Granularity follows the spec's own seams: the modules of §5 for the broad
 * reads and writes, and individual entries for the operations §4 and the FR
 * register single out as needing elevated authorisation (discounts, refunds,
 * daily closing, export, audit).
 */
export const PERMISSIONS = [
  // Patients (§5.1) — demographics, contact, medical alerts, documents
  'patients:read',
  'patients:write',
  'patients:delete',

  // Clinical record & charting (§5.3), treatment planning (§5.4),
  // prescriptions (§5.5)
  'clinical:read',
  'clinical:write',
  'clinical:sign', // FR-007: lock a note. A clinical act, tied to a provider.
  // Destroying a clinical record, as opposed to amending it. Held by the
  // administrator alone: §10 lists deletion among the operations that require
  // elevated authorisation, and FR-007 wants amendments preserved rather than
  // overwritten.
  'clinical:delete',

  // Appointments & queue (§5.2)
  'appointments:read',
  'appointments:write',

  // Billing & payments (§5.6)
  'billing:read',
  'billing:write', // itemised invoice, receipt, take payment (FR-011, FR-012)
  'billing:discount', // FR-013: approve a discount above the threshold
  'billing:refund', // FR-014: authorise a refund
  'billing:closing', // FR-015: daily cashier reconciliation
  'billing:config', // fee schedules, tax settings, payment gateways
  // Deleting an invoice or a payment outright. Separate from `billing:refund`:
  // a refund leaves a traceable reversal (FR-014), a delete does not.
  'billing:void',

  // Inventory & procurement (§5.7)
  'inventory:read',
  'inventory:write',

  // Dental laboratory cases (§5.8)
  'lab:read',
  'lab:write',

  // Reporting & analytics (§5.11)
  'reports:operational',
  'reports:financial',
  'reports:export', // FR-022: bulk export is separately restricted by §10

  // Staff & administration (§5.10)
  'staff:read',
  'staff:write', // create/edit staff, issue invites
  'staff:hr', // performance figures for an individual staff member
  // The attendance register. Kept by the people who run the clinic, and read by
  // nobody else — a colleague's absences are not reception's business. Split
  // into read and write only so a clinic whose subscription has lapsed can
  // still read and export its register, as it can every other record.
  'attendance:read',
  'attendance:write', // mark a day, and alter one already marked

  // Master data (§5.10, FR-025): the procedure/fee catalogue, medication list,
  // clinic holidays. Split from `settings:read` because almost every role has
  // to *read* these to do its job — reception builds an invoice from the fee
  // list, a dentist plans treatment from the procedure catalogue — while
  // changing them stays an administrative act under `settings:write`.
  'masters:read',

  // Configuration and oversight
  'settings:read',
  'settings:write', // FR-025: configurable masters
  'audit:read', // FR-021
  'users:manage', // accounts, roles, deactivation

  // Patient communication (§5.9)
  'communications:read',
  'communications:write',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * The capabilities that only *look* at data.
 *
 * Used by the tenancy layer: a clinic whose subscription has lapsed keeps
 * every one of these and loses the rest. Locking a practice out of its own
 * patient records over an unpaid invoice would make the platform a
 * hostage-taker — and in a jurisdiction with a records-retention duty, an
 * unlawful one. They can still read, report and export; they cannot write.
 *
 * Listed rather than derived from the `:read` suffix, because three of them do
 * not carry it: the two report capabilities only look, and `reports:export`
 * takes data *out*, which a lapsed tenant must keep being able to do.
 * A test asserts this list stays exhaustive over PERMISSIONS.
 */
export const READ_ONLY_PERMISSIONS = [
  'patients:read',
  'clinical:read',
  'appointments:read',
  'billing:read',
  'inventory:read',
  'lab:read',
  'reports:operational',
  'reports:financial',
  'reports:export',
  'staff:read',
  'attendance:read',
  'masters:read',
  'settings:read',
  'audit:read',
  'communications:read',
] as const satisfies readonly Permission[]

const READ_ONLY = new Set<string>(READ_ONLY_PERMISSIONS)

/** Whether holding this capability lets someone change anything. */
export function isReadOnlyPermission(permission: Permission | string): boolean {
  return READ_ONLY.has(permission)
}

/**
 * Specification §4, expressed as code.
 *
 * Each entry below quotes the spec's own "Typical Access" and "Restricted From"
 * so the mapping can be checked against the document without switching windows.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  /**
   * System Administrator — "All configuration, users, permissions, audit tools".
   * Restricted from "clinical decisions unless also a clinical user".
   *
   * Everything except `clinical:sign`. An administrator can read and correct a
   * clinical record, but signing one attests to a clinical finding as the
   * treating provider, and FR-007 makes that signature the thing the audit
   * trail hangs off. Granting it to an account whose job is system
   * configuration would make the signature meaningless. An administrator who
   * is also a dentist gets a DOCTOR account for their clinical work.
   */
  ADMIN: [
    'patients:read',
    'patients:write',
    'patients:delete',
    'clinical:read',
    'clinical:write',
    'clinical:delete',
    'appointments:read',
    'appointments:write',
    'billing:read',
    'billing:write',
    'billing:discount',
    'billing:refund',
    'billing:closing',
    'billing:config',
    'billing:void',
    'inventory:read',
    'inventory:write',
    'lab:read',
    'lab:write',
    'reports:operational',
    'reports:financial',
    'reports:export',
    'staff:read',
    'staff:write',
    'staff:hr',
    'attendance:read',
    'attendance:write',
    'masters:read',
    'settings:read',
    'settings:write',
    'audit:read',
    'users:manage',
    'communications:read',
    'communications:write',
  ],

  /**
   * Clinic Manager — "Dashboards, operations, approvals, reports".
   * Restricted from "changing signed clinical notes without controlled process".
   *
   * The approver role: this is who FR-013 and FR-014 escalate to. Reads the
   * clinical record for oversight but cannot write or sign it, which is what
   * "without controlled process" means in practice.
   *
   * `staff:write` and `settings:write` since 29 September 2026: the clinic
   * runs as the manager's practice, and its manager could see the Add Staff,
   * Invite and Data Import screens and was refused on every one. What stays
   * with the administrator is the administrator account itself — see
   * `staffChangeRefusal` below — and `users:manage`.
   */
  CLINIC_MANAGER: [
    'patients:read',
    'patients:write',
    'clinical:read',
    'appointments:read',
    'appointments:write',
    'billing:read',
    'billing:write',
    'billing:discount',
    'billing:refund',
    'billing:closing',
    // Cancelling an invoice (invoice review 6.1). The list offered managers
    // "Cancel invoice" and the route refused them; an invoice raised in error
    // is the manager's to dispose of, not only the administrator's.
    'billing:void',
    'inventory:read',
    'lab:read',
    'reports:operational',
    'reports:financial',
    'reports:export',
    'staff:read',
    'staff:write',
    'staff:hr',
    'attendance:read',
    'attendance:write',
    'masters:read',
    'settings:read',
    'settings:write',
    'audit:read',
    'communications:read',
    'communications:write',
  ],

  /**
   * Dentist — "Clinical record, charting, treatment plans, prescriptions".
   * Restricted from "system admin and financial configuration".
   *
   * `billing:read` but not `billing:config`: a dentist has to see what their
   * treatment was billed at to discuss a plan with the patient, and the spec
   * withholds financial *configuration*, not financial visibility.
   */
  DOCTOR: [
    'patients:read',
    'patients:write',
    'clinical:read',
    'clinical:write',
    'clinical:sign',
    'appointments:read',
    'appointments:write',
    'billing:read',
    'inventory:read',
    'lab:read',
    'lab:write',
    'reports:operational',
    'staff:read',
    'masters:read',
    'communications:read',
  ],

  /**
   * Dental Assistant — "Assigned patient/chair support, selected notes/tasks".
   * Restricted from "billing settings, management-only reports".
   *
   * Writes clinical records (preparing the visit, recording materials used)
   * but cannot sign them — the signature belongs to the dentist. Holds
   * `inventory:write` because chair-side consumption is recorded by whoever is
   * at the chair (§5.7, procedure-linked consumption).
   */
  DENTAL_ASSISTANT: [
    'patients:read',
    'clinical:read',
    'clinical:write',
    'appointments:read',
    'appointments:write',
    'inventory:read',
    'inventory:write',
    'lab:read',
    'lab:write',
    'reports:operational',
    'masters:read',
    'communications:read',
  ],

  /**
   * Front Desk / Reception — "Patients, appointments, queue, basic billing".
   * Restricted from "clinical notes, restricted finance settings".
   *
   * No `clinical:read` at all — this is the sharpest line in §4 and the one
   * the codebase was breaking. Medical alerts still reach the front desk,
   * because FR-003 alerts live on the patient record under `patients:read`,
   * not in the clinical chart. "Basic billing" is read and write; discounts,
   * refunds, closing and configuration are not basic.
   */
  RECEPTIONIST: [
    'patients:read',
    'patients:write',
    'appointments:read',
    'appointments:write',
    'billing:read',
    'billing:write',
    'lab:read',
    'reports:operational',
    'masters:read',
    'communications:read',
    'communications:write',
  ],

  /**
   * Accounts / Cashier — "Invoices, receipts, balances, daily closure".
   * Restricted from "clinical details beyond minimum needed".
   *
   * `patients:read` is the "minimum needed" — a name and contact to raise an
   * invoice against. No clinical permission of any kind. Processes refunds
   * (FR-014) but does not approve discounts above the threshold: FR-013 needs
   * an approver who is not the person entering the transaction, which is the
   * manager or the administrator.
   */
  ACCOUNTANT: [
    'patients:read',
    'billing:read',
    'billing:write',
    'billing:refund',
    'billing:closing',
    'billing:config',
    'reports:financial',
    'reports:export',
    'masters:read',
    'communications:read',
  ],

  /**
   * Inventory / Store — "Items, suppliers, stock, purchase/issue records".
   * Restricted from "clinical notes and patient finance".
   *
   * The narrowest role. No patient access of any kind: stock movements
   * reference procedures and batches, never a named patient.
   */
  INVENTORY_STAFF: ['inventory:read', 'inventory:write', 'masters:read'],

  /**
   * Dental laboratory coordination (§5.8). Not one of the seven roles in §4 —
   * it existed upstream and is kept because §5.8 is a real module with an
   * external counterparty.
   *
   * `patients:read` because a lab case is identified by the patient it belongs
   * to. No clinical or billing access.
   */
  LAB_TECH: ['patients:read', 'lab:read', 'lab:write', 'masters:read'],
}

/**
 * The roles a person actually holds.
 *
 * Almost always one. The exception is the owner who also treats patients: §4
 * gives the administrator configuration and oversight, and deliberately
 * withholds `clinical:sign` so that a signature attests as the treating
 * provider (FR-007). One account, one role would force that person to choose
 * between running the clinic and signing their own notes.
 */
export interface RoleHolder {
  role?: string | null
  /** Optional second role. Capabilities are the union of the two. */
  clinicalRole?: string | null
}

/**
 * Roles that may be held as a *second* role.
 *
 * Clinical only, and by design. The point of a secondary role is to let a
 * clinician who also administers (or administers and also treats) do both
 * jobs from one account. Allowing, say, a secondary ACCOUNTANT would turn this
 * into a general "grant extra permissions" field, which is the permission
 * matrix we deliberately did not build.
 */
export const SECONDARY_ROLES = ['DOCTOR', 'DENTAL_ASSISTANT'] as const satisfies readonly Role[]

export function isAssignableSecondaryRole(value: string | undefined | null): boolean {
  return !!value && (SECONDARY_ROLES as readonly string[]).includes(value)
}

/** Does this role hold this capability? */
export function can(role: string | undefined | null, permission: Permission): boolean {
  if (!role) return false
  const granted = ROLE_PERMISSIONS[role as Role]
  if (!granted) return false
  return granted.includes(permission)
}

/**
 * Does this person hold this capability, across every role they have?
 *
 * This is what authorisation should call. `can()` takes a single role and is
 * the primitive underneath; using it directly on a session silently ignores a
 * secondary role.
 */
export function holderCan(holder: RoleHolder | undefined | null, permission: Permission): boolean {
  if (!holder) return false
  return can(holder.role, permission) || can(holder.clinicalRole, permission)
}

/** Every capability a person holds, across their roles. */
export function permissionsForHolder(holder: RoleHolder | undefined | null): Permission[] {
  if (!holder) return []
  const held = new Set<Permission>(permissionsFor(holder.role))
  for (const p of permissionsFor(holder.clinicalRole)) held.add(p)
  return [...held]
}

/** Does this role hold *every* listed capability? */
export function canAll(role: string | undefined | null, permissions: Permission[]): boolean {
  return permissions.every((p) => can(role, p))
}

/** Does this role hold *any* of the listed capabilities? */
export function canAny(role: string | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p))
}

/** Every capability a role holds. Sent to the client to drive menu visibility. */
export function permissionsFor(role: string | undefined | null): Permission[] {
  if (!role) return []
  return [...(ROLE_PERMISSIONS[role as Role] ?? [])]
}

/**
 * Which capability each dashboard section needs, for middleware.
 *
 * Longest prefix wins, so `/billing/reports` is matched before `/billing`.
 * This is navigation gating only — it stops a user landing on a page that
 * would fail every request it makes. The API routes enforce their own
 * permissions independently, because middleware never runs for them and a
 * client can always call the API directly.
 */
export const ROUTE_PERMISSIONS: ReadonlyArray<readonly [string, Permission]> = [
  ['/dashboard', 'reports:operational'],
  ['/video', 'appointments:read'],
  ['/devices', 'settings:read'],
  ['/settings/audit', 'audit:read'],
  // The procedure/fee catalogue lives under /settings by URL, but it is master
  // data, not configuration — §5.10 and the `masters:read` comment above say a
  // dentist plans treatment *from* this catalogue. Inheriting `settings:read`
  // from the prefix below locked out every DOCTOR, who holds `masters:read`
  // and not `settings:read`, so the one role that reads it most could not open
  // it. Writing is still `settings:write`, enforced by the API and mirrored by
  // the page, which hides the editing controls it knows the server will refuse.
  ['/settings/procedures', 'masters:read'],
  ['/settings', 'settings:read'],
  ['/staff', 'staff:read'],
  ['/attendance', 'attendance:read'],
  ['/inventory', 'inventory:read'],
  ['/billing/receivables', 'reports:financial'],
  ['/billing/reports', 'reports:financial'],
  ['/billing', 'billing:read'],
  ['/lab', 'lab:read'],
  ['/treatments', 'clinical:read'],
  ['/prescriptions', 'clinical:read'],
  // Its only data is `/api/audit-log`, which needs `audit:read`. Inheriting
  // `reports:operational` from the prefix below put it in the menu of the
  // dentist, the assistant and the front desk, who were refused and shown
  // "No audit logs found" — an empty history rather than a closed door.
  ['/reports/audit-log', 'audit:read'],
  ['/reports', 'reports:operational'],
  ['/communications', 'communications:read'],
  ['/crm', 'communications:read'],
  ['/patients', 'patients:read'],
  // A walk-in is somebody the clinic has seen but not registered, so it is the
  // patient register's capability that governs them.
  ['/walk-ins', 'patients:read'],
  ['/recare', 'appointments:read'],
  ['/appointments', 'appointments:read'],
  ['/sterilization', 'inventory:read'],
  /*
   * The drug catalogue is master data, like the procedure list above it: every
   * clinical role reads it to prescribe, and changing it is an administrative
   * act under `settings:write`, which the API enforces.
   *
   * It was gated on `clinical:read`, which is a different set of people than
   * the API serves in both directions. Reception, the accountant, inventory
   * staff and the lab technician all hold `masters:read` and could not open the
   * page at all; a dentist could open it and was shown Add, Edit and Delete
   * buttons that the API refuses, because `clinical:read` does not carry
   * `settings:write`.
   */
  ['/medications', 'masters:read'],
]

/**
 * The capability required to open a dashboard path, or null if the path is
 * open to any authenticated staff member (the dashboard landing page, chat,
 * onboarding, a user's own profile).
 */
export function permissionForRoute(pathname: string): Permission | null {
  let best: readonly [string, Permission] | null = null
  for (const entry of ROUTE_PERMISSIONS) {
    if (pathname === entry[0] || pathname.startsWith(entry[0] + '/')) {
      if (!best || entry[0].length > best[0].length) best = entry
    }
  }
  return best ? best[1] : null
}

/**
 * Where to send a user who cannot open the page they asked for.
 *
 * Not always `/dashboard`: INVENTORY_STAFF has no dashboard permission, so
 * redirecting there would bounce them between two forbidden pages forever.
 */
export function landingPageFor(who: string | RoleHolder | undefined | null): string {
  const holder: RoleHolder = typeof who === 'string' || who == null ? { role: who } : who
  if (holderCan(holder, 'reports:operational')) return '/dashboard'
  if (holderCan(holder, 'appointments:read')) return '/appointments'
  if (holderCan(holder, 'inventory:read')) return '/inventory'
  if (holderCan(holder, 'billing:read')) return '/billing'
  if (holderCan(holder, 'lab:read')) return '/lab'
  return '/settings/profile'
}

// ---------------------------------------------------------------------------
// Role presentation
//
// Labels and badge colours live here rather than in each page because they were
// previously duplicated across six files, each listing five roles. Adding the
// three roles of §4 to all six by hand is exactly the kind of edit that gets
// done in five places and forgotten in the sixth.
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  CLINIC_MANAGER: 'Clinic Manager',
  DOCTOR: 'Dentist',
  DENTAL_ASSISTANT: 'Dental Assistant',
  RECEPTIONIST: 'Front Desk',
  ACCOUNTANT: 'Accounts / Cashier',
  INVENTORY_STAFF: 'Inventory / Store',
  LAB_TECH: 'Lab Technician',
}

/** One line on what the role is for, shown beside the picker when assigning. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Full configuration, users, permissions and audit tools',
  CLINIC_MANAGER: 'Dashboards, operations, approvals and reports',
  DOCTOR: 'Clinical records, charting, treatment plans and prescriptions',
  DENTAL_ASSISTANT: 'Chair-side support, clinical notes and stock consumption',
  RECEPTIONIST: 'Registration, scheduling, queue and basic billing',
  ACCOUNTANT: 'Invoices, receipts, balances and daily closing',
  INVENTORY_STAFF: 'Items, suppliers, stock and purchase records',
  LAB_TECH: 'Dental laboratory cases and their status',
}

/**
 * Each role's colour: the tint of the sidebar and header for whoever is
 * signed in, and the colour of their badge everywhere else, so a screen says
 * whose it is at a glance and a shared front-desk PC left on the manager's
 * login looks wrong from across the room.
 *
 * There is no one standard to copy, so this borrows the conventions people
 * already read:
 *
 * - Dentist, blue: the ceil and navy of clinicians' scrubs, and the colour
 *   most healthcare software gives the clinician.
 * - Dental Assistant, teal: the chair-side support colour of most scrub
 *   colour codes. Next to the dentist's blue, but not to be confused with it.
 * - Front Desk, orange: warm and visible, the help-desk and "first point of
 *   contact" colour.
 * - Accounts / Cashier, green: money, in every ledger and banking app.
 * - Inventory / Store, yellow: the safety yellow of stores and warehouses
 *   (ISO 3864, ANSI Z535).
 * - Lab Technician, fuchsia: the purple of pathology and laboratory coding.
 * - Clinic Manager, violet: oversight and authority.
 * - Administrator, rose: the "careful, this account can change anything"
 *   red that consoles give elevated access.
 *
 * Eight hues spread round the wheel, so no two roles share one. Colour is
 * never the only signal: the header names the role as well (WCAG 1.4.1).
 *
 * `name` is what the user guide calls the colour. `badge` is literal
 * Tailwind classes (the build only sees whole strings). `light` and `dark` are
 * the same colour as HSL channels, for the tint: a shade darker on a light
 * page and lighter on a dark one, so it stays visible on both.
 */
export const ROLE_THEMES: Record<
  Role,
  { name: string; badge: string; light: string; dark: string }
> = {
  ADMIN: {
    name: 'Rose',
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300',
    light: '347 77% 50%',
    dark: '351 95% 71%',
  },
  CLINIC_MANAGER: {
    name: 'Violet',
    badge: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
    light: '262 83% 58%',
    dark: '255 92% 76%',
  },
  DOCTOR: {
    name: 'Blue',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
    light: '221 83% 53%',
    dark: '213 94% 68%',
  },
  DENTAL_ASSISTANT: {
    name: 'Teal',
    badge: 'bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300',
    light: '175 84% 32%',
    dark: '172 66% 50%',
  },
  RECEPTIONIST: {
    name: 'Orange',
    badge: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300',
    light: '21 90% 48%',
    dark: '27 96% 61%',
  },
  ACCOUNTANT: {
    name: 'Green',
    badge: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
    light: '142 76% 36%',
    dark: '142 69% 58%',
  },
  INVENTORY_STAFF: {
    name: 'Yellow',
    badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300',
    light: '45 93% 47%',
    dark: '50 98% 64%',
  },
  LAB_TECH: {
    name: 'Fuchsia',
    badge: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-300',
    light: '292 84% 49%',
    dark: '292 91% 73%',
  },
}

/** Tailwind classes for a role badge. */
export const ROLE_COLORS = Object.fromEntries(
  Object.entries(ROLE_THEMES).map(([role, theme]) => [role, theme.badge])
) as Record<Role, string>

/** Every role, in the order §4 lists them. Use for pickers and filters. */
export const ALL_ROLES = [
  'ADMIN',
  'CLINIC_MANAGER',
  'DOCTOR',
  'DENTAL_ASSISTANT',
  'RECEPTIONIST',
  'ACCOUNTANT',
  'INVENTORY_STAFF',
  'LAB_TECH',
] as const satisfies readonly Role[]

/**
 * Roles that may be handed out through an emailed invitation.
 *
 * ADMIN is absent on purpose. The clinic gets its administrator from signup,
 * and a second one should be a deliberate act in the staff screen by someone
 * already signed in — not something that can be granted to whoever happens to
 * open a link from an inbox.
 */
export const INVITABLE_ROLES = [
  'CLINIC_MANAGER',
  'DOCTOR',
  'DENTAL_ASSISTANT',
  'RECEPTIONIST',
  'ACCOUNTANT',
  'INVENTORY_STAFF',
  'LAB_TECH',
] as const satisfies readonly Role[]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value)
}

/**
 * Why `staff:write` alone may not make this change to an account, or null.
 *
 * `staff:write` is held by the clinic manager as well as the administrator.
 * Without this, it would be the administrator's powers under another name:
 * make anybody an administrator, or reset an administrator's password and sign
 * in as them. So the administrator role, and the accounts that hold it, need
 * `users:manage` — the administrator's own capability — to hand out or to act
 * on. Everything else about staff stays with `staff:write`.
 */
export function staffChangeRefusal(
  actor: RoleHolder | undefined | null,
  change: {
    /** The account's role now; absent when creating one. */
    currentRole?: string | null
    /** The role being given, if it changes. */
    newRole?: string | null
    resetsPassword?: boolean
    changesAccess?: boolean
  }
): string | null {
  if (holderCan(actor, 'users:manage')) return null
  if (change.newRole === 'ADMIN' && change.currentRole !== 'ADMIN') {
    return 'Only an administrator can make somebody an administrator'
  }
  const touchesAccount =
    (change.newRole && change.newRole !== change.currentRole) ||
    change.resetsPassword ||
    change.changesAccess
  if (change.currentRole === 'ADMIN' && touchesAccount) {
    return 'Only an administrator can change an administrator’s role, password or access'
  }
  return null
}

export function roleLabel(role: string | undefined | null): string {
  if (!role) return 'Unknown'
  return ROLE_LABELS[role as Role] ?? role
}

/**
 * Accessors rather than raw map exports.
 *
 * `Record<Role, string>` cannot be indexed by a plain `string`, and the role
 * on a session or a staff row arrives as one. These keep the maps exhaustive —
 * so adding a Role enum value is a compile error until it is given a label and
 * a colour — while staying usable from a component that only has a string.
 */
export function roleColor(role: string | undefined | null): string {
  if (!role) return 'bg-gray-100 text-gray-700'
  return ROLE_COLORS[role as Role] ?? 'bg-gray-100 text-gray-700'
}

/**
 * The role's colour as CSS custom properties, for the element the tinted
 * surfaces sit under. globals.css (`.role-tint`) picks `--role-light` or
 * `--role-dark` by theme. No role, or one this build does not know, gives
 * nothing, and the surfaces keep their plain glass.
 */
export function roleThemeStyle(role: string | undefined | null): Record<string, string> {
  const theme = role ? ROLE_THEMES[role as Role] : undefined
  if (!theme) return {}
  return { '--role-light': theme.light, '--role-dark': theme.dark }
}

export function roleDescription(role: string | undefined | null): string {
  if (!role) return ''
  return ROLE_DESCRIPTIONS[role as Role] ?? ''
}
