'use client'

/**
 * Completing a treatment: the closing notes, the follow-up, and the POST.
 *
 * One dialog for both ways in. The treatment's own page asked for the
 * procedure notes, materials, complications and follow-up before completing;
 * the list's "Complete treatment" posted an empty body straight away, so the
 * same act left a different record depending on which screen it was done from
 * — and with no question asked, a mis-click in a row menu closed somebody's
 * treatment. Both now open this.
 *
 *   <CompleteTreatmentDialog
 *     treatment={completing}            // { id, treatmentNo } or null (closed)
 *     initial={completionNotesOf(t)}    // omit to read the notes from the route
 *     onClose={() => setCompleting(null)}
 *     onCompleted={reload}
 *   />
 *
 * The notes are prefilled with what the treatment already holds, so
 * completing never blanks them. Where the caller has not got them (a list row
 * carries no notes), they are read from `/api/treatments/{id}` first, and the
 * dialog will not complete until they have arrived: an empty form sent back
 * would overwrite the notes with nothing.
 */
import * as React from 'react'
import { CheckCircle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SubmitButton } from '@/components/ui/submit-button'
import { Textarea } from '@/components/ui/textarea'
import { VoiceInput } from '@/components/clinical/voice-input'
import { displayDate } from '@/lib/dates'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

/** What the completion form sends. */
export interface CompletionNotes {
  procedureNotes: string
  materialsUsed: string
  complications: string
  followUpRequired: boolean
  followUpDate: string
}

const EMPTY: CompletionNotes = {
  procedureNotes: '',
  materialsUsed: '',
  complications: '',
  followUpRequired: false,
  followUpDate: '',
}

/** The form's starting values from a treatment as the route returns it. */
export function completionNotesOf(treatment: {
  procedureNotes?: string | null
  materialsUsed?: string | null
  complications?: string | null
  followUpRequired?: boolean | null
  followUpDate?: string | null
}): CompletionNotes {
  return {
    procedureNotes: treatment.procedureNotes || '',
    materialsUsed: treatment.materialsUsed || '',
    complications: treatment.complications || '',
    followUpRequired: treatment.followUpRequired || false,
    followUpDate: treatment.followUpDate ? treatment.followUpDate.split('T')[0] : '',
  }
}

export interface CompleteTreatmentDialogProps {
  /** The treatment to complete; null keeps the dialog closed. */
  treatment: { id: string; treatmentNo: string } | null
  /** The notes the treatment holds now. Omit to have the dialog read them. */
  initial?: CompletionNotes
  onClose: () => void
  /** After the route has completed it. */
  onCompleted: () => void
}

export function CompleteTreatmentDialog({
  treatment,
  initial,
  onClose,
  onCompleted,
}: CompleteTreatmentDialogProps) {
  const { toast } = useToast()
  const [form, setForm] = React.useState<CompletionNotes>(initial ?? EMPTY)
  const [saving, setSaving] = React.useState(false)
  // Whether the notes the form starts from have arrived, and whether reading
  // them failed. With `initial` they are there from the start.
  const [prefilled, setPrefilled] = React.useState(Boolean(initial))
  const [prefillFailed, setPrefillFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)

  // A fresh form each time a treatment is opened. Reset while rendering, so
  // the first frame shows this treatment's notes and not the last one's.
  const openId = treatment?.id ?? null
  const [seenId, setSeenId] = React.useState<string | null>(openId)
  // Kept after closing, so the title does not empty while the dialog fades.
  const [shownNo, setShownNo] = React.useState(treatment?.treatmentNo ?? '')
  if (openId !== seenId) {
    setSeenId(openId)
    if (treatment) setShownNo(treatment.treatmentNo)
    setForm(initial ?? EMPTY)
    setPrefilled(Boolean(initial))
    setPrefillFailed(false)
  }

  React.useEffect(() => {
    if (!openId || prefilled) return
    let current = true
    ;(async () => {
      try {
        const data = await readJson<Parameters<typeof completionNotesOf>[0]>(
          await fetch(`/api/treatments/${openId}`)
        )
        if (!current) return
        setForm(completionNotesOf(data))
        setPrefilled(true)
      } catch {
        if (current) setPrefillFailed(true)
      }
    })()
    return () => {
      current = false
    }
  }, [openId, prefilled, attempt])

  const set = <K extends keyof CompletionNotes>(key: K, value: CompletionNotes[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const handleComplete = async () => {
    if (!treatment) return
    setSaving(true)
    try {
      const result = await readJson<{ recallsMoved?: { name: string; dueDate: string }[] }>(
        await fetch(`/api/treatments/${treatment.id}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      )
      // A recall this procedure is the visit for has moved on with it; say
      // where to, so the desk does not press Mark as done a second time.
      const moved = result.recallsMoved ?? []
      toast(
        toastSuccess(
          `Treatment ${treatment.treatmentNo} completed`,
          moved.length > 0
            ? moved
                .map((recall) => `${recall.name} recall now due ${displayDate(recall.dueDate)}`)
                .join('. ')
            : undefined
        )
      )
      onClose()
      onCompleted()
    } catch (error) {
      toast(toastError(`complete treatment ${treatment.treatmentNo}`, error))
    } finally {
      setSaving(false)
    }
  }

  const waiting = !prefilled

  return (
    <Dialog open={Boolean(treatment)} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Complete treatment {shownNo}</DialogTitle>
          <DialogDescription>Add the final notes, then complete the treatment.</DialogDescription>
        </DialogHeader>

        {prefillFailed ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">
              The treatment&rsquo;s notes could not be loaded, so it cannot be completed from here
              without overwriting them.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPrefillFailed(false)
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4" aria-busy={waiting || undefined}>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="complete-procedureNotes">Procedure notes</Label>
                <VoiceInput
                  onTranscript={(text) =>
                    setForm((prev) => ({
                      ...prev,
                      procedureNotes: prev.procedureNotes ? prev.procedureNotes + ' ' + text : text,
                    }))
                  }
                />
              </div>
              <Textarea
                id="complete-procedureNotes"
                value={form.procedureNotes}
                onChange={(e) => set('procedureNotes', e.target.value)}
                placeholder="Final procedure notes… (use the mic to dictate)"
                rows={3}
                disabled={waiting}
              />
            </div>

            <FormField label="Materials used">
              {(control) => (
                <Textarea
                  {...control}
                  value={form.materialsUsed}
                  onChange={(e) => set('materialsUsed', e.target.value)}
                  placeholder="List the materials used…"
                  rows={2}
                  disabled={waiting}
                />
              )}
            </FormField>

            <FormField label="Complications (if any)">
              {(control) => (
                <Textarea
                  {...control}
                  value={form.complications}
                  onChange={(e) => set('complications', e.target.value)}
                  placeholder="Record any complications…"
                  rows={2}
                  disabled={waiting}
                />
              )}
            </FormField>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="complete-followUpRequired"
                checked={form.followUpRequired}
                onCheckedChange={(checked) => set('followUpRequired', checked === true)}
                disabled={waiting}
              />
              <Label htmlFor="complete-followUpRequired">Follow-up required</Label>
            </div>

            {form.followUpRequired && (
              <FormField label="Follow-up date">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={form.followUpDate}
                    onChange={(e) => set('followUpDate', e.target.value)}
                    disabled={waiting}
                  />
                )}
              </FormField>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            type="button"
            onClick={handleComplete}
            busy={saving}
            busyLabel="Completing…"
            icon={CheckCircle}
            disabled={waiting}
          >
            Complete treatment
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
