/**
 * The questions asked before an appointment is cancelled or marked a no-show.
 *
 * The appointment page asked them and the list's row menu did not: Cancel and
 * Mark no-show there went straight to the server, with no chance to take back
 * a mis-click and no way to say why a visit was cancelled. Both screens now
 * build their dialog from here, so the list shortcut asks exactly what the
 * record page asks (docs/UX_STANDARDS.md §4).
 *
 *   const { confirmed, reason } = await confirm(cancelAppointmentConfirm('APT-0012'))
 *   if (confirmed) put({ status: 'CANCELLED', cancellationReason: reason || undefined })
 */
import type { ConfirmOptions, ConfirmWithReasonOptions } from '@/components/ui/confirm-dialog'

/**
 * Cancel, with the reason the route stores as `cancellationReason`. The
 * reason stays optional, as it always was on the appointment page: the
 * route accepts a cancellation without one.
 */
export function cancelAppointmentConfirm(appointmentNo: string): ConfirmWithReasonOptions {
  return {
    title: `Cancel appointment ${appointmentNo}?`,
    description: 'The slot is freed. The appointment is kept, marked cancelled.',
    confirmLabel: 'Cancel appointment',
    // "Cancel" would be ambiguous beside "Cancel appointment".
    cancelLabel: 'Keep appointment',
    reason: {
      label: 'Why is it being cancelled?',
      required: false,
      placeholder: 'Optional — the patient called, rebooked elsewhere…',
    },
  }
}

/**
 * A no-show counts against the patient's record and decides whether they get
 * an extra reminder next time — and it sits beside Check in on the row menu.
 * The route takes no reason for it.
 */
export function noShowConfirm(appointmentNo: string): ConfirmOptions {
  return {
    title: `Mark appointment ${appointmentNo} as a no-show?`,
    description:
      'This records that the patient did not attend, and counts towards their no-show rate.',
    confirmLabel: 'Mark no-show',
  }
}
