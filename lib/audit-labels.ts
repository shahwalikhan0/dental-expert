/**
 * How an audit entry reads on screen.
 *
 * The trail records `login.failed.password` and `settings.security.updated`,
 * which are good names for a database column and poor ones for a manager
 * scanning a page. Worse, the audit screen's own filter offered CREATE, UPDATE,
 * DELETE and LOGIN — four values that match no action this application has ever
 * written, so every one of them returned an empty list.
 *
 * So: one place that says what each action is called and which group it belongs
 * to, used by the badge and by the filter, so the two cannot disagree about
 * what exists.
 */
import { AUDIT_ACTIONS } from '@/lib/audit'

export const AUDIT_LABELS: Record<string, string> = {
  [AUDIT_ACTIONS.LOGIN_SUCCESS]: 'Signed in',
  [AUDIT_ACTIONS.LOGIN_FAILED_PASSWORD]: 'Wrong password',
  [AUDIT_ACTIONS.LOGIN_FAILED_USER_INACTIVE]: 'Deactivated account tried',
  [AUDIT_ACTIONS.LOGIN_FAILED_CLINIC_INACTIVE]: 'Deactivated clinic tried',
  [AUDIT_ACTIONS.LOGIN_BLOCKED_LOCKOUT]: 'Locked out',
  [AUDIT_ACTIONS.LOGIN_BLOCKED_IP]: 'Refused by address',
  [AUDIT_ACTIONS.PASSWORD_CHANGED]: 'Password changed',

  [AUDIT_ACTIONS.PATIENT_RECORD_VIEWED]: 'Patient record opened',
  [AUDIT_ACTIONS.CLINICAL_RECORD_VIEWED]: 'Clinical record opened',
  [AUDIT_ACTIONS.ACCESS_DENIED]: 'Refused — not permitted',

  [AUDIT_ACTIONS.DISCOUNT_APPROVED]: 'Discount approved',
  [AUDIT_ACTIONS.DISCOUNT_REJECTED]: 'Discount refused',
  [AUDIT_ACTIONS.REFUND_ISSUED]: 'Refund issued',

  [AUDIT_ACTIONS.VISITOR_CONVERTED]: 'Walk-in registered',
  [AUDIT_ACTIONS.VISITOR_DISCARDED]: 'Walk-in discarded',
  [AUDIT_ACTIONS.PUBLIC_BOOKING_CREATED]: 'Booked online',

  [AUDIT_ACTIONS.LAB_ORDER_STATUS_CHANGED]: 'Lab case moved',
  [AUDIT_ACTIONS.GOODS_RECEIVED]: 'Goods received',
  [AUDIT_ACTIONS.PURCHASE_ORDER_PLACED]: 'Purchase order placed',
  [AUDIT_ACTIONS.PURCHASE_ORDER_CANCELLED]: 'Purchase order cancelled',

  [AUDIT_ACTIONS.SETTINGS_UPDATED]: 'Settings changed',
  [AUDIT_ACTIONS.CLINIC_UPDATED]: 'Clinic details changed',
  [AUDIT_ACTIONS.SECURITY_UPDATED]: 'Security settings changed',
  [AUDIT_ACTIONS.COMMUNICATIONS_UPDATED]: 'Messaging settings changed',
  [AUDIT_ACTIONS.PAYMENT_GATEWAY_UPDATED]: 'Payment settings changed',
}

/**
 * The filter's groups.
 *
 * Grouped by the question somebody is asking of the trail rather than by the
 * module the action came from: "who has been signing in", "who has been reading
 * records", "who changed the money". An entry may belong to one group only, so
 * the counts add up.
 */
export const AUDIT_GROUPS: { key: string; label: string; actions: string[] }[] = [
  {
    key: 'sign-in',
    label: 'Signing in',
    actions: [
      AUDIT_ACTIONS.LOGIN_SUCCESS,
      AUDIT_ACTIONS.LOGIN_FAILED_PASSWORD,
      AUDIT_ACTIONS.LOGIN_FAILED_USER_INACTIVE,
      AUDIT_ACTIONS.LOGIN_FAILED_CLINIC_INACTIVE,
      AUDIT_ACTIONS.LOGIN_BLOCKED_LOCKOUT,
      AUDIT_ACTIONS.LOGIN_BLOCKED_IP,
      AUDIT_ACTIONS.PASSWORD_CHANGED,
    ],
  },
  {
    key: 'record-access',
    label: 'Records read',
    actions: [AUDIT_ACTIONS.PATIENT_RECORD_VIEWED, AUDIT_ACTIONS.CLINICAL_RECORD_VIEWED],
  },
  {
    key: 'refused',
    label: 'Refusals',
    actions: [AUDIT_ACTIONS.ACCESS_DENIED],
  },
  {
    key: 'money',
    label: 'Money',
    actions: [
      AUDIT_ACTIONS.DISCOUNT_APPROVED,
      AUDIT_ACTIONS.DISCOUNT_REJECTED,
      AUDIT_ACTIONS.REFUND_ISSUED,
    ],
  },
  {
    key: 'patients',
    label: 'Patients',
    actions: [
      AUDIT_ACTIONS.VISITOR_CONVERTED,
      AUDIT_ACTIONS.VISITOR_DISCARDED,
      AUDIT_ACTIONS.PUBLIC_BOOKING_CREATED,
    ],
  },
  {
    key: 'stock',
    label: 'Stock and lab',
    actions: [
      AUDIT_ACTIONS.LAB_ORDER_STATUS_CHANGED,
      AUDIT_ACTIONS.GOODS_RECEIVED,
      AUDIT_ACTIONS.PURCHASE_ORDER_PLACED,
      AUDIT_ACTIONS.PURCHASE_ORDER_CANCELLED,
    ],
  },
  {
    key: 'configuration',
    label: 'Configuration',
    actions: [
      AUDIT_ACTIONS.SETTINGS_UPDATED,
      AUDIT_ACTIONS.CLINIC_UPDATED,
      AUDIT_ACTIONS.SECURITY_UPDATED,
      AUDIT_ACTIONS.COMMUNICATIONS_UPDATED,
      AUDIT_ACTIONS.PAYMENT_GATEWAY_UPDATED,
    ],
  },
]

/**
 * What to call this action.
 *
 * An unknown action — one written by a version newer than this table, or by
 * something that bypassed `AUDIT_ACTIONS` — falls back to the raw string rather
 * than to "Unknown". The raw string is at least searchable; "Unknown" loses the
 * only information the entry had.
 */
export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action
}

/** Which group an action belongs to, or null. */
export function auditGroupOf(action: string): string | null {
  return AUDIT_GROUPS.find((group) => group.actions.includes(action))?.key ?? null
}

/**
 * Badge colours, by how the entry should feel on a page being scanned.
 *
 * Refusals and lockouts are amber, not red: they are the system working. Red is
 * for money leaving and records being destroyed.
 */
export function auditTone(action: string): string {
  if (
    action === AUDIT_ACTIONS.REFUND_ISSUED ||
    action === AUDIT_ACTIONS.LOGIN_FAILED_USER_INACTIVE ||
    action === AUDIT_ACTIONS.LOGIN_FAILED_CLINIC_INACTIVE
  ) {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  }

  if (
    action === AUDIT_ACTIONS.ACCESS_DENIED ||
    action === AUDIT_ACTIONS.LOGIN_FAILED_PASSWORD ||
    action === AUDIT_ACTIONS.LOGIN_BLOCKED_LOCKOUT ||
    action === AUDIT_ACTIONS.LOGIN_BLOCKED_IP
  ) {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
  }

  if (auditGroupOf(action) === 'record-access') {
    return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
  }

  if (auditGroupOf(action) === 'configuration') {
    return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
  }

  return 'bg-muted text-muted-foreground'
}
