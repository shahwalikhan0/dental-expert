'use client'

import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { displayDate, displayTime } from '@/lib/dates'
import { PortalEmpty, PortalState, usePortalData } from '@/components/portal/portal-data'

interface Appointment {
  id: string
  appointmentNo: string
  scheduledDate: string
  scheduledTime: string
  startsAt: string
  upcoming: boolean
  status: string
  type: string
  dentist: string
}

/**
 * The patient's words for a status. The colour is the clinic's (lib/status),
 * so "Missed" is red here as "No-show" is on the clinic's own screens; only
 * the label is put the way a patient would say it.
 */
const PATIENT_LABELS: Record<string, string> = {
  SCHEDULED: 'Booked',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Attended',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Missed',
  RESCHEDULED: 'Rescheduled',
}

function Row({ a }: { a: Appointment }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="min-w-0">
          <p className="font-medium">
            {displayDate(a.scheduledDate)} at{' '}
            {displayTime(`${a.scheduledDate.slice(0, 10)}T${a.scheduledTime}`)}
          </p>
          <p className="text-sm text-muted-foreground">
            {a.dentist} &middot; {a.appointmentNo}
          </p>
        </div>
        <StatusBadge kind="appointment" status={a.status} label={PATIENT_LABELS[a.status]} />
      </CardContent>
    </Card>
  )
}

export default function PortalAppointmentsPage() {
  const { data, loading, failed, reload } = usePortalData<Appointment[]>('/api/portal/appointments')

  // The API sorts newest first, which is right for history and backwards for
  // what is coming: the next visit should be at the top of "upcoming", not the
  // furthest one away.
  const upcoming = (data ?? []).filter((a) => a.upcoming).reverse()
  const past = (data ?? []).filter((a) => !a.upcoming)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Appointments</h1>
        <p className="text-sm text-muted-foreground">
          To change or cancel an appointment, please telephone the clinic.
        </p>
      </div>

      <PortalState loading={loading} failed={failed} reload={reload} />

      {!loading && !failed && (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Coming up</h2>
            {upcoming.length > 0 ? (
              upcoming.map((a) => <Row key={a.id} a={a} />)
            ) : (
              <PortalEmpty
                title="Nothing booked"
                detail="Telephone the clinic to arrange your next visit."
              />
            )}
          </section>

          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">Previous visits</h2>
              {past.map((a) => (
                <Row key={a.id} a={a} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
