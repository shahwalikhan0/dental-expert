'use client'

import { Button } from '@/components/ui/button'
import { useState, useEffect, useCallback } from 'react'

interface Duplicate {
  id: string
  patientId: string
  name: string
  confidence: number
  matchFields: string[]
}

/**
 * DuplicateDetector — FR-001's soft duplicate warning on the registration form.
 *
 * Debounces on prop changes and asks POST /api/patients/duplicates, which scores
 * candidates on name, date of birth, phone, email and CNIC and says which fields
 * matched. `onSelect` is called with the existing patient's Prisma `id` when the
 * user chooses to open that record instead of creating a second one.
 *
 * A failed check says so rather than rendering nothing. This component spent its
 * whole life pointed at a route that did not exist, and because the catch below
 * quietly emptied the list, the form looked exactly as it does when a patient is
 * genuinely new. Silence has to mean "no duplicates", never "the check broke".
 */
export function DuplicateDetector({
  firstName,
  lastName,
  phone,
  email,
  dateOfBirth,
  cnic,
  onSelect,
}: {
  firstName: string
  lastName: string
  phone: string
  email?: string
  dateOfBirth?: string
  cnic?: string
  onSelect: (existingId: string) => void
}) {
  const [duplicates, setDuplicates] = useState<Duplicate[]>([])
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)

  const check = useCallback(async () => {
    if (!firstName || !lastName || !phone) return
    setChecking(true)
    try {
      const res = await fetch('/api/patients/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, phone, email, dateOfBirth, cnic }),
      })
      if (!res.ok) throw new Error(`Duplicate check failed (${res.status})`)
      const data = await res.json()
      setDuplicates(data?.duplicates || [])
      setFailed(false)
    } catch {
      setDuplicates([])
      setFailed(true)
    } finally {
      setChecking(false)
    }
  }, [firstName, lastName, phone, email, dateOfBirth, cnic])

  // Debounce: re-run 1.2 s after last prop change
  useEffect(() => {
    const timer = setTimeout(check, 1200)
    return () => clearTimeout(timer)
  }, [check])

  /* ---- spinner while checking ---- */
  if (checking) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <div className="h-3 w-3 animate-spin rounded-full border border-muted border-t-primary" />
        <span>Checking for duplicates…</span>
      </div>
    )
  }

  if (failed) {
    return (
      <div className="rounded-lg border border-muted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        The duplicate check could not run. Search for this patient before saving.
      </div>
    )
  }

  if (duplicates.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/70 dark:bg-amber-950/30">
      <p className="text-xs font-semibold text-amber-800 mb-2 dark:text-amber-300">
        ⚠ Possible duplicate patient{duplicates.length > 1 ? 's' : ''} detected
      </p>
      <div className="space-y-2">
        {duplicates.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between bg-background rounded border px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">{d.name}</p>
              <p className="text-xs text-muted-foreground">
                {Math.round(d.confidence * 100)}% match · matched on {d.matchFields.join(', ')}
              </p>
            </div>
            {/* type="button": this sits inside the registration form, and a
                plain <button> there submitted it as well as opening the record. */}
            <Button type="button" variant="outline" size="sm" onClick={() => onSelect(d.id)}>
              Use existing
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
