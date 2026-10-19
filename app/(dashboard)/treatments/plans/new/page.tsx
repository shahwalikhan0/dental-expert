'use client'

import { useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { FormField } from '@/components/ui/form-field'
import { MoneyInput, isInvalidMoney, parseMoney } from '@/components/ui/money-input'
import { PageHeader } from '@/components/ui/page-header'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { SubmitButton } from '@/components/ui/submit-button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker'
import { ProcedurePicker } from '@/components/catalogue/procedure-picker'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { Plus, Trash2 } from 'lucide-react'
import { procedureCategoryConfig } from '@/lib/treatment-utils'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK } from '@/lib/dates'
import { describeTeethByQuadrant, formatTeeth, parseTeeth } from '@/lib/teeth'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

interface Patient extends PickedPatient {
  dateOfBirth?: string | null
}

interface Procedure {
  id: string
  code: string
  name: string
  category: string
  defaultDuration: number
  basePrice: string | number
}

interface PlanItem {
  procedureId: string
  procedureName: string
  procedureCode: string
  category: string
  /** The stored form, `11,12,13`, or '' for none. */
  toothNumbers: string
  estimatedCost: number
  notes: string
}

type Errors = Partial<Record<'patient' | 'title' | 'procedure' | 'cost', string>>

/** The field each error is shown under, in the order they appear on the page. */
const FIELD_IDS: Record<keyof Errors, string> = {
  patient: 'patient',
  title: 'title',
  procedure: 'procedure',
  cost: 'itemCost',
}

export default function NewTreatmentPlanPage() {
  const router = useRouter()
  const trail = useTrail(null)
  const searchParams = useSearchParams()
  // A link from the patient's record hands the patient over (lib/prefill.ts).
  const preselectedPatientId = searchParams.get('patientId')
  const { toast } = useToast()

  const [saving, setSaving] = useState(false)
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard(saving)
  const [errors, setErrors] = useState<Errors>({})

  // Form state
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [startDate, setStartDate] = useState('')
  const [expectedEndDate, setExpectedEndDate] = useState('')
  const [items, setItems] = useState<PlanItem[]>([])

  // The line being added
  // The whole catalogue row, for its list price.
  const [selectedProcedure, setSelectedProcedure] = useState<Procedure | null>(null)
  const [itemTeeth, setItemTeeth] = useState<number[]>([])
  const [itemNotes, setItemNotes] = useState('')
  // The text in the field; parsed with parseMoney, never `Number(x) || 0`.
  const [itemCost, setItemCost] = useState('')

  const clearError = (key: keyof Errors) =>
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))

  const handleAddProcedure = () => {
    if (!selectedProcedure) {
      setErrors((current) => ({ ...current, procedure: 'Choose a procedure to add.' }))
      return
    }
    if (isInvalidMoney(itemCost)) {
      setErrors((current) => ({
        ...current,
        cost: 'Enter an amount like 1500 or 1500.50, or leave it blank for the list price.',
      }))
      return
    }

    const newItem: PlanItem = {
      procedureId: selectedProcedure.id,
      procedureName: selectedProcedure.name,
      procedureCode: selectedProcedure.code,
      category: selectedProcedure.category,
      toothNumbers: formatTeeth(itemTeeth) ?? '',
      // A blank price is the procedure's list price; zero is zero.
      estimatedCost: parseMoney(itemCost) ?? Number(selectedProcedure.basePrice),
      notes: itemNotes,
    }

    setItems([...items, newItem])
    setErrors((current) => ({ ...current, procedure: undefined, cost: undefined }))

    // Ready for the next line
    setSelectedProcedure(null)
    setItemTeeth([])
    setItemNotes('')
    setItemCost('')
  }

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const totalCost = items.reduce((sum, item) => sum + item.estimatedCost, 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const found: Errors = {}
    if (!selectedPatient) found.patient = 'Choose the patient this plan is for.'
    if (!title.trim()) found.title = 'Give the plan a title. The patient sees it on the estimate.'
    if (items.length === 0) found.procedure = 'Add at least one procedure to the plan.'
    setErrors(found)

    const first = (Object.keys(FIELD_IDS) as (keyof Errors)[]).find((key) => found[key])
    if (first || !selectedPatient) {
      toast(toastError('create the treatment plan', 'Check the highlighted fields.'))
      if (first) {
        const field = document.getElementById(FIELD_IDS[first])
        field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        field?.focus({ preventScroll: true })
      }
      return
    }

    setSaving(true)
    try {
      const plan = await readJson<{ id: string; planNumber?: string }>(
        await fetch('/api/treatment-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientId: selectedPatient.id,
            title,
            notes,
            startDate: startDate || null,
            expectedEndDate: expectedEndDate || null,
            items: items.map((item, index) => ({
              procedureId: item.procedureId,
              toothNumbers: item.toothNumbers || null,
              priority: index + 1,
              estimatedCost: item.estimatedCost,
              notes: item.notes || null,
            })),
          }),
        })
      )
      toast(toastSuccess('Treatment plan created', plan.planNumber))
      router.push(`/treatments/plans/${plan.id}`)
    } catch (error) {
      toast(toastError('create the treatment plan', error))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New treatment plan"
        description="Create a comprehensive treatment plan for a patient"
        back={
          <BackLink trail={trail} fallback="/treatments/plans" fallbackLabel="Treatment plans" />
        }
      />

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Patient */}
        <FormSection title="Patient" description="Who this plan is for">
          <FormField label="Patient" htmlFor={FIELD_IDS.patient} required error={errors.patient}>
            {(control) => (
              <PatientPicker<Patient>
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                value={selectedPatient}
                onChange={(patient) => {
                  setSelectedPatient(patient)
                  if (patient) clearError('patient')
                }}
                initialPatientId={preselectedPatientId}
              />
            )}
          </FormField>
        </FormSection>

        {/* Plan details */}
        <FormSection
          title="Plan details"
          description="The title the patient sees on the estimate, and when the work is expected to run"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              label="Title"
              htmlFor={FIELD_IDS.title}
              required
              error={errors.title}
              className="md:col-span-2"
            >
              {(control) => (
                <Input
                  {...control}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    if (e.target.value.trim()) clearError('title')
                  }}
                  placeholder="e.g. Full mouth rehabilitation, orthodontic treatment"
                />
              )}
            </FormField>

            <FormField label="Expected start date" htmlFor="startDate">
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </FormField>
            <FormField label="Expected end date" htmlFor="expectedEndDate">
              <Input
                id="expectedEndDate"
                type="date"
                value={expectedEndDate}
                onChange={(e) => setExpectedEndDate(e.target.value)}
              />
            </FormField>

            <FormField label="Notes" htmlFor="notes" className="md:col-span-2">
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes about the treatment plan…"
                rows={3}
              />
            </FormField>
          </div>
        </FormSection>

        {/* Procedures */}
        <FormSection
          title="Procedures"
          description="Add procedures to the treatment plan in order of priority"
        >
          <div className="space-y-4">
            {/* The plan's lines, numbered in the order they will be done */}
            {items.length > 0 ? (
              <div className="space-y-2">
                <ol className="space-y-2">
                  {items.map((item, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-3 rounded-xl border border-border px-4 py-3"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{item.procedureName}</span>
                          <Badge
                            variant="outline"
                            className={`${procedureCategoryConfig[item.category]?.bgColor} ${procedureCategoryConfig[item.category]?.color} border-0`}
                          >
                            {procedureCategoryConfig[item.category]?.label ?? item.category}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.procedureCode} · Teeth:{' '}
                          {describeTeethByQuadrant(parseTeeth(item.toothNumbers)) || BLANK}
                        </p>
                        {item.notes && (
                          <p className="mt-1 text-sm text-muted-foreground">{item.notes}</p>
                        )}
                      </div>
                      <span className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums">
                        {formatCurrency(item.estimatedCost)}
                      </span>
                      <IconTooltip label="Remove this line">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="-my-1 h-8 w-8 shrink-0"
                          aria-label="Remove this line"
                          onClick={() => handleRemoveItem(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </IconTooltip>
                    </li>
                  ))}
                </ol>
                <div className="flex items-baseline justify-between rounded-xl bg-muted/60 px-4 py-3">
                  <span className="text-sm font-medium">Total estimated cost</span>
                  <span className="text-lg font-bold tabular-nums">
                    {formatCurrency(totalCost)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                No procedures added yet. Add the first one below.
              </div>
            )}

            {/* The line being added */}
            <div className="space-y-4 rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm font-semibold">Add a procedure</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Procedure" htmlFor={FIELD_IDS.procedure} error={errors.procedure}>
                  {(control) => (
                    <ProcedurePicker<Procedure>
                      id={control.id}
                      aria-describedby={control['aria-describedby']}
                      aria-invalid={control['aria-invalid']}
                      value={selectedProcedure?.id ?? null}
                      selectedLabel={selectedProcedure?.name}
                      onSelect={(procedure) => {
                        setSelectedProcedure(procedure)
                        clearError('procedure')
                      }}
                      onClear={() => setSelectedProcedure(null)}
                    />
                  )}
                </FormField>
                <FormField
                  label="Estimated cost"
                  htmlFor={FIELD_IDS.cost}
                  error={errors.cost}
                  hint={
                    selectedProcedure
                      ? `Leave blank for the list price, ${formatCurrency(selectedProcedure.basePrice)}.`
                      : 'Leave blank for the procedure’s list price.'
                  }
                >
                  {(control) => (
                    <MoneyInput
                      {...control}
                      value={itemCost}
                      onChange={(raw) => {
                        setItemCost(raw)
                        clearError('cost')
                      }}
                      placeholder={
                        selectedProcedure ? String(Number(selectedProcedure.basePrice)) : undefined
                      }
                    />
                  )}
                </FormField>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium" id="itemTeethLabel">
                  Teeth
                </p>
                <div role="group" aria-labelledby="itemTeethLabel">
                  <ToothPicker
                    selected={itemTeeth}
                    onChange={setItemTeeth}
                    patientId={selectedPatient?.id}
                    age={selectedPatient?.age}
                    dateOfBirth={selectedPatient?.dateOfBirth}
                  />
                </div>
              </div>

              <FormField label="Notes" htmlFor="itemNotes">
                <Input
                  id="itemNotes"
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="Procedure notes…"
                />
              </FormField>

              <Button
                type="button"
                variant="outline"
                onClick={handleAddProcedure}
                disabled={!selectedProcedure}
              >
                <Plus className="h-4 w-4" />
                Add procedure
              </Button>
            </div>
          </div>
        </FormSection>

        <FormActions
          hint={
            items.length > 0
              ? `${items.length} procedure${items.length === 1 ? '' : 's'} · ${formatCurrency(totalCost)}`
              : undefined
          }
        >
          <Button type="button" variant="outline" asChild>
            <Link href={trail.back('/treatments/plans')}>Cancel</Link>
          </Button>
          <SubmitButton busy={saving} busyLabel="Creating treatment plan…">
            Create treatment plan
          </SubmitButton>
        </FormActions>
      </form>
    </div>
  )
}
