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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { FormField } from '@/components/ui/form-field'
import { MoneyInput, isInvalidMoney, parseMoney } from '@/components/ui/money-input'
import { PageHeader } from '@/components/ui/page-header'
import { SubmitButton } from '@/components/ui/submit-button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker'
import { ProcedurePicker } from '@/components/catalogue/procedure-picker'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { User, Plus, Trash2, GripVertical } from 'lucide-react'
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Patient
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* Plan details */}
        <Card>
          <CardHeader>
            <CardTitle>Plan details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Title" htmlFor={FIELD_IDS.title} required error={errors.title}>
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

            <FormField label="Notes" htmlFor="notes">
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes about the treatment plan…"
                rows={3}
              />
            </FormField>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </div>
          </CardContent>
        </Card>

        {/* Procedures */}
        <Card>
          <CardHeader>
            <CardTitle>Procedures</CardTitle>
            <CardDescription>
              Add procedures to the treatment plan in order of priority
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* The line being added */}
            <div className="p-4 border rounded-lg bg-muted/50 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <Plus className="h-4 w-4 mr-2" />
                Add procedure
              </Button>
            </div>

            {/* The plan's lines */}
            {items.length > 0 && (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Procedure</TableHead>
                      <TableHead>Teeth</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                            {index + 1}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{item.procedureName}</div>
                          <div className="text-sm text-muted-foreground">{item.procedureCode}</div>
                          <Badge
                            variant="outline"
                            className={`mt-1 ${procedureCategoryConfig[item.category]?.bgColor} ${procedureCategoryConfig[item.category]?.color} border-0`}
                          >
                            {procedureCategoryConfig[item.category]?.label ?? item.category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {describeTeethByQuadrant(parseTeeth(item.toothNumbers)) || BLANK}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(item.estimatedCost)}
                        </TableCell>
                        <TableCell>
                          <IconTooltip label="Remove this line">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Remove this line"
                              onClick={() => handleRemoveItem(index)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </IconTooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3} className="text-right font-medium">
                        Total estimated cost
                      </TableCell>
                      <TableCell className="text-right font-bold text-lg tabular-nums">
                        {formatCurrency(totalCost)}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" asChild>
            <Link href={trail.back('/treatments/plans')}>Cancel</Link>
          </Button>
          <SubmitButton busy={saving} busyLabel="Creating treatment plan…">
            Create treatment plan
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}
