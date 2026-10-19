'use client'

import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormSection } from '@/components/ui/form-section'
import {
  // COMMON_ALLERGIES, // Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
  COMMON_CONDITIONS,
  normalizeList,
  type MedicalHistoryInput,
} from '@/lib/medical-history'

/**
 * What a clinician needs to know before picking up a handpiece — asked at the
 * desk, where the patient is standing.
 *
 * `MedicalHistory` has existed in the schema all along and no screen ever wrote
 * to it. The only two paths that created a row were the seed and a patient
 * merge, which means every patient registered through the application had an
 * empty history, and every safety check reading one — the allergy clash on a
 * prescription (lib/medical-history.ts), the alert strip on an appointment, the
 * banner in a video consultation — was silently checking nothing. Those are the
 * checks that matter most on the day they first have something to say.
 *
 * Three lists, matching the three `String[]` columns. The habits, pregnancy and
 * dental-anxiety fields are deliberately not here: they are a longer intake
 * conversation than registration, and a form that asks everything at the desk
 * is a form that gets half-filled.
 */
/**
 * A list of short free-text entries, with a set of common ones to hand.
 *
 * Typed rather than picked from a fixed menu, because the menu can only ever
 * hold what somebody thought of when it was written — the reasoning in
 * lib/medical-history.ts for why these are string lists at all. The suggestions
 * are there so that the common cases stay spelled the same way across a
 * clinic's records and stay findable by a query.
 */
function ListField({
  id,
  label,
  description,
  placeholder,
  suggestions = [],
  values,
  onChange,
  tone = 'secondary',
}: {
  id: string
  label: string
  description: string
  placeholder: string
  suggestions?: readonly string[]
  values: string[]
  onChange: (next: string[]) => void
  tone?: 'secondary' | 'destructive'
}) {
  const [draft, setDraft] = React.useState('')

  const chosen = new Set(values.map((value) => value.toLowerCase()))

  const add = (raw: string) => {
    // Split on commas so a paste of "Penicillin, Latex" lands as two entries
    // rather than one unsearchable string. normalizeList does the trimming and
    // the case-insensitive de-duplication, and is the same function the API
    // runs on the way in.
    const next = normalizeList([...values, ...raw.split(',')])
    if (next.length !== values.length) onChange(next)
    setDraft('')
  }

  const remove = (value: string) => {
    onChange(values.filter((entry) => entry !== value))
  }

  const unusedSuggestions = suggestions.filter(
    (suggestion) => !chosen.has(suggestion.toLowerCase())
  )

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <p className="text-muted-foreground text-xs">{description}</p>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant={tone} className="gap-1 pr-1">
              {value}
              <button
                type="button"
                onClick={() => remove(value)}
                aria-label={`Remove ${value}`}
                className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            // Swallowed, or Enter in this field would submit the registration
            // form with the entry still sitting in the box unrecorded.
            event.preventDefault()
            if (draft.trim()) add(draft)
          }}
          // Half-typed text is the commonest way a list like this loses an
          // entry: the user types "Penicillin", clicks Save, and it is gone.
          onBlur={() => {
            if (draft.trim()) add(draft)
          }}
          placeholder={placeholder}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => draft.trim() && add(draft)}
          disabled={!draft.trim()}
          aria-label={`Add to ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {unusedSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className="rounded-full border border-border/60 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function MedicalHistoryFields({
  values,
  onChange,
}: {
  values: MedicalHistoryInput
  onChange: (next: MedicalHistoryInput) => void
}) {
  const setList = (field: keyof MedicalHistoryInput) => (next: string[]) =>
    onChange({ ...values, [field]: next })

  return (
    <FormSection
      title="Medical history"
      description="What a clinician needs to know before treating this patient."
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Allergies are hidden for now (19 Oct 2026); uncomment to bring them back. Put md:grid-cols-3 back with it.
        <ListField
          id="allergies"
          label="Allergies"
          description="Drugs, foods and materials alike — latex and local anaesthetic belong here."
          placeholder="e.g. Penicillin"
          suggestions={COMMON_ALLERGIES}
          values={values.allergies}
          onChange={setList('allergies')}
          tone="destructive"
        />
        */}
        <ListField
          id="conditions"
          label="Medical conditions"
          description="Ongoing conditions. The first few change what happens in the chair."
          placeholder="e.g. Diabetes"
          suggestions={COMMON_CONDITIONS}
          values={values.conditions}
          onChange={setList('conditions')}
        />
        <ListField
          id="currentMedications"
          label="Current medications"
          description="What the patient is already taking, with the dose if they know it."
          placeholder="e.g. Metformin 500mg"
          values={values.currentMedications}
          onChange={setList('currentMedications')}
        />
      </div>
    </FormSection>
  )
}
