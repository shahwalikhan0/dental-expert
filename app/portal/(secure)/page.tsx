'use client'

import Link from 'next/link'
import { Calendar, CreditCard, Phone, Pill, Stethoscope } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PortalState, usePortalData } from '@/components/portal/portal-data'

interface Me {
  patient: { name: string; patientId: string }
  clinic: { name: string; phone: string | null }
}

interface Appointment {
  id: string
  scheduledDate: string
  scheduledTime: string
  upcoming: boolean
  dentist: string
}

interface Bills {
  outstanding: number
}

/**
 * The first thing a patient sees.
 *
 * Two facts and four doors. The two facts are the ones somebody opens this
 * page to check — when am I next in, and do I owe anything — and everything
 * else is a link to the page that has it. A dashboard of summary tiles would
 * be more to build and less to read.
 */
export default function PortalOverviewPage() {
  const me = usePortalData<Me>('/api/portal/me')
  const appointments = usePortalData<Appointment[]>('/api/portal/appointments')
  const bills = usePortalData<Bills>('/api/portal/bills')

  const loading = me.loading || appointments.loading || bills.loading
  const failed = me.failed || appointments.failed || bills.failed

  const next = (appointments.data ?? []).filter((a) => a.upcoming).at(-1)
  const outstanding = bills.data?.outstanding ?? 0

  const reload = () => {
    me.reload()
    appointments.reload()
    bills.reload()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          {me.data ? `Hello, ${me.data.patient.name}` : 'Your records'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {me.data?.clinic.name ? `Your records at ${me.data.clinic.name}.` : ''} You can read
          everything here; to change anything, please telephone the clinic.
        </p>
      </div>

      <PortalState loading={loading} failed={failed} reload={reload} />

      {!loading && !failed && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="space-y-1 py-4">
                <p className="text-sm text-muted-foreground">Next appointment</p>
                {next ? (
                  <>
                    <p className="text-lg font-semibold">
                      {formatDate(next.scheduledDate)} at {next.scheduledTime}
                    </p>
                    <p className="text-sm text-muted-foreground">{next.dentist}</p>
                  </>
                ) : (
                  <p className="text-lg font-semibold text-muted-foreground">Nothing booked</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-1 py-4">
                <p className="text-sm text-muted-foreground">Outstanding</p>
                <p className="text-lg font-semibold tabular-nums">{formatCurrency(outstanding)}</p>
                <p className="text-sm text-muted-foreground">
                  {outstanding > 0 ? 'Telephone the clinic to pay' : 'Nothing to pay'}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { href: '/portal/appointments', label: 'Appointments', icon: Calendar },
              { href: '/portal/treatments', label: 'Treatments', icon: Stethoscope },
              { href: '/portal/prescriptions', label: 'Prescriptions', icon: Pill },
              { href: '/portal/bills', label: 'Bills', icon: CreditCard },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-xl border border-border/60 p-4 transition-colors hover:bg-foreground/[0.04]"
              >
                <item.icon className="h-5 w-5 text-primary" />
                <span className="font-medium">{item.label}</span>
              </Link>
            ))}
          </div>

          {/* The answer to almost every question this portal raises and cannot
              answer, since nothing here can be changed. */}
          {me.data?.clinic.phone && (
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm">
                  <span className="text-muted-foreground">To change anything, telephone </span>
                  <a href={`tel:${me.data.clinic.phone}`} className="font-medium hover:underline">
                    {me.data.clinic.phone}
                  </a>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
