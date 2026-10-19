'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker'
import { useToast } from '@/hooks/use-toast'
import { toastError, readJson } from '@/lib/toast-utils'
import { AlertTriangle, Merge } from 'lucide-react'

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
  const [chosen, setChosen] = useState<PickedPatient | null>(null)
  const [merging, setMerging] = useState(false)
  const { toast } = useToast()

  const merge = async () => {
    if (!chosen) return
    setMerging(true)
    try {
      const res = await fetch(`/api/patients/${patient.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeId: chosen.id }),
      })
      await readJson(res)
      close(false)
      onMerged()
    } catch (err) {
      toast(toastError('merge the records', err))
    } finally {
      setMerging(false)
    }
  }

  // Closing clears the dialog. Done here rather than in an effect on `open`,
  // which would cascade a render every time the dialog is opened as well.
  const close = (next: boolean) => {
    if (!next) setChosen(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
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

        {/* The shared picker, with this record left out of the results:
            a record cannot be merged into itself. Its "Change" button is the
            way to choose a different record. */}
        <FormField label="The duplicate to merge in" htmlFor="merge-duplicate">
          {(control) => (
            <PatientPicker
              {...control}
              value={chosen}
              onChange={setChosen}
              excludeId={patient.id}
              placeholder="Find the duplicate by name, phone or ID…"
              aria-label="The duplicate to merge in"
            />
          )}
        </FormField>

        {chosen && (
          <div
            className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm">
              This cannot be undone from here. Medical conditions from both records are kept; blank
              fields on this record are filled from the other, and nothing already filled in is
              overwritten.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={merging}>
            Cancel
          </Button>
          <SubmitButton
            type="button"
            variant="destructive"
            onClick={merge}
            disabled={!chosen}
            busy={merging}
            busyLabel="Merging…"
            icon={Merge}
          >
            Merge into this record
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
