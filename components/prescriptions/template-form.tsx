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
import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import { templateRefusal } from '@/lib/prescription-templates'
import { IconTooltip } from '@/components/ui/icon-action'
import { SearchSelect, type SearchOption } from '@/components/ui/search-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

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
}

export function TemplateForm({ initial, templateId, submitLabel }: TemplateFormProps) {
  // The label ↔ input ids. Not `item.key`: that counter is module state, and
  // the server's copy has been counting since it started while the browser's
  // starts at zero — so the ids never matched and React reported a hydration
  // mismatch on every open. `useId` is the same on both; the index keeps rows
  // apart.
  const idBase = useId()
  const router = useRouter()
  const { toast } = useToast()
  const formRef = useFormGuard()
  const [draft, setDraft] = useState<TemplateDraft>(initial)
  const [saving, setSaving] = useState(false)

  const setField = (field: keyof TemplateDraft, value: string) =>
    setDraft((d) => ({ ...d, [field]: value }))

  // The drug catalogue, searched server-side as the user types. The same
  // endpoint and the same debounce as the prescription form, so the two fields
  // behave identically — they are the same question asked twice.
  const [medSearch, setMedSearch] = useState('')
  const debouncedMedSearch = useDebouncedValue(medSearch)
  const [medOptions, setMedOptions] = useState<SearchOption[]>([])
  const [searchingMeds, setSearchingMeds] = useState(false)

  useEffect(() => {
    const term = debouncedMedSearch.trim()
    if (term.length < 2) {
      setMedOptions([])
      return
    }
    let current = true
    setSearchingMeds(true)
    fetch(`/api/medications?search=${encodeURIComponent(term)}&limit=10&active=true&sort=name`)
      .then((res) => res.json())
      .then((result) => {
        if (!current) return
        setMedOptions(
          (result.data || []).map((med: any) => ({
            id: med.id,
            label: `${med.name}${med.strength ? ` ${med.strength}` : ''}`,
            hint: med.form || undefined,
            detail: med.genericName || undefined,
          }))
        )
      })
      .catch(() => {
        if (current) setMedOptions([])
      })
      .finally(() => {
        if (current) setSearchingMeds(false)
      })
    return () => {
      current = false
    }
  }, [debouncedMedSearch])

  const setItem = (index: number, field: keyof TemplateItemDraft, value: string) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }))

  /** Attach a line to a catalogue entry. The name is stored too, because a
      template is copied onto prescriptions and the copy has to read correctly
      even if the catalogue entry is retired later. */
  const selectMedicine = (index: number, option: SearchOption) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) =>
        i === index
          ? {
              ...item,
              medicationId: option.id,
              medicationName: `${option.label}${option.hint ? ` (${option.hint})` : ''}`,
            }
          : item
      ),
    }))

  const clearMedicine = (index: number) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) =>
        i === index ? { ...item, medicationId: null, medicationName: '' } : item
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
    const refusal = templateRefusal(draft)
    if (refusal) {
      toast({ variant: 'destructive', title: 'Not saved', description: refusal })
      return
    }

    setSaving(true)
    try {
      const res = await fetch(
        templateId ? `/api/prescription-templates/${templateId}` : '/api/prescription-templates',
        {
          method: templateId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        }
      )
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save template')

      toast({
        title: templateId ? 'Template updated' : 'Template created',
        description: templateId
          ? 'Prescriptions already issued from it are unchanged.'
          : `${draft.name} is ready to use.`,
      })
      router.push('/prescriptions/templates')
      router.refresh()
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Not saved', description: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={formRef} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>About this template</CardTitle>
          <CardDescription>Templates are shared with everyone at this clinic.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="form-grid">
            <div className="space-y-2">
              <Label htmlFor="template-name" className="label-required">
                Name
              </Label>
              <Input
                id="template-name"
                value={draft.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Post-extraction"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-category">Category</Label>
              <Input
                id="template-category"
                value={draft.category}
                onChange={(e) => setField('category', e.target.value)}
                placeholder="Surgical, Endodontic, Paediatric…"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description">Description</Label>
            <Input
              id="template-description"
              value={draft.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="When to reach for this one"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-diagnosis">Default diagnosis</Label>
            <Input
              id="template-diagnosis"
              value={draft.diagnosis}
              onChange={(e) => setField('diagnosis', e.target.value)}
              placeholder="e.g. Post-surgical extraction site"
            />
            <p className="text-muted-foreground text-xs">
              Filled in on the prescription and editable there — never locked.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-notes">Default notes to the patient</Label>
            <Textarea
              id="template-notes"
              value={draft.notes}
              onChange={(e) => setField('notes', e.target.value)}
              rows={3}
              placeholder="Rinse with warm salt water from tomorrow…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Medicines</CardTitle>
          <CardDescription>
            Copied onto the prescription when the template is used. Editing them later does not
            change prescriptions already issued.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.items.map((item, index) => (
            <div key={item.key} className="space-y-3 rounded-xl border border-border/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm font-medium">
                  Medicine {index + 1}
                </span>
                <IconTooltip label="Remove this medicine">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove this medicine"
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                  </Button>
                </IconTooltip>
              </div>

              <div className="form-grid">
                <div className="space-y-2">
                  <Label className="label-required" htmlFor={`${idBase}-medicine-${index}`}>
                    Medicine
                  </Label>
                  {/*
                    This was a plain text box with no catalogue behind it at
                    all, so every template line was saved with `medicationId`
                    null — templates referenced the drug catalogue in the
                    schema and never in practice. A template is copied onto
                    real prescriptions, so an unlinked line here became an
                    unlinked line on every prescription made from it.
                  */}
                  <SearchSelect
                    id={`${idBase}-medicine-${index}`}
                    value={item.medicationId}
                    selectedLabel={item.medicationName}
                    options={medOptions}
                    loading={searchingMeds}
                    onSearchChange={setMedSearch}
                    onSelect={(option) => selectMedicine(index, option)}
                    onClear={() => clearMedicine(index)}
                    placeholder="Search the drug catalogue…"
                    emptyMessage={
                      debouncedMedSearch.trim().length < 2
                        ? 'Type at least two letters to search.'
                        : `Nothing in the catalogue matches “${debouncedMedSearch.trim()}”.`
                    }
                    emptyAction={
                      debouncedMedSearch.trim().length >= 2 ? (
                        <Link
                          href="/medications"
                          target="_blank"
                          className="text-sm text-primary hover:underline"
                        >
                          Add it to the drug catalogue
                        </Link>
                      ) : null
                    }
                    aria-label="Medicine"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="label-required">Dosage</Label>
                  <Input
                    value={item.dosage}
                    onChange={(e) => setItem(index, 'dosage', e.target.value)}
                    placeholder="1 capsule"
                  />
                </div>
              </div>

              <div className="form-grid-3">
                <div className="space-y-2">
                  <Label className="label-required">Frequency</Label>
                  <Input
                    value={item.frequency}
                    onChange={(e) => setItem(index, 'frequency', e.target.value)}
                    placeholder="Three times a day"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Duration</Label>
                  <Input
                    value={item.duration}
                    onChange={(e) => setItem(index, 'duration', e.target.value)}
                    placeholder="5 days"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Timing</Label>
                  <Input
                    value={item.timing}
                    onChange={(e) => setItem(index, 'timing', e.target.value)}
                    placeholder="After food"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Instructions</Label>
                <Input
                  value={item.instructions}
                  onChange={(e) => setItem(index, 'instructions', e.target.value)}
                  placeholder="Finish the course even if the pain settles"
                />
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" onClick={addItem} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Add another medicine
          </Button>
        </CardContent>
      </Card>

      <div className="page-actions justify-end">
        <Button asChild variant="outline">
          <Link href="/prescriptions/templates">Cancel</Link>
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
