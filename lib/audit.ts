import { prisma } from '@/lib/prisma'

/**
 * Audit trail — spec §10: "Record audit history for login, patient record
 * access where supported, changes to clinical/financial data, refunds, stock
 * adjustments, and configuration changes."
 *
 * The `AuditLog` model existed but almost nothing wrote to it. This covers the
 * two ends the clinic asked for: **who signed in** and **who changed how the
 * clinic runs**. Clinical amendments (FR-007) and discount/refund approvals
 * (FR-013/014) keep their own purpose-built trails, which record more than a
 * generic log could and are queryable alongside the record they belong to.
 *
 * Two rules hold throughout:
 *
 *  1. **Writing an audit entry never breaks the thing being audited.** A failed
 *     log write is reported to the server console and swallowed. Refusing a
 *     login because the audit table was unreachable would turn a logging
 *     problem into an outage.
 *  2. **Secrets are never recorded.** Settings hold SMS API keys, SMTP
 *     passwords and payment-gateway secrets. An audit log is a plaintext
 *     column readable by anyone with `audit:read`, so it records *that* a
 *     secret changed, never what it changed to.
 */

export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'login.success',
  /** Right email, wrong password. */
  LOGIN_FAILED_PASSWORD: 'login.failed.password',
  /** A deactivated account — spec §10 wants deactivation to be a real control. */
  LOGIN_FAILED_USER_INACTIVE: 'login.failed.user_inactive',
  LOGIN_FAILED_CLINIC_INACTIVE: 'login.failed.clinic_inactive',

  /// Refused before the password was even checked, because the account had
  /// already used up its attempts (Settings → Security). Distinct from a wrong
  /// password on purpose: a run of lockouts is somebody being kept out, a run
  /// of wrong passwords is somebody trying, and the trail should not merge the
  /// two.
  LOGIN_BLOCKED_LOCKOUT: 'login.blocked.lockout',
  /// Refused because of where it came from — the address allow/block lists.
  LOGIN_BLOCKED_IP: 'login.blocked.ip',

  /// Somebody changed their own password, or an administrator changed theirs.
  /// The entry never carries the password, old or new; see rule 2 above.
  PASSWORD_CHANGED: 'user.password.changed',

  /// A reset asked for from the sign-in page. Nobody is signed in, so it is
  /// recorded against no user — the trail should not read as though an
  /// administrator did it.
  PASSWORD_RESET_REQUESTED: 'user.password.reset_requested',
  /// A reset carried through. Distinct from PASSWORD_CHANGED, which is somebody
  /// changing their own while signed in: this one happened without a session
  /// and is the entry worth looking at twice.
  PASSWORD_RESET_COMPLETED: 'user.password.reset_completed',

  /// Spec §10 asks for "patient record access where supported". Opening a
  /// record is the access — a list of names is not, and logging every list
  /// would bury the entries that matter under a row per page of the register.
  /// See lib/record-access.ts for what is recorded and what is deliberately
  /// not.
  PATIENT_RECORD_VIEWED: 'patient.record.viewed',
  /// The clinical chart, treatment history and notes specifically, which §4
  /// withholds from the front desk and §10 singles out.
  CLINICAL_RECORD_VIEWED: 'clinical.record.viewed',

  /// A booking made by a patient on the clinic's public page, rather than by
  /// the desk. Nobody was signed in, so there is no user to attribute it to,
  /// and the trail should say that rather than leave it looking like staff
  /// work.
  PUBLIC_BOOKING_CREATED: 'booking.public.created',

  /// The clinic issued, reissued or withdrew a patient's portal sign-in.
  /// Attributed to the staff member who decided, because that is the person
  /// who will be asked why a patient could — or could not — read their record.
  /// The password itself is never recorded; only that one was set.
  PORTAL_ACCESS_GRANTED: 'portal.access.granted',
  PORTAL_ACCESS_REVOKED: 'portal.access.revoked',
  PORTAL_PASSWORD_REISSUED: 'portal.password.reissued',

  /// A patient signing in to read their own record. No `userId` — there is no
  /// staff member here, and the trail should say so rather than leave it
  /// looking like desk work. The patient is the entity.
  PORTAL_LOGIN_SUCCESS: 'portal.login.success',
  PORTAL_LOGIN_FAILED: 'portal.login.failed',
  /// The patient chose their own password, replacing the one the desk issued.
  PORTAL_PASSWORD_CHANGED: 'portal.password.changed',

  /// Two records for one person, made one. Irreversible in practice — the
  /// clinical history has moved — so it is recorded with both patient IDs and
  /// who decided.
  PATIENTS_MERGED: 'patient.merged',

  /// A lab case moving through the laboratory (§5.8). Was its own
  /// `LabOrderHistory` table recording exactly this and nothing else.
  LAB_ORDER_STATUS_CHANGED: 'lab_order.status_changed',

  /// Goods booked in against a purchase order (§5.7). Receipt moves stock and
  /// commits the clinic to paying for it, and it is the one inventory event
  /// nobody can reconstruct from the stock level afterwards.
  GOODS_RECEIVED: 'purchase_order.received',
  PURCHASE_ORDER_PLACED: 'purchase_order.placed',
  PURCHASE_ORDER_CANCELLED: 'purchase_order.cancelled',

  /// Somebody signed in and then reached for something their role does not
  /// carry. UAT-12 asks that the attempt be "handled correctly", and §10 asks
  /// for an audit history: a refusal that leaves no trace tells nobody that
  /// anyone tried. Recorded for the authenticated-but-forbidden case only —
  /// an unauthenticated request has no user to attribute and no clinic to file
  /// it under, and logging every one of those would be a denial-of-service
  /// against the audit table itself.
  ACCESS_DENIED: 'access.denied',

  /// FR-013 — who let a discount through, and on what grounds. The decision is
  /// kept on the invoice as well; this is what puts it in the one place an
  /// auditor reads end to end.
  DISCOUNT_APPROVED: 'invoice.discount.approved',
  DISCOUNT_REJECTED: 'invoice.discount.rejected',

  /// FR-014 — money leaving. The one financial movement that is not recoverable
  /// from the invoice arithmetic alone.
  REFUND_ISSUED: 'payment.refunded',

  /// FR-015 — the till. Opening records the float that went into the drawer;
  /// closing records what was counted against what was expected, and the
  /// variance. A closing is the record a missing Rs 500 is traced back to, so
  /// who signed it off belongs in the same trail as the money (finding 38).
  TILL_OPENED: 'cashier_session.opened',
  TILL_CLOSED: 'cashier_session.closed',

  /// Who settles a patient's bills changed. Recorded because it moves a
  /// balance onto somebody else's statement, and the person chased for the
  /// money afterwards is not the person who was chased before.
  GUARANTOR_CHANGED: 'patient.guarantor.changed',

  /// The recall list was worked: somebody selected patients and sent them a
  /// message. FR-019's paper trail for a send nobody else initiated.
  RECALL_CONTACTED: 'recare.contacted',

  /// Attendance was marked or altered. One entry per save, naming who and
  /// which days — the register row itself says who last touched each day, and
  /// this is what shows the value it had before.
  ATTENDANCE_MARKED: 'attendance.marked',

  /// A walk-in became a patient, or was written off. Both are decisions about
  /// somebody's record that the clinic should be able to account for later.
  VISITOR_CONVERTED: 'visitor.converted',
  VISITOR_DISCARDED: 'visitor.discarded',

  /// Money and record changes (bug report 12 Oct, finding 24). Before these,
  /// the trail recorded refunds and discount decisions and nothing else about
  /// money: an invoice could be raised, cut, cancelled or deleted and a payment
  /// taken without a line here.
  INVOICE_CREATED: 'invoice.created',
  INVOICE_UPDATED: 'invoice.updated',
  INVOICE_CANCELLED: 'invoice.cancelled',
  INVOICE_DELETED: 'invoice.deleted',
  PAYMENT_RECORDED: 'payment.recorded',

  /// A signature attests to a clinical record; a prescription is a clinical
  /// act with legal weight. Both are recorded with who did them.
  TREATMENT_SIGNED: 'treatment.signed',
  CLINICAL_NOTE_SIGNED: 'clinical_note.signed',
  PRESCRIPTION_CREATED: 'prescription.created',
  TREATMENT_DELETED: 'treatment.deleted',

  PATIENT_DEACTIVATED: 'patient.deactivated',
  PATIENT_REACTIVATED: 'patient.reactivated',

  APPOINTMENT_CANCELLED: 'appointment.cancelled',
  APPOINTMENT_DELETED: 'appointment.deleted',

  STAFF_CREATED: 'staff.created',
  STAFF_UPDATED: 'staff.updated',
  STAFF_DEACTIVATED: 'staff.deactivated',
  STAFF_REACTIVATED: 'staff.reactivated',

  PROCEDURE_DEACTIVATED: 'procedure.deactivated',
  INVENTORY_ITEM_DELETED: 'inventory_item.deleted',
  SUPPLIER_DELETED: 'supplier.deleted',
  STOCK_ADJUSTED: 'stock.adjusted',

  SETTINGS_UPDATED: 'settings.updated',
  CLINIC_UPDATED: 'settings.clinic.updated',
  SECURITY_UPDATED: 'settings.security.updated',
  COMMUNICATIONS_UPDATED: 'settings.communications.updated',
  PAYMENT_GATEWAY_UPDATED: 'settings.payment_gateway.updated',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export const REDACTED = '[redacted]'

/**
 * Field and setting names whose values must never reach the log.
 *
 * Matched on the name rather than the value, because a value cannot be
 * recognised as a secret by looking at it. Deliberately broad: a false
 * positive costs one redacted line in an audit entry, a false negative writes
 * a live API key into a table that managers can read.
 *
 * Anything *ending* in "key" is caught rather than listing the prefixes.
 * An earlier version enumerated `apiKey` and `authKey`, and let
 * `paytmMerchantKey` through — the gateway columns are named for their
 * provider, so the prefix is exactly the part that cannot be predicted.
 */
const SECRET_NAME = /pass(word)?|secret|token|salt|credential|private|key$|[-_.]key(?=[-_.]|$)/i

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name)
}

/** Replace secret-named values, keeping the key so the change is still visible. */
export function redactValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    out[key] = isSecretName(key) ? REDACTED : value
  }
  return out
}

/**
 * Only the fields that actually changed, redacted.
 *
 * Recording the whole settings object on every save would bury the one line
 * that moved, and would re-record every secret each time.
 */
export function diffValues(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] } {
  const changed: string[] = []
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}

  for (const key of Object.keys(after)) {
    const from = before[key]
    const to = after[key]
    // Compared as strings: settings arrive as form values and are stored as
    // text, so 30 and '30' are the same setting.
    if (String(from ?? '') === String(to ?? '')) continue
    changed.push(key)
    b[key] = isSecretName(key) ? REDACTED : (from ?? null)
    a[key] = isSecretName(key) ? REDACTED : (to ?? null)
  }

  return { before: b, after: a, changed }
}

export interface AuditEntry {
  hospitalId: string
  userId?: string | null
  action: AuditAction | string
  entityType: string
  entityId: string
  oldValues?: Record<string, unknown> | null
  newValues?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Write one audit entry. Never throws.
 *
 * Deliberately not awaited-and-checked by callers: the operation being audited
 * has already happened or already failed, and the entry is a record of it, not
 * a precondition for it.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        hospitalId: entry.hospitalId,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldValues: entry.oldValues ? JSON.stringify(redactValues(entry.oldValues)) : null,
        newValues: entry.newValues ? JSON.stringify(redactValues(entry.newValues)) : null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    })
  } catch (err) {
    // See rule 1 at the top of this file.
    console.error('Failed to write audit entry:', entry.action, err)
  }
}

/**
 * Caller IP and user agent from a request.
 *
 * `x-forwarded-for` carries a list when there are proxies in front; the first
 * entry is the client. The value is attacker-controlled and is recorded as
 * evidence, not relied upon for any decision.
 */
export function requestContext(headers: Headers | null | undefined): {
  ipAddress: string | null
  userAgent: string | null
} {
  if (!headers) return { ipAddress: null, userAgent: null }
  const forwarded = headers.get('x-forwarded-for')
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || null,
    userAgent: headers.get('user-agent'),
  }
}
