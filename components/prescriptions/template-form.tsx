'use client'

/**
 * Writing down a prescription the clinic gives often.
 *
 * Shared by the new and edit screens, because a template that can be created
 * with fields the editor cannot change is a template somebody has to delete
 * and retype.
 *
 * No teeth here, deliberately. A template says "post-extraction analgesia"; it
 * cannot know it is tooth 46. Teeth belong to the prescription issued from it.
 */
import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import { templateRefusal } from '@/lib/prescription-templates'
import { IconTooltip } from '@/components/ui/icon-action'
import { FormField } from '@/components/ui/form-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { FormActions, FormSection } from '@/components/ui/form-section'
import {
  MedicationPicker,
  medicationLabel,
  type MedicationRow,
} from '@/components/catalogue/medication-picker'
import { toastError, toastSuccess } from '@/lib/toast-utils'

export interface TemplateItemDraft {
  key: number
  medicationId: string | null
  medicationName: string
  dosage: string
  frequency: string
  duration: string
  route: string
  timing: string
  quantity: string
  instructions: string
  /** The linked drug has been deactivated in the catalogue since this line was
      saved (bug report 12 Oct, finding 48). Shown on the row; not sent. */
  inactive?: boolean
}

export interface TemplateDraft {
  name: string
  description: string
  category: string
  diagnosis: string
  notes: string
  items: TemplateItemDraft[]
}

/** A React key per row, so a removed row does not hand its state to the next.
 *  Module state, so it must never reach the DOM — see `idBase` below. */
let draftKey = 0

export function blankItem(): TemplateItemDraft {
  return {
    key: ++draftKey,
    medicationId: null,
    medicationName: '',
    dosage: '',
    frequency: '',
    duration: '',
    route: 'Oral',
    timing: '',
    quantity: '',
    instructions: '',
  }
}

export function emptyDraft(): TemplateDraft {
  return { name: '', description: '', category: '', diagnosis: '', notes: '', items: [blankItem()] }
}

interface TemplateFormProps {
  initial: TemplateDraft
  /** Present when editing. */
  templateId?: string
  submitLabel: string
  /** Where Cancel and a successful save go. Default the template list. */
  backHref?: string
}

/** What is wrong with each field, for the inline errors. */
interface DraftErrors {
  name?: string
  items: Record<number, { medication?: string; dosage?: string; frequency?: string }>
}

/**
 * The inline errors for a draft. The same rules `templateRefusal` applies (and
 * the server runs), said per field; `templateRefusal` stays the last word for
 * anything these do not cover.
 */
function draftErrors(draft: TemplateDraft): DraftErrors {
  const errors: DraftErrors = { items: {} }
  if (!draft.name.trim()) errors.name = 'Give the template a name.'
  draft.items.forEach((item, index) => {
    const blank =
      !item.medicationName.trim() &&
      !item.dosage.trim() &&
      !item.frequency.trim() &&
      !item.duration.trim() &&
      !item.instructions.trim()
    // An untouched extra row is ignored; the only row is not.
    if (blank && draft.items.length > 1) return
    const row: DraftErrors['items'][number] = {}
    if (!item.medicationName.trim()) row.medication = 'Choose a medicine from the catalogue.'
    else if (item.inactive) row.medication = 'Deactivated in the catalogue. Choose another.'
    if (!item.dosage.trim()) row.dosage = 'Give a dosage.'
    if (!item.frequency.trim()) row.frequency = 'Give a frequency.'
    if (Object.keys(row).length) errors.items[index] = row
  })
  return errors
}

function hasErrors(errors: DraftErrors) {
  return Boolean(errors.name) || Object.keys(errors.items).length > 0
}

export function TemplateForm({
  initial,
  templateId,
  submitLabel,
  backHref = '/prescriptions/templates',
}: TemplateFormProps) {
  // The label ↔ input ids. Not `item.key`: that counter is module state, and
  // the server's copy has been counting since it started while the browser's
  // starts at zero — so the ids never matched and React reported a hydration
  // mismatch on every open. `useId` is the same on both; the index keeps rows
  // apart.
  const idBase = useId()
  const router = useRouter()
  const { toast } = useToast()
  const [draft, setDraft] = useState<TemplateDraft>(initial)
  const [saving, setSaving] = useState(false)
  // Not during the navigation a successful save performs.
  const formRef = useFormGuard(saving)
  // Inline errors from the first attempt to save, then live as they are fixed.
  const [showErrors, setShowErrors] = useState(false)
  const errors: DraftErrors = showErrors ? draftErrors(draft) : { items: {} }

  const setField = (field: keyof TemplateDraft, value: string) =>
    setDraft((d) => ({ ...d, [field]: value }))

  const setItem = (index: number, field: keyof TemplateItemDraft, value: string) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }))

  /** Attach a line to a catalogue entry. The name is stored too, because a
      template is copied onto prescriptions and the copy has to read correctly
      even if the catalogue entry is retired later. */
  const selectMedicine = (index: number, med: MedicationRow) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) =>
        i === index
          ? {
              ...item,
              medicationId: med.id,
              medicationName: `${medicationLabel(med)}${med.form ? ` (${med.form})` : ''}`,
              // The search only offers active drugs, so a new choice is one.
              inactive: false,
            }
          : item
      ),
    }))

  const clearMedicine = (index: number) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) =>
        i === index ? { ...item, medicationId: null, medicationName: '', inactive: false } : item
      ),
    }))

  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }))
  const removeItem = (index: number) =>
    setDraft((d) => ({
      ...d,
      // Never leave the form with no rows at all — an empty list offers
      // nothing to type into.
      items: d.items.length === 1 ? [blankItem()] : d.items.filter((_, i) => i !== index),
    }))

  const save = async () => {
    setShowErrors(true)
    const action = templateId ? 'save the template' : 'create the template'
    if (hasErrors(draftErrors(draft))) {
      toast(toastError(action, 'Check the highlighted fields.'))
      // After the errors have rendered, go to the first one.
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('[aria-invalid="true"]')
        first?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
        first?.focus({ preventScroll: true })
      })
      return
    }
    const refusal = templateRefusal(draft)
    if (refusal) {
      toast(toastError(action, refusal))
      return
    }

    setSaving(true)
    try {
      const res = await fetch(
        templateId ? `/api/prescription-templates/${templateId}` : '/api/prescription-templates',
        {
          method: templateId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...draft,
            items: draft.items.map(({ inactive: _inactive, ...item }) => item),
          }),
        }
      )
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save template')

      toast(
        toastSuccess(
          templateId ? 'Template updated' : 'Template created',
          templateId
            ? 'Prescriptions already issued from it are unchanged.'
            : `${draft.name} is ready to use.`
        )
      )
      router.push(backHref)
      router.refresh()
    } catch (error) {
      toast(toastError(action, error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={formRef} className="space-y-6">
      <FormSection
        title="About this template"
        description="Templates are shared with everyone at this clinic."
      >
        <div className="space-y-4">
          <div className="form-grid">
            <FormField label="Name" required htmlFor="template-name" error={errors.name}>
              {(control) => (
                <Input
                  {...control}
                  value={draft.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Post-extraction"
                />
              )}
            </FormField>
            <FormField label="Category" htmlFor="template-category">
              {(control) => (
                <Input
                  {...control}
                  value={draft.category}
                  onChange={(e) => setField('category', e.target.value)}
                  placeholder="Surgical, Endodontic, Paediatric…"
                />
              )}
            </FormField>
          </div>

          <FormField label="Description" htmlFor="template-description">
            {(control) => (
              <Input
                {...control}
                value={draft.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="When to reach for this one"
              />
            )}
          </FormField>

          <FormField
            label="Default diagnosis"
            htmlFor="template-diagnosis"
            hint="Filled in on the prescription and editable there — never locked."
          >
            {(control) => (
              <Input
                {...control}
                value={draft.diagnosis}
                onChange={(e) => setField('diagnosis', e.target.value)}
                placeholder="e.g. Post-surgical extraction site"
              />
            )}
          </FormField>

          <FormField label="Default notes to the patient" htmlFor="template-notes">
            {(control) => (
              <Textarea
                {...control}
                value={draft.notes}
                onChange={(e) => setField('notes', e.target.value)}
                rows={3}
                placeholder="Rinse with warm salt water from tomorrow…"
              />
            )}
          </FormField>
        </div>
      </FormSection>

      {/* Medicines: full width, because each line is a form of its own and
          would be cramped beside a section heading. */}
      <Card>
        <CardHeader>
          <CardTitle>Medicines</CardTitle>
          <CardDescription>
            Copied onto the prescription when the template is used. Editing them later does not
            change prescriptions already issued.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.items.map((item, index) => {
            const itemError = errors.items[index] ?? {}
            return (
              <div key={item.key} className="space-y-4 rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5 text-sm font-semibold">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    Medicine {index + 1}
                  </span>
                  <IconTooltip label={`Remove medicine ${index + 1}`}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove medicine ${index + 1}`}
                      onClick={() => removeItem(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </IconTooltip>
                </div>

                <div className="form-grid">
                  <div className="space-y-2">
                    {/*
                      This was a plain text box with no catalogue behind it at
                      all, so every template line was saved with `medicationId`
                      null — templates referenced the drug catalogue in the
                      schema and never in practice. A template is copied onto
                      real prescriptions, so an unlinked line here became an
                      unlinked line on every prescription made from it.
                    */}
                    <FormField
                      label="Medicine"
                      required
                      htmlFor={`${idBase}-medicine-${index}`}
                      error={itemError.medication}
                    >
                      {(control) => (
                        <MedicationPicker
                          id={control.id}
                          aria-label="Medicine"
                          aria-describedby={control['aria-describedby']}
                          aria-invalid={control['aria-invalid']}
                          value={item.medicationId}
                          selectedLabel={item.medicationName}
                          onSelect={(med) => selectMedicine(index, med)}
                          onClear={() => clearMedicine(index)}
                        />
                      )}
                    </FormField>
                    {item.inactive && !itemError.medication && (
                      <p className="text-xs font-medium text-destructive" role="alert">
                        Inactive — this medicine has been deactivated in the drug catalogue and is
                        left out when the template is used. Choose another or remove the line.
                      </p>
                    )}
                  </div>
                  <FormField label="Dosage" required error={itemError.dosage}>
                    {(control) => (
                      <Input
                        {...control}
                        value={item.dosage}
                        onChange={(e) => setItem(index, 'dosage', e.target.value)}
                        placeholder="1 capsule"
                      />
                    )}
                  </FormField>
                </div>

                <div className="form-grid-3">
                  <FormField label="Frequency" required error={itemError.frequency}>
                    {(control) => (
                      <Input
                        {...control}
                        value={item.frequency}
                        onChange={(e) => setItem(index, 'frequency', e.target.value)}
                        placeholder="Three times a day"
                      />
                    )}
                  </FormField>
                  <FormField label="Duration">
                    {(control) => (
                      <Input
                        {...control}
                        value={item.duration}
                        onChange={(e) => setItem(index, 'duration', e.target.value)}
                        placeholder="5 days"
                      />
                    )}
                  </FormField>
                  <FormField label="Timing">
                    {(control) => (
                      <Input
                        {...control}
                        value={item.timing}
                        onChange={(e) => setItem(index, 'timing', e.target.value)}
                        placeholder="After food"
                      />
                    )}
                  </FormField>
                </div>

                <FormField label="Instructions">
                  {(control) => (
                    <Input
                      {...control}
                      value={item.instructions}
                      onChange={(e) => setItem(index, 'instructions', e.target.value)}
                      placeholder="Finish the course even if the pain settles"
                    />
                  )}
                </FormField>
              </div>
            )
          })}

          <Button type="button" variant="outline" onClick={addItem} className="w-full">
            <Plus className="h-4 w-4" />
            Add another medicine
          </Button>
        </CardContent>
      </Card>

      {/* Submit, pinned to the bottom while the form scrolls */}
      <FormActions>
        <Button asChild variant="outline">
          <Link href={backHref}>Cancel</Link>
        </Button>
        <SubmitButton
          type="button"
          onClick={save}
          busy={saving}
          busyLabel={templateId ? 'Saving…' : 'Creating template…'}
        >
          {submitLabel}
        </SubmitButton>
      </FormActions>
    </div>
  )
}
