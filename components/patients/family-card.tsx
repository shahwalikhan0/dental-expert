'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Loader2, Search, UserMinus, Users, Wallet } from 'lucide-react'

interface Member {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  isGuarantor: boolean
}

interface Family {
  guarantorId: string
  members: Member[]
  isShared: boolean
}

interface Candidate {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
}

/**
 * Who settles this patient's bills, and who this patient settles for.
 *
 * A practice bills households, not individuals: a mother brings three children
 * who hold three records, and one statement should go out. Without somewhere
 * to record that, the clinic sends four — one of them to a seven-year-old.
 *
 * Shown on every patient, including the common case of somebody who pays for
 * themselves, because a blank where the payer goes is the thing that prompts
 * the desk to fill it in. A card that appears only once a guarantor exists
 * would never be discovered.
 */
export function FamilyCard({
  patientId,
  patientName,
  canEdit,
}: {
  patientId: string
  patientName: string
  canEdit: boolean
}) {
  const { toast } = useToast()
  const [family, setFamily] = useState<Family | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/family`)
      if (res.ok) setFamily(await res.json())
    } catch {
      /* The card simply does not render. Nothing else on the record depends
         on it, and a failed side panel should not take the page down. */
    }
  }, [patientId])

  useEffect(() => {
    load()
  }, [load])

  const setGuarantor = async (guarantorId: string | null) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/patients/${patientId}/family`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guarantorId }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast({ title: 'Not changed', description: data.error, variant: 'destructive' })
        return
      }

      setFamily(data)
      setOpen(false)
      toast({
        title: guarantorId ? 'Account updated' : 'Now pays for themselves',
        description: guarantorId
          ? `${patientName}’s bills will be settled on somebody else’s account.`
          : `${patientName} is responsible for their own bills again.`,
      })
    } catch {
      toast({ title: 'Not changed', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (!family) return null

  const guarantor = family.members.find((member) => member.isGuarantor)
  const paysForThemselves = family.guarantorId === patientId
  const dependants = family.members.filter((member) => member.id !== patientId)

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Account
            </CardTitle>
            <CardDescription>Who settles the bills</CardDescription>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {paysForThemselves ? 'Set a payer' : 'Change'}
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Billed to</p>
              {paysForThemselves ? (
                <p className="font-medium">This patient</p>
              ) : (
                <p className="font-medium">
                  <Link href={`/patients/${guarantor?.id}`} className="hover:underline">
                    {guarantor?.firstName} {guarantor?.lastName}
                  </Link>{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({guarantor?.patientId})
                  </span>
                </p>
              )}
            </div>
          </div>

          {paysForThemselves && dependants.length > 0 && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Also on this account ({dependants.length})
              </p>
              <ul className="space-y-1.5">
                {dependants.map((member) => (
                  <li key={member.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link href={`/patients/${member.id}`} className="font-medium hover:underline">
                      {member.firstName} {member.lastName}
                    </Link>
                    <Badge variant="outline" className="shrink-0">
                      {member.patientId}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {paysForThemselves && dependants.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nobody else is billed to this patient. Set a payer above if somebody else settles
              their bills.
            </p>
          )}
        </CardContent>
      </Card>

      <GuarantorDialog
        open={open}
        onOpenChange={setOpen}
        patientId={patientId}
        patientName={patientName}
        currentGuarantorId={paysForThemselves ? null : family.guarantorId}
        saving={saving}
        onChoose={setGuarantor}
      />
    </>
  )
}

function GuarantorDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  currentGuarantorId,
  saving,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName: string
  currentGuarantorId: string | null
  saving: boolean
  onChoose: (guarantorId: string | null) => void
}) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const [results, setResults] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open || debounced.trim().length < 2) {
      setResults([])
      return
    }

    let cancelled = false
    setSearching(true)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/patients?search=${encodeURIComponent(debounced.trim())}&limit=8`
        )
        if (!res.ok) throw new Error()
        const data = await res.json()
        // The patient themselves is never an option; the database refuses it
        // and offering it would be a control that only produces an error.
        if (!cancelled) {
          setResults((data.patients ?? []).filter((row: Candidate) => row.id !== patientId))
        }
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debounced, open, patientId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Who settles {patientName}’s bills?</DialogTitle>
          <DialogDescription>
            Their invoices stay on their own record. What changes is whose statement they appear on
            and who the clinic chases for payment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, patient number or phone"
              className="pl-9"
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {searching && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />
                Searching…
              </p>
            )}

            {!searching && debounced.trim().length >= 2 && results.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Nobody on the register matches “{debounced.trim()}”.
              </p>
            )}

            {results.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                disabled={saving}
                onClick={() => onChoose(candidate.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
              >
                <span>
                  <span className="font-medium">
                    {candidate.firstName} {candidate.lastName}
                  </span>
                  <span className="block text-xs text-muted-foreground">{candidate.phone}</span>
                </span>
                <Badge variant="outline" className="shrink-0">
                  {candidate.patientId}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {currentGuarantorId ? (
            <Button variant="outline" disabled={saving} onClick={() => onChoose(null)}>
              <UserMinus className="mr-2 h-4 w-4" />
              They pay for themselves
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
