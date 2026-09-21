'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { AlertTriangle, Loader2, Search } from 'lucide-react'

interface Candidate {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
}

/**
 * Folding a duplicate record into this one.
 *
 * Two records for one person is the commonest mess a front desk makes, and
 * until now nothing in this application could undo it. The registration form
 * warns about a likely duplicate before it is created; this is what to do about
 * the ones already in the register.
 *
 * Deliberately worded around *this* record surviving. The desk opens the record
 * it means to keep — usually the one with the history on it — and pulls the
 * other one in. Saying "merge A into B" without making clear which survives is
 * how the wrong one gets retired.
 */
export function MergeDialog({
  open,
  onOpenChange,
  patient,
  onMerged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: { id: string; patientId: string; firstName: string; lastName: string }
  onMerged: () => void
}) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search)
  const [results, setResults] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<Candidate | null>(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults([])
      return
    }

    let current = true
    setSearching(true)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/patients?search=${encodeURIComponent(debounced.trim())}&limit=8`
        )
        const data = await res.json()
        if (!current) return
        // Never offer the record being merged into as the record to merge in.
        setResults((data.patients ?? []).filter((p: Candidate) => p.id !== patient.id))
      } catch {
        if (current) setResults([])
      } finally {
        if (current) setSearching(false)
      }
    })()

    return () => {
      current = false
    }
  }, [debounced, patient.id])

  const merge = async () => {
    if (!chosen) return
    setMerging(true)
    setError(null)
    try {
      const res = await fetch(`/api/patients/${patient.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeId: chosen.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Those records could not be merged.')
        return
      }
      close(false)
      onMerged()
    } catch {
      setError('Those records could not be merged.')
    } finally {
      setMerging(false)
    }
  }

  // Closing clears the dialog. Done here rather than in an effect on `open`,
  // which would cascade a render every time the dialog is opened as well.
  const close = (next: boolean) => {
    if (!next) {
      setSearch('')
      setResults([])
      setChosen(null)
      setError(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge a duplicate into this record</DialogTitle>
          <DialogDescription>
            Everything on the other record — appointments, treatments, invoices, prescriptions,
            documents and medical history — moves onto{' '}
            <span className="font-medium">
              {patient.firstName} {patient.lastName} ({patient.patientId})
            </span>
            . The other record is kept but retired, so its patient ID still leads here.
          </DialogDescription>
        </DialogHeader>

        {chosen ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="font-medium">
                {chosen.firstName} {chosen.lastName}
              </p>
              <p className="text-sm text-muted-foreground">
                {chosen.patientId} · {chosen.phone}
              </p>
            </div>

            <div
              className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm">
                This cannot be undone from here. Allergies and conditions from both records are
                kept; blank fields on this record are filled from the other, and nothing already
                filled in is overwritten.
              </p>
            </div>

            <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
              Choose a different record
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Find the duplicate by name, phone or ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-56 overflow-y-auto rounded-lg border">
              {search.trim().length < 2 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Type two letters to search.
                </p>
              ) : searching ? (
                <p className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No other records match.
                </p>
              ) : (
                results.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className="block w-full border-b p-3 text-left last:border-0 hover:bg-muted/50 focus:bg-muted focus:outline-none"
                    onClick={() => setChosen(candidate)}
                  >
                    <span className="block font-medium">
                      {candidate.firstName} {candidate.lastName}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {candidate.patientId} · {candidate.phone}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={merging}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={merge} disabled={!chosen || merging}>
            {merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Merge into this record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
