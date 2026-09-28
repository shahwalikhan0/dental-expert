'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { groupTeeth } from '@/lib/teeth'
import { PortalEmpty, PortalState, usePortalData } from '@/components/portal/portal-data'

interface Treatment {
  id: string
  treatmentNo: string
  procedure: string
  teeth: number[]
  status: string
  cost: number
  date: string
  dentist: string
}

export default function PortalTreatmentsPage() {
  const { data, loading, failed, reload } = usePortalData<Treatment[]>('/api/portal/treatments')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Treatments</h1>
        <p className="text-sm text-muted-foreground">
          What has been done, and what it cost. Your dentist&rsquo;s clinical notes are not shown
          here &mdash; ask them at your next visit.
        </p>
      </div>

      <PortalState loading={loading} failed={failed} reload={reload} />

      {!loading &&
        !failed &&
        (data && data.length > 0 ? (
          <div className="space-y-3">
            {data.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.procedure}</span>
                      {t.status === 'IN_PROGRESS' && <Badge variant="outline">In progress</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(t.date)} &middot; {t.dentist}
                    </p>
                    {/* "Upper right: 13, 15" rather than the notation on the
                        chart. A patient is not reading a quadrant code. */}
                    {t.teeth.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {groupTeeth(t.teeth)
                          .map((g) => `${g.label}: ${g.teeth.join(', ')}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">{formatCurrency(t.cost)}</p>
                    <p className="text-xs text-muted-foreground">{t.treatmentNo}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <PortalEmpty
            title="No treatments recorded yet"
            detail="Anything your dentist carries out will appear here."
          />
        ))}
    </div>
  )
}
