import type { LabOrderStatus, LabWorkType } from '@prisma/client'

/**
 * The kinds of work a dental laboratory is asked for — one list, in one
 * spelling.
 *
 * There were three spellings of this list in the application and they did not
 * agree. `LabOrder.workType` is a Prisma enum, so the only value the column
 * accepts is UPPER_SNAKE; the lab screen's filter used that; the new-order form
 * offered lower case. The consequences were not subtle:
 *
 *  - **No lab case could be raised through the interface.** The form posted
 *    `crown`, the enum rejected it, and the route answered 500. Every case in
 *    the database had been put there by the seed.
 *  - The filter on the lab screen passed its value under a name the route did
 *    not read, so it returned the unfiltered list either way.
 *
 * Both screens now take their options from here, and anything arriving from
 * outside is normalised before it reaches the column.
 */

export const WORK_TYPES: { value: LabWorkType; label: string }[] = [
  { value: 'CROWN', label: 'Crown' },
  { value: 'BRIDGE', label: 'Bridge' },
  { value: 'DENTURE', label: 'Denture' },
  { value: 'PARTIAL_DENTURE', label: 'Partial denture' },
  { value: 'IMPLANT_CROWN', label: 'Implant crown' },
  { value: 'VENEER', label: 'Veneer' },
  { value: 'INLAY_ONLAY', label: 'Inlay / onlay' },
  { value: 'NIGHT_GUARD', label: 'Night guard' },
  { value: 'RETAINER', label: 'Retainer' },
  { value: 'ALIGNER', label: 'Aligner' },
  { value: 'MODEL', label: 'Model' },
  { value: 'OTHER', label: 'Other' },
]

const BY_VALUE = new Map(WORK_TYPES.map((type) => [type.value, type]))

/**
 * The enum value for whatever spelling arrived, or null.
 *
 * Accepts `crown`, `CROWN`, `Inlay/Onlay`, `inlay_onlay` and `inlay-onlay` as
 * the same thing. Returns null rather than guessing when it cannot tell, so the
 * caller answers 400 instead of letting Prisma throw a validation error that
 * surfaces as a 500.
 */
export function normaliseWorkType(value: unknown): LabWorkType | null {
  if (typeof value !== 'string') return null

  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_')
  return BY_VALUE.has(key as LabWorkType) ? (key as LabWorkType) : null
}

/** How a work type is written on screen. */
export function workTypeLabel(value: string): string {
  const normalised = normaliseWorkType(value)
  if (normalised) return BY_VALUE.get(normalised)!.label

  // An unrecognised value is shown rather than hidden — it is in the record.
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// ────────────────────────────────────────────────────────────────────────────
// Status (bug report 12 Oct, finding 45)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The road a case travels, in order.
 *
 * The status route used to accept any status from any status: LAB20260001
 * went CREATED → FITTED → CREATED and both answered 200, and the delivered
 * date stamped on the way through stayed on an order that said it had not
 * been sent. A case moves forward one stage at a time now, and the only ways
 * back are the rework steps a laboratory actually takes.
 */
export const STATUS_PATH: LabOrderStatus[] = [
  'CREATED',
  'SENT_TO_LAB',
  'IN_PROGRESS',
  'QUALITY_CHECK',
  'READY',
  'DELIVERED',
  'FITTED',
]

/**
 * Where a case may go from where it is.
 *
 * - Forward one stage along STATUS_PATH.
 * - Quality check back to in progress: the work failed the check and goes
 *   back on the bench.
 * - Remake required, from the quality check onwards — the work came back
 *   wrong, or did not fit in the mouth. A remake goes back to the laboratory.
 * - Cancelled, from anything before the work is in the patient's mouth.
 *
 * FITTED and CANCELLED are the end. A crown that fails after fitting is a new
 * case, not this one rewound.
 */
export const STATUS_TRANSITIONS: Record<LabOrderStatus, LabOrderStatus[]> = {
  CREATED: ['SENT_TO_LAB', 'CANCELLED'],
  SENT_TO_LAB: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['QUALITY_CHECK', 'CANCELLED'],
  QUALITY_CHECK: ['READY', 'IN_PROGRESS', 'REMAKE_REQUIRED', 'CANCELLED'],
  READY: ['DELIVERED', 'REMAKE_REQUIRED', 'CANCELLED'],
  DELIVERED: ['FITTED', 'REMAKE_REQUIRED', 'CANCELLED'],
  FITTED: [],
  REMAKE_REQUIRED: ['SENT_TO_LAB', 'CANCELLED'],
  CANCELLED: [],
}

/** The statuses a case can move to from `from`, for the picker on the case screen. */
export function nextStatuses(from: LabOrderStatus): LabOrderStatus[] {
  return STATUS_TRANSITIONS[from] ?? []
}

export function canMoveStatus(from: LabOrderStatus, to: LabOrderStatus): boolean {
  return nextStatuses(from).includes(to)
}

/**
 * Whether the case's details may still be changed. A cancelled case is closed:
 * it was offered for editing anyway, and the route took the edit, so a case
 * nobody is making could be given a new laboratory and a new cost. A fitted
 * case stays editable, because the laboratory's final bill (the actual cost)
 * and the quality notes often arrive after the fit.
 */
export function isLabOrderEditable(status: string): boolean {
  return status !== 'CANCELLED'
}

/** `QUALITY_CHECK` → "Quality check", for refusals a toast can show. */
export function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')
}

export interface MilestoneDates {
  sentDate: Date | null
  receivedDate: Date | null
  deliveredDate: Date | null
}

/**
 * The milestone dates a move to `to` should leave on the case.
 *
 * Each date belongs to a stage: sent to SENT_TO_LAB, received (back from the
 * laboratory) to READY, delivered to DELIVERED. A date is stamped the first
 * time its stage is reached and kept while the case is at or beyond it.
 *
 * A move back — a remake going to the laboratory again — clears the dates of
 * every stage the case is now short of, so a remake does not still say it was
 * delivered last week. The sent date is the exception on a remake: the case
 * is being sent again, so it is stamped afresh.
 *
 * Returns only the fields that change, ready to spread into an update.
 */
export function milestoneUpdate(
  current: MilestoneDates,
  from: LabOrderStatus,
  to: LabOrderStatus,
  now: Date = new Date()
): Partial<MilestoneDates> {
  const data: Partial<MilestoneDates> = {}

  // Cancelling records where the case stopped; it does not rewrite it.
  if (to === 'CANCELLED') return data

  const stage = STATUS_PATH.indexOf(to)
  const reached = (milestone: LabOrderStatus) =>
    stage >= 0 && stage >= STATUS_PATH.indexOf(milestone)

  if (to === 'REMAKE_REQUIRED') {
    // The work is going back. Nothing has been received or delivered of the
    // remake yet; the sent date stays until it is sent again.
    if (current.receivedDate) data.receivedDate = null
    if (current.deliveredDate) data.deliveredDate = null
    return data
  }

  const fields: [keyof MilestoneDates, LabOrderStatus][] = [
    ['sentDate', 'SENT_TO_LAB'],
    ['receivedDate', 'READY'],
    ['deliveredDate', 'DELIVERED'],
  ]

  for (const [field, milestone] of fields) {
    if (reached(milestone)) {
      if (!current[field]) data[field] = now
    } else if (current[field]) {
      data[field] = null
    }
  }

  // Sent again after a remake: the date that matters is this sending.
  if (from === 'REMAKE_REQUIRED' && to === 'SENT_TO_LAB') data.sentDate = now

  return data
}

// ────────────────────────────────────────────────────────────────────────────
// Dates and money (finding 59)
// ────────────────────────────────────────────────────────────────────────────

/** A date from a form or a request, or null when it is blank or not a date. */
export function parseDay(value: unknown): Date | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export interface LabOrderValues {
  orderDate: unknown
  expectedDate?: unknown
  estimatedCost: unknown
  actualCost?: unknown
}

/**
 * What is wrong with a case's dates and costs, in words a toast can show, or
 * null when nothing is.
 *
 * A case was accepted ordered on 12 October and due on 1 October, with an
 * estimate of −100. Neither is a typing slip the screen can explain later: a
 * due date before the order date puts the case on the overdue list the day it
 * is raised, and a negative cost is money the laboratory owes the clinic.
 *
 * Blank expected date and blank actual cost are allowed — the laboratory may
 * not have said yet, and has not billed yet.
 */
export function checkLabOrderValues(values: LabOrderValues): string | null {
  const orderDate = parseDay(values.orderDate)
  if (!orderDate) return 'The order date is not a date'

  if (values.expectedDate != null && values.expectedDate !== '') {
    const expected = parseDay(values.expectedDate)
    if (!expected) return 'The expected date is not a date'
    if (expected.getTime() < orderDate.getTime()) {
      return 'The expected date cannot be before the order date'
    }
  }

  const estimate = Number(values.estimatedCost)
  if (values.estimatedCost === '' || values.estimatedCost == null || !Number.isFinite(estimate)) {
    return 'The estimated cost must be a number'
  }
  if (estimate < 0) return 'The estimated cost cannot be negative'

  if (values.actualCost != null && values.actualCost !== '') {
    const actual = Number(values.actualCost)
    if (!Number.isFinite(actual)) return 'The actual cost must be a number'
    if (actual < 0) return 'The actual cost cannot be negative'
  }

  return null
}
