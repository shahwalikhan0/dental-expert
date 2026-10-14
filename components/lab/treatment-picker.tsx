'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { displayDate } from '@/lib/dates'

interface TreatmentOption {
  id: string
  treatmentNo: string
  procedureName: string | null
  toothNumbers: string | null
  createdAt: string
}

const NONE = 'none'

/**
 * The treatment a lab case is for — optional (bug report 12 Oct, finding 60).
 *
 * The crown for Bilal's 46 had nothing joining it to the preparation it was
 * made for. This offers the patient's own treatments, newest first; the API
 * checks again that the one chosen is this patient's.
 */
export function LabTreatmentPicker({
  patientId,
  value,
  onChange,
}: {
  patientId: string
  value: string
  onChange: (treatmentId: string) => void
}) {
  const [options, setOptions] = useState<TreatmentOption[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!patientId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOptions([])
      return
    }

    let cancelled = false
    // A new patient is a new list; the bounded extra render is the point.
    setLoading(true)
    setFailed(null)

    fetch(`/api/lab-orders/treatments?patientId=${encodeURIComponent(patientId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not load the treatments')
        if (!cancelled) setOptions(data.data ?? [])
      })
      .catch((err) => {
        if (!cancelled) setFailed(err instanceof Error ? err.message : 'Could not load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [patientId])

  const describe = (t: TreatmentOption) =>
    [
      t.treatmentNo,
      t.procedureName,
      t.toothNumbers ? `tooth ${t.toothNumbers}` : null,
      displayDate(t.createdAt),
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <div className="space-y-2">
      <Label htmlFor="treatmentId">Treatment this is for</Label>
      <Select
        value={value || NONE}
        onValueChange={(v) => onChange(v === NONE ? '' : v)}
        disabled={!patientId || loading}
      >
        <SelectTrigger id="treatmentId">
          <SelectValue
            placeholder={
              !patientId
                ? 'Choose the patient first'
                : loading
                  ? 'Loading treatments…'
                  : 'No treatment'
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No treatment</SelectItem>
          {options.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {describe(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {failed ? (
        <p className="text-xs text-destructive">{failed}</p>
      ) : (
        patientId &&
        !loading &&
        options.length === 0 && (
          <p className="text-xs text-muted-foreground">
            This patient has no treatments recorded yet.
          </p>
        )
      )}
    </div>
  )
}
