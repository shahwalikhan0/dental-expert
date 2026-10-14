'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { displayDate, isoDay } from '@/lib/dates'
import { prescriptionStatus } from '@/lib/status'
import { groupTeeth } from '@/lib/teeth'
import { PortalEmpty, PortalState, usePortalData } from '@/components/portal/portal-data'

interface Medicine {
  id: string
  medicationName: string
  dosage: string
  frequency: string
  duration: string
  route: string
  timing: string | null
  instructions: string | null
}

interface Prescription {
  id: string
  prescriptionNo: string
  teeth: number[]
  notes: string | null
  validUntil: string | null
  date: string
  dentist: string
  medicines: Medicine[]
}

export default function PortalPrescriptionsPage() {
  const { data, loading, failed, reload } = usePortalData<Prescription[]>(
    '/api/portal/prescriptions'
  )
  // The route does not send the clinic's day; the patient's own is the day
  // they are reading on, which is the one that matters for "can I still use it".
  const today = isoDay(new Date())

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Prescriptions</h1>
        <p className="text-sm text-muted-foreground">
          What you were prescribed, and how to take it. Always finish a course as written unless
          your dentist tells you otherwise.
        </p>
      </div>

      <PortalState loading={loading} failed={failed} reload={reload} />

      {!loading &&
        !failed &&
        (data && data.length > 0 ? (
          <div className="space-y-4">
            {data.map((rx) => (
              <Card key={rx.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {displayDate(rx.date)} &middot; {rx.dentist}
                    </CardTitle>
                    {rx.validUntil && (
                      <StatusBadge
                        kind="prescription"
                        status={prescriptionStatus(rx.validUntil, today)}
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rx.prescriptionNo}
                    {rx.teeth.length > 0 &&
                      ` · ${groupTeeth(rx.teeth)
                        .map((g) => `${g.label}: ${g.teeth.join(', ')}`)
                        .join(' · ')}`}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rx.medicines.map((m) => (
                    <div key={m.id} className="rounded-lg border border-border/60 p-3">
                      <p className="font-medium">{m.medicationName}</p>
                      <p className="text-sm text-muted-foreground">
                        {[m.dosage, m.frequency, m.duration, m.route, m.timing]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {m.instructions && <p className="mt-1 text-sm">{m.instructions}</p>}
                    </div>
                  ))}
                  {rx.notes && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Notes: </span>
                      {rx.notes}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <PortalEmpty
            title="No prescriptions yet"
            detail="Anything your dentist prescribes will appear here."
          />
        ))}
    </div>
  )
}
