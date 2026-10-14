'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker'
import { useToast } from '@/hooks/use-toast'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { UserMinus, Users, Wallet } from 'lucide-react'

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
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

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
      const data = await readJson<Family>(res)

      setFamily(data)
      setOpen(false)
      toast(
        toastSuccess(
          guarantorId ? 'Payer changed' : 'Now pays for themselves',
          guarantorId
            ? `${patientName}’s bills will be settled on somebody else’s account.`
            : `${patientName} is responsible for their own bills again.`
        )
      )
    } catch (err) {
      toast(toastError('change who pays', err))
    } finally {
      setSaving(false)
    }
  }

  // Taking a patient off somebody else's account moves their unpaid bills
  // back onto their own statement — asked first, like every other removal.
  const payForThemselves = async () => {
    const payer = family?.members.find((member) => member.isGuarantor)
    setOpen(false)
    const ok = await confirm({
      title: `Take ${patientName} off ${payer ? `${payer.firstName} ${payer.lastName}’s` : 'this'} account?`,
      description: `${patientName}’s bills will appear on their own statement again, and the clinic will ask them for payment.`,
      confirmLabel: 'They pay for themselves',
      cancelLabel: 'Keep the payer',
    })
    if (ok) await setGuarantor(null)
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
        onPayForThemselves={payForThemselves}
      />
      {ConfirmDialogComponent}
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
  onPayForThemselves,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName: string
  currentGuarantorId: string | null
  saving: boolean
  onChoose: (guarantorId: string) => void
  onPayForThemselves: () => void
}) {
  const [payer, setPayer] = useState<PickedPatient | null>(null)

  // Closing — by Cancel, or after a save — clears the choice, so the dialog
  // opens empty next time. Adjusted during render, not in an effect.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setPayer(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Who settles {patientName}’s bills?</DialogTitle>
          <DialogDescription>
            Their invoices stay on their own record. What changes is whose statement they appear on
            and who the clinic chases for payment.
          </DialogDescription>
        </DialogHeader>

        {/* The patient themselves is never an option; the database refuses it
            and offering it would be a control that only produces an error. */}
        <FormField label="Billed to" htmlFor="guarantor-picker">
          {(control) => (
            <PatientPicker
              {...control}
              value={payer}
              onChange={setPayer}
              excludeId={patientId}
              filter={(candidate) => candidate.id !== currentGuarantorId}
              aria-label="Who pays"
            />
          )}
        </FormField>

        <DialogFooter className="gap-2">
          {currentGuarantorId && (
            <Button
              variant="ghost"
              className="sm:mr-auto"
              disabled={saving}
              onClick={onPayForThemselves}
            >
              <UserMinus className="mr-2 h-4 w-4" />
              They pay for themselves
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            type="button"
            disabled={!payer}
            busy={saving}
            busyLabel="Saving…"
            onClick={() => payer && onChoose(payer.id)}
          >
            {payer ? `Bill to ${payer.firstName} ${payer.lastName}` : 'Choose a payer'}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
