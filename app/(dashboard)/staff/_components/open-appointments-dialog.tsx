'use client'

import Link from 'next/link'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { displayDateTime } from '@/lib/dates'
import { humanise } from '@/lib/labels'

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
 */
export function OpenAppointmentsDialog({
  open,
  onOpenChange,
  name,
  appointments,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  appointments: OpenAppointment[]
  busy?: boolean
  onConfirm: () => void
}) {
  const count = appointments.length
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {name} still has {count} appointment{count === 1 ? '' : 's'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            These stay booked with {name} if you go ahead, and {name} will not be able to sign in to
            see them. Reassign or cancel them on the Appointments screen, or deactivate now and deal
            with them afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
          {appointments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <Link
                  href={`/appointments/${a.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {a.appointmentNo}
                </Link>
                <div className="truncate text-muted-foreground">{a.patient}</div>
              </div>
              <div className="shrink-0 text-right">
                <div>{displayDateTime(a.startsAt)}</div>
                <div className="text-xs text-muted-foreground">{humanise(a.status)}</div>
              </div>
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep active</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={busy}
            className="bg-red-600 hover:bg-red-700"
          >
            Deactivate anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
