/**
 * What every status in the application means, in colour and in words. Once.
 *
 * Before this there were the shared configs (appointment, treatment, plan,
 * invoice, payment) and a dozen private maps beside them, and they disagreed
 * about the same idea: CANCELLED was grey on an appointment and red on a lab
 * order; EXPIRED was red on the waitlist and grey on an invitation; one lab
 * order was emerald on the list and green on its own page. A colour that means
 * "finished" on one screen and "something is wrong" on the next teaches people
 * to stop reading the colour, and then it is decoration.
 *
 * So colour is chosen by *meaning*, not by entity. Each domain status maps to
 * one of six tones, and each tone is one Badge variant:
 *
 *   neutral   draft, cancelled, inactive, expired — nothing to act on
 *   info      scheduled, ordered, sent, pending — waiting on someone
 *   progress  in progress, checked in, partially paid — under way (amber)
 *   success   completed, paid, received, active — done or in good standing
 *   danger    overdue, no-show, failed, blocked, remake, rejected — needs action
 *   purple    refunded — money handed back
 *
 * Labels are sentence case ("Partially paid", "No-show"), because they sit in
 * sentences and in badges next to ordinary prose. A status nobody mapped is
 * still shown — humanised, in the neutral tone — rather than hidden: it is in
 * the record, and refusing to draw it does not make it go away.
 *
 * Render with `<StatusBadge kind="invoice" status={invoice.status} />`
 * (components/ui/status-badge.tsx). Build a status filter's options with
 * `statusOptions('invoice')`, so the filter and the badge cannot disagree
 * about what a status is called.
 */
import { humanise } from '@/lib/labels'

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger' | 'purple'

/** The Badge variant (components/ui/badge.tsx) that draws each tone. */
export const TONE_BADGE_VARIANT = {
  neutral: 'secondary',
  info: 'info',
  progress: 'warning',
  success: 'success',
  danger: 'danger',
  purple: 'purple',
} as const satisfies Record<StatusTone, string>

/**
 * Text colour for each tone, for the places that colour a figure rather than
 * draw a badge — a till variance, an "x days overdue" line.
 */
export const TONE_TEXT_CLASS: Record<StatusTone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-blue-700 dark:text-blue-300',
  progress: 'text-amber-700 dark:text-amber-400',
  success: 'text-green-700 dark:text-green-400',
  danger: 'text-red-600 dark:text-red-400',
  purple: 'text-purple-700 dark:text-purple-300',
}

export interface StatusMeaning {
  tone: StatusTone
  label: string
}

/** Shorthand for the table below. */
const s = (tone: StatusTone, label: string): StatusMeaning => ({ tone, label })

/** The active/inactive pair, which a dozen catalogues and registers share. */
const ACTIVE_INACTIVE = {
  ACTIVE: s('success', 'Active'),
  INACTIVE: s('neutral', 'Inactive'),
}

/**
 * Every status, by kind. Keys are the stored values: Prisma enum members where
 * there is an enum (prisma/schema.prisma), and the strings the API derives
 * where there is not (stock levels, recall bands, a prescription's validity).
 * The order of each map is the order a filter should list them in.
 */
export const STATUS_TABLE = {
  /** AppointmentStatus */
  appointment: {
    SCHEDULED: s('info', 'Scheduled'),
    CONFIRMED: s('info', 'Confirmed'),
    CHECKED_IN: s('progress', 'Checked in'),
    IN_PROGRESS: s('progress', 'In progress'),
    COMPLETED: s('success', 'Completed'),
    CANCELLED: s('neutral', 'Cancelled'),
    NO_SHOW: s('danger', 'No-show'),
    // Superseded by the appointment it was moved to; nothing left to do here.
    RESCHEDULED: s('neutral', 'Rescheduled'),
  },
  /** TreatmentStatus */
  treatment: {
    PLANNED: s('info', 'Planned'),
    IN_PROGRESS: s('progress', 'In progress'),
    COMPLETED: s('success', 'Completed'),
    CANCELLED: s('neutral', 'Cancelled'),
  },
  /** TreatmentPlanStatus */
  treatmentPlan: {
    DRAFT: s('neutral', 'Draft'),
    PROPOSED: s('info', 'Proposed'),
    ACCEPTED: s('info', 'Accepted'),
    IN_PROGRESS: s('progress', 'In progress'),
    COMPLETED: s('success', 'Completed'),
    CANCELLED: s('neutral', 'Cancelled'),
  },
  /** TreatmentPlanItemStatus */
  treatmentPlanItem: {
    PENDING: s('info', 'Pending'),
    SCHEDULED: s('info', 'Scheduled'),
    IN_PROGRESS: s('progress', 'In progress'),
    COMPLETED: s('success', 'Completed'),
    CANCELLED: s('neutral', 'Cancelled'),
  },
  /** InvoiceStatus */
  invoice: {
    DRAFT: s('neutral', 'Draft'),
    PENDING: s('info', 'Pending'),
    PARTIALLY_PAID: s('progress', 'Partially paid'),
    PAID: s('success', 'Paid'),
    OVERDUE: s('danger', 'Overdue'),
    CANCELLED: s('neutral', 'Cancelled'),
    REFUNDED: s('purple', 'Refunded'),
  },
  /** PaymentStatus */
  payment: {
    PENDING: s('info', 'Pending'),
    COMPLETED: s('success', 'Completed'),
    FAILED: s('danger', 'Failed'),
    PARTIALLY_REFUNDED: s('purple', 'Partially refunded'),
    REFUNDED: s('purple', 'Refunded'),
    CANCELLED: s('neutral', 'Cancelled'),
  },
  /** DiscountApprovalStatus */
  discountApproval: {
    NOT_REQUIRED: s('neutral', 'Not required'),
    PENDING: s('info', 'Awaiting approval'),
    APPROVED: s('success', 'Approved'),
    REJECTED: s('danger', 'Rejected'),
  },
  /** LabOrderStatus */
  labOrder: {
    // Written but not yet with the lab: a draft in all but name.
    CREATED: s('neutral', 'Created'),
    SENT_TO_LAB: s('info', 'Sent to lab'),
    IN_PROGRESS: s('progress', 'In progress'),
    QUALITY_CHECK: s('progress', 'Quality check'),
    READY: s('success', 'Ready'),
    DELIVERED: s('success', 'Delivered'),
    FITTED: s('success', 'Fitted'),
    REMAKE_REQUIRED: s('danger', 'Remake required'),
    CANCELLED: s('neutral', 'Cancelled'),
  },
  /** PurchaseOrderStatus */
  purchaseOrder: {
    DRAFT: s('neutral', 'Draft'),
    ORDERED: s('info', 'Ordered'),
    PARTIALLY_RECEIVED: s('progress', 'Partially received'),
    RECEIVED: s('success', 'Received'),
    CANCELLED: s('neutral', 'Cancelled'),
  },
  /** WaitlistStatus */
  waitlist: {
    ACTIVE: s('info', 'Waiting'),
    NOTIFIED: s('progress', 'Notified'),
    BOOKED: s('success', 'Booked'),
    CANCELLED: s('neutral', 'Cancelled'),
    // Lapsed on its own; nobody has done anything wrong.
    EXPIRED: s('neutral', 'Expired'),
  },
  /** Staff invitation (derived by /api/staff-invites). */
  invite: {
    PENDING: s('info', 'Pending'),
    ACCEPTED: s('success', 'Accepted'),
    EXPIRED: s('neutral', 'Expired'),
    REVOKED: s('neutral', 'Cancelled'),
  },
  /** A staff member's account (`isActive`). */
  staff: ACTIVE_INACTIVE,
  /** A patient's registration (`isActive`). */
  patient: ACTIVE_INACTIVE,
  /** VendorStatus, kind SUPPLIER. */
  supplier: {
    ACTIVE: s('success', 'Active'),
    INACTIVE: s('neutral', 'Inactive'),
    BLOCKED: s('danger', 'Blocked'),
  },
  /** VendorStatus, kind LAB. */
  vendor: {
    ACTIVE: s('success', 'Active'),
    INACTIVE: s('neutral', 'Inactive'),
    BLOCKED: s('danger', 'Blocked'),
  },
  /**
   * An inventory item: whether it is stocked at all (`isActive`), and the
   * stock level `/api/inventory/items` derives as `stockStatus`.
   */
  inventory: {
    ...ACTIVE_INACTIVE,
    sufficient: s('success', 'In stock'),
    reorder: s('progress', 'Reorder'),
    low_stock: s('danger', 'Low stock'),
    out_of_stock: s('danger', 'Out of stock'),
  },
  /** StockAlertType. Severity, not category: an expired batch is acted on first. */
  stockAlert: {
    EXPIRED: s('danger', 'Expired'),
    OUT_OF_STOCK: s('danger', 'Out of stock'),
    EXPIRING_SOON: s('progress', 'Expiring soon'),
    LOW_STOCK: s('progress', 'Low stock'),
  },
  /**
   * StockTransactionType, as the stock history names it. Stock in is good
   * news, stock out by use is ordinary, stock lost needs a look. `PURCHASE`
   * is "Purchase" here because a received order writes one too; the recording
   * form, which only makes the unordered kind, says "Purchase (no order)".
   */
  stockTransaction: {
    PURCHASE: s('success', 'Purchase'),
    ADJUSTMENT_IN: s('success', 'Adjustment (add)'),
    CONSUMPTION: s('info', 'Used in treatment'),
    SALE: s('info', 'Sale'),
    TRANSFERRED: s('info', 'Transfer'),
    ADJUSTMENT_OUT: s('progress', 'Adjustment (remove)'),
    RETURNED: s('progress', 'Returned to supplier'),
    DAMAGED: s('danger', 'Damaged'),
    EXPIRED: s('danger', 'Expired'),
  },
  /** SubscriptionStatus — a clinic on the platform console. */
  tenant: {
    TRIALING: s('info', 'Trialing'),
    ACTIVE: s('success', 'Active'),
    PAST_DUE: s('progress', 'Past due'),
    SUSPENDED: s('danger', 'Suspended'),
    CANCELLED: s('neutral', 'Cancelled'),
  },
  /**
   * A prescription has no stored status; it is valid until `validUntil`.
   * Use `prescriptionStatus(validUntil, today)` to get the key.
   */
  prescription: {
    ACTIVE: s('success', 'Valid'),
    EXPIRED: s('neutral', 'Expired'),
  },
  /** A prescription template (`isActive`). Retired, not deleted. */
  prescriptionTemplate: {
    ACTIVE: s('success', 'Active'),
    INACTIVE: s('neutral', 'Retired'),
  },
  /**
   * The recall list: the due band `/api/recare` puts each patient in, and the
   * recall's own RecareStatus.
   */
  recare: {
    OVERDUE: s('danger', 'Overdue'),
    DUE_SOON: s('progress', 'Due soon'),
    UPCOMING: s('info', 'Upcoming'),
    SNOOZED: s('neutral', 'Snoozed'),
    ACTIVE: s('success', 'Active'),
    OPTED_OUT: s('neutral', 'Opted out'),
    INACTIVE: s('neutral', 'Inactive'),
  },
  /** MessageStatus — an SMS, email or WhatsApp message. */
  message: {
    PENDING: s('info', 'Pending'),
    QUEUED: s('info', 'Queued'),
    SENT: s('info', 'Sent'),
    DELIVERED: s('success', 'Delivered'),
    FAILED: s('danger', 'Failed'),
    CANCELLED: s('neutral', 'Cancelled'),
  },
  /** FormSubmissionStatus */
  formSubmission: {
    SUBMITTED: s('info', 'Submitted'),
    REVIEWED: s('progress', 'Reviewed'),
    APPROVED: s('success', 'Approved'),
    REJECTED: s('danger', 'Rejected'),
  },
  /** QualityCheckStatus — a lab case's check on arrival. */
  qualityCheck: {
    PENDING: s('info', 'Pending'),
    PASSED: s('success', 'Passed'),
    CONDITIONALLY_PASSED: s('progress', 'Passed with notes'),
    FAILED: s('danger', 'Failed'),
  },
  /** Anything else that is simply on or off: forms, procedures, medications. */
  active: ACTIVE_INACTIVE,
} as const satisfies Record<string, Record<string, StatusMeaning>>

export type StatusKind = keyof typeof STATUS_TABLE

/** The statuses a kind knows about, for typing a `status` prop. */
export type StatusOf<K extends StatusKind> = keyof (typeof STATUS_TABLE)[K] & string

/**
 * What a status means: its tone and its label.
 *
 * Accepts any string, because statuses arrive from the API as strings. An
 * unknown one is humanised and drawn neutral rather than dropped. A boolean is
 * read as active/inactive, for the `isActive` registers.
 */
export function statusMeaning(
  kind: StatusKind,
  status: string | boolean | null | undefined
): StatusMeaning {
  const key = typeof status === 'boolean' ? (status ? 'ACTIVE' : 'INACTIVE') : (status ?? '')
  const table = STATUS_TABLE[kind] as Record<string, StatusMeaning>
  return table[key] ?? { tone: 'neutral', label: humanise(key) }
}

export function statusTone(kind: StatusKind, status: string | boolean | null | undefined) {
  return statusMeaning(kind, status).tone
}

export function statusLabel(kind: StatusKind, status: string | boolean | null | undefined) {
  return statusMeaning(kind, status).label
}

/**
 * A kind's statuses as `{ value, label }`, in the table's order — the options
 * for a `FilterSelect`, so the filter names a status exactly as the badge does.
 *
 * @param only Restrict to (and order by) these values, for a screen that
 *   filters on a subset.
 */
export function statusOptions<K extends StatusKind>(
  kind: K,
  only?: readonly StatusOf<K>[]
): { value: StatusOf<K>; label: string }[] {
  const table = STATUS_TABLE[kind] as Record<string, StatusMeaning>
  const keys = (only ?? Object.keys(table)) as StatusOf<K>[]
  return keys.map((value) => ({ value, label: table[value]?.label ?? humanise(value) }))
}

/**
 * A prescription's status key from its `validUntil`: ACTIVE until the day after
 * it, EXPIRED from then. With no `validUntil` it never expires.
 *
 * @param today The clinic's calendar day, `YYYY-MM-DD`.
 */
export function prescriptionStatus(
  validUntil: string | Date | null | undefined,
  today: string
): 'ACTIVE' | 'EXPIRED' {
  if (!validUntil) return 'ACTIVE'
  const day =
    validUntil instanceof Date ? validUntil.toISOString().slice(0, 10) : validUntil.slice(0, 10)
  return day < today ? 'EXPIRED' : 'ACTIVE'
}
