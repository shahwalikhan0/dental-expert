'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SubmitButton } from '@/components/ui/submit-button'
import type { Trail } from '@/components/ui/trail'
import { displayDateTime } from '@/lib/dates'
import { statusLabel } from '@/lib/status'

export interface OpenAppointment {
  id: string
  appointmentNo: string
  startsAt: string
  status: string
  patient: string
}

/**
 * The second question before switching somebody off: these patients are still
 * booked with them.
 *
 * The API answers a deactivation with 409 and this list when the person has
 * today's queue or future bookings (bug report 12 Oct, finding 21). Nothing is
 * moved automatically; the desk reassigns or cancels from the appointments
 * screen, or confirms here and deals with them afterwards.
 *
 * A `Dialog` rather than `useConfirmDialog`: the point of asking again is the
 * list of appointments, each a link, which a plain confirmation has no room
 * for. It follows the same rules otherwise — a question naming the person, a
 * confirm button that repeats the verb in the destructive colour, and an
 * outline way out on the left.
 */
export function OpenAppointmentsDialog({
  open,
  onOpenChange,
  name,
  appointments,
  busy,
  onConfirm,
  trail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  appointments: OpenAppointment[]
  busy?: boolean
  onConfirm: () => void
  /** The page's trail, so an appointment opened from here can come back. */
  trail?: Trail
}) {
  const count = appointments.length
  const noun = `appointment${count === 1 ? '' : 's'}`
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Not while the request is out: closing would hide whether it worked.
        if (busy && !next) return
        onOpenChange(next)
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            Deactivate {name} with {count} open {noun}?
          </DialogTitle>
          <DialogDescription>
            These stay booked with {name} if you go ahead, and {name} will not be able to sign in to
            see them. Reassign or cancel them on the Appointments screen, or deactivate now and deal
            with them afterwards.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
          {appointments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <Link
                  href={trail ? trail.to(`/appointments/${a.id}`) : `/appointments/${a.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {a.appointmentNo}
                </Link>
                <div className="truncate text-muted-foreground">{a.patient}</div>
              </div>
              <div className="shrink-0 text-right">
                <div>{displayDateTime(a.startsAt)}</div>
                <div className="text-xs text-muted-foreground">
                  {statusLabel('appointment', a.status)}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Keep active
          </Button>
          <SubmitButton
            type="button"
            variant="destructive"
            busy={busy}
            busyLabel="Deactivating…"
            onClick={onConfirm}
          >
            Deactivate anyway
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
