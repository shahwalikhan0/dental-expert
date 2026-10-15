'use client'

import { useSession } from 'next-auth/react'
import { holderCan } from '@/lib/rbac'
import type { ClinicianDay } from '@/lib/schedule'
import type { TimelineLinks } from './clinician-timeline'
import type { SeenLinks } from './seen-views'

/**
 * Where everything on the schedule goes, for this viewer.
 *
 * A link is offered only to somebody who may follow it: a free slot books
 * only for those who can book, a name opens the staff page only for those who
 * can read it, and the per-clinician figures open the performance page only
 * for those allowed to see it.
 */
export function useScheduleLinks(to: (href: string) => string) {
  const { data: session } = useSession()
  const holder = { role: session?.user?.role, clinicalRole: session?.user?.clinicalRole }
  const canBook = holderCan(holder, 'appointments:write')
  const canReadStaff = holderCan(holder, 'staff:read')
  const canSeeFigures = holderCan(holder, 'staff:hr')

  const staff = (clinician: { id: string }) => (canReadStaff ? to(`/staff/${clinician.id}`) : null)

  const dayBook = (day: string) => to(`/appointments?view=calendar&day=${day}`)

  const timeline = (day: string): TimelineLinks => ({
    staff,
    appointment: (id) => to(`/appointments/${id}`),
    // An assistant is booked onto a visit alongside a dentist; the form asks
    // for the dentist.
    book: (clinician: ClinicianDay, time: string) =>
      canBook
        ? to(
            `/appointments/new?date=${day}&time=${time}&` +
              `${clinician.kind === 'dentist' ? 'doctorId' : 'assistantId'}=${clinician.id}`
          )
        : null,
  })

  const seen: SeenLinks = {
    clinician: (clinician) =>
      canSeeFigures ? to(`/staff/${clinician.id}/performance`) : staff(clinician),
    day: dayBook,
  }

  return { timeline, seen, staff, dayBook }
}
