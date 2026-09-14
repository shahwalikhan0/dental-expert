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

  /// A lab case moving through the laboratory (§5.8). Was its own
  /// `LabOrderHistory` table recording exactly this and nothing else.
  LAB_ORDER_STATUS_CHANGED: 'lab_order.status_changed',

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
