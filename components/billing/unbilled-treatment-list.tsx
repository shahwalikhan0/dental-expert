'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus } from 'lucide-react'
import { formatCurrency } from '@/lib/billing-utils'
import { lineKey, type FormLine } from '@/lib/invoice-form'

/**
 * A patient's treatments not yet on a live invoice, for the New and Edit
 * invoice pages — the Edit page had no way to add one, only free-text lines
 * (invoice review 4.1). The list comes from /api/billing/unbilled-treatments.
 */

export interface UnbilledTreatment {
  treatmentId: string
  treatmentNo: string
  appointmentId: string | null
  description: string
  procedure: {
    code: string
    name: string
  } | null
  doctor: string | null
  toothNumbers: string | null
  quantity: number
  unitPrice: number
  taxable: boolean
}

/** An unbilled treatment as a line, at the treatment's own price. */
export function treatmentLine(treatment: UnbilledTreatment): FormLine {
  return {
    key: lineKey(),
    treatmentId: treatment.treatmentId,
    inventoryItemId: null,
    description: treatment.description,
    quantity: String(treatment.quantity),
    unitPrice: String(treatment.unitPrice),
    taxable: treatment.taxable,
    listPrice: treatment.unitPrice,
    reference: treatment.treatmentNo,
  }
}

/** The patient's unbilled treatments, each with an Add button. */
export function UnbilledTreatmentList({
  loading,
  treatments,
  visitId,
  isAdded,
  onAdd,
}: {
  loading: boolean
  treatments: UnbilledTreatment[]
  visitId: string | null
  isAdded: (treatmentId: string) => boolean
  onAdd: (treatment: UnbilledTreatment) => void
}) {
  if (loading) {
    return <div className="text-center py-4 text-muted-foreground">Loading treatments...</div>
  }
  if (treatments.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">No unbilled treatments found</div>
    )
  }
  return (
    <div className="space-y-2">
      {treatments.map((treatment) => {
        const added = isAdded(treatment.treatmentId)
        return (
          <div
            key={treatment.treatmentId}
            className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg"
          >
            <div className="min-w-0">
              <div className="font-medium">{treatment.description}</div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {treatment.treatmentNo}
                {treatment.doctor && ` • ${treatment.doctor}`}
                {visitId && treatment.appointmentId === visitId && (
                  <Badge variant="outline">This visit</Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="font-medium">{formatCurrency(treatment.unitPrice)}</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAdd(treatment)}
                disabled={added}
              >
                {added ? (
                  'Added'
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </>
                )}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
