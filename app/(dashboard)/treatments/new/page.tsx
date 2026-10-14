'use client'

import { useState, useEffect, useMemo } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { isoDay } from '@/lib/dates'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { User, Stethoscope, Save } from 'lucide-react'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { PatientPicker } from '@/components/patients/patient-picker'
import { ProcedurePicker } from '@/components/catalogue/procedure-picker'
import { FormField } from '@/components/ui/form-field'
import { MoneyInput, parseMoney } from '@/components/ui/money-input'
import { PageHeader } from '@/components/ui/page-header'
import { SubmitButton } from '@/components/ui/submit-button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/i18n/format'
import { formatTeeth, parseTeeth } from '@/lib/teeth'
import { readJson, toastError } from '@/lib/toast-utils'
import { VoiceInput } from '@/components/clinical/voice-input'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  email: string | null
  /** On a patient fetched by id. The search answers with `age` instead. */
  dateOfBirth?: string | null
  age?: number | null
}

interface Doctor {
  id: string
  firstName: string
  lastName: string
  specialization: string | null
}

interface Procedure {
  id: string
  code: string
  name: string
  category: string
  description: string | null
  defaultDuration: number
  basePrice: string | number
  materials: string | null
  defaultDiagnosis: string | null
  defaultFindings: string | null
  defaultProcedureNotes: string | null
  defaultFollowUpDays: number | null
}

/** The note fields a procedure can prefill. */
interface TreatmentNoteFields {
  diagnosis: string
  findings: string
  procedureNotes: string
  materialsUsed: string
  followUpRequired: boolean
  followUpDate: string
}

/**
 * Merge a procedure's boilerplate onto whatever is already typed.
 *
 * This is the "treatment template" feature. It lives on Procedure rather than
 * in a template model of its own because a Procedure already is the template
 * for a treatment — see the comments on model Procedure.
 *
 * Three rules, all deliberate:
 *
 * 1. It fills blanks only. Picking a procedure, typing into the findings, then
 *    realising you picked the wrong one and switching would otherwise throw
 *    the typing away with no undo. Correcting a mis-click must not cost a
 *    paragraph.
 * 2. It copies, and nothing reads through the procedure at render time. A
 *    Treatment can be signed, and the signature has to attest to fixed words;
 *    rendering from the catalogue would let an edit next year rewrite a note
 *    signed last year.
 * 3. `followUpRequired` is only ever switched on. A procedure with no default
 *    must not un-tick a box the dentist ticked by hand.
 */
function withProcedureDefaults<T extends TreatmentNoteFields>(
  form: T,
  procedure: Procedure | null
): T {
  if (!procedure) return form

  const fill = (current: string, fallback: string | null) =>
    current.trim() ? current : fallback || ''

  let followUpDate = form.followUpDate
  let followUpRequired = form.followUpRequired
  const days = procedure.defaultFollowUpDays
  if (!followUpDate && days !== null && days !== undefined) {
    // Days from today, resolved here because a catalogue entry cannot know
    // when it will be used. `isoDay` builds the value from local parts, so the
    // date does not slide a day for anyone east of Greenwich after midday.
    const due = new Date()
    due.setDate(due.getDate() + days)
    followUpDate = isoDay(due)
    followUpRequired = true
  }

  return {
    ...form,
    diagnosis: fill(form.diagnosis, procedure.defaultDiagnosis),
    findings: fill(form.findings, procedure.defaultFindings),
    procedureNotes: fill(form.procedureNotes, procedure.defaultProcedureNotes),
    // `materials` on the catalogue is the list this procedure normally
    // consumes, which is what `materialsUsed` records. No new column needed.
    materialsUsed: fill(form.materialsUsed, procedure.materials),
    followUpDate,
    followUpRequired,
  }
}

type FieldErrors = Partial<Record<'patient' | 'doctor' | 'procedure' | 'cost', string>>

export default function NewTreatmentPage() {
  const router = useRouter()
  const trail = useTrail('New treatment')
  const searchParams = useSearchParams()
  const preselectedPatientId = searchParams.get('patientId')
  const preselectedAppointmentId = searchParams.get('appointmentId')
  // A treatment plan's "start this item" hands over the procedure as well as
  // the patient. It was read by nobody, so the one field that made the link
  // worth clicking arrived empty.
  const preselectedProcedureId = searchParams.get('procedureId')
  // And from a plan step, the step itself, its teeth and its quoted price. The
  // step id is what links the treatment to the plan so the plan moves as the
  // work does (bug report 12 Oct, finding 11); the teeth and price are what
  // the patient agreed to, and retyping them was the only way to get them.
  const planItemId = searchParams.get('planItemId')
  const planTeeth = useMemo(() => parseTeeth(searchParams.get('teeth')), [searchParams])
  const planCost = searchParams.get('cost')

  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard(loading)
  const { toast } = useToast()

  // Form state
  const [formData, setFormData] = useState({
    patientId: preselectedPatientId || '',
    doctorId: '',
    procedureId: preselectedProcedureId || '',
    appointmentId: preselectedAppointmentId || '',
    toothNumbers: planTeeth,
    chiefComplaint: '',
    diagnosis: '',
    findings: '',
    procedureNotes: '',
    materialsUsed: '',
    followUpRequired: false,
    followUpDate: '',
    cost: planCost ?? '',
  })

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [selectedProcedure, setSelectedProcedure] = useState<Procedure | null>(null)

  // Fetch initial data. The handed-over patient (`?patientId=`) is fetched by
  // the picker itself, by id — see `initialPatientId` below.
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [doctorsRes, proceduresRes] = await Promise.all([
          fetch('/api/staff/doctors'),
          fetch('/api/procedures?all=true&isActive=true'),
        ])

        if (doctorsRes.ok) {
          const data = await doctorsRes.json()
          setDoctors(data.doctors || data)
        }

        if (proceduresRes.ok) {
          const data = await proceduresRes.json()
          setProcedures(data.procedures)

          // Choosing a procedure by hand also fills the cost from its price
          // and opens the consent block; a procedure that arrived in the URL
          // has to do the same, or the form is half-filled in a way that is
          // worse than empty.
          if (preselectedProcedureId) {
            const procedure = data.procedures?.find(
              (p: Procedure) => p.id === preselectedProcedureId
            )
            if (procedure) {
              setSelectedProcedure(procedure)
              // The same defaults as a hand-picked procedure. This branch used
              // to fill only the cost, so arriving from an appointment with
              // ?procedureId= gave a blank note while choosing the identical
              // procedure from the menu gave a filled one.
              setFormData((prev) =>
                withProcedureDefaults(
                  {
                    ...prev,
                    procedureId: procedure.id,
                    // A plan's quoted price, when the step brought one, even if
                    // it is 0.
                    cost: prev.cost !== '' ? prev.cost : procedure.basePrice.toString(),
                  },
                  procedure
                )
              )
            }
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error)
      }
    }

    fetchData()
  }, [preselectedProcedureId])

  const handlePatientChange = (patient: Patient | null) => {
    setSelectedPatient(patient)
    setFormData((prev) => ({ ...prev, patientId: patient?.id ?? '' }))
    if (patient) setErrors((prev) => ({ ...prev, patient: undefined }))
  }

  const handleProcedureSelect = (procedure: Procedure | null) => {
    setSelectedProcedure(procedure)
    if (procedure) setErrors((prev) => ({ ...prev, procedure: undefined }))
    setFormData((prev) =>
      withProcedureDefaults(
        {
          ...prev,
          procedureId: procedure?.id ?? '',
          cost: procedure ? procedure.basePrice.toString() : '',
        },
        procedure
      )
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // '' is "not given", and the route uses the plan's or the list price;
    // "0" is a price of nothing and is sent as 0.
    const cost = formData.cost.trim() === '' ? null : parseMoney(formData.cost)

    const found: FieldErrors = {}
    if (!formData.patientId) found.patient = 'Choose the patient.'
    if (!formData.doctorId) found.doctor = 'Choose the doctor.'
    if (!formData.procedureId) found.procedure = 'Choose the procedure.'
    if (formData.cost.trim() !== '' && cost === null)
      found.cost = 'Enter an amount, such as 1500 or 1500.50.'
    setErrors(found)
    const first = (['patient', 'doctor', 'procedure', 'cost'] as const).find((k) => found[k])
    if (first) {
      toast(toastError('save the treatment', 'Check the highlighted fields.'))
      const field = document.getElementById(first)
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      field?.focus()
      return
    }

    setLoading(true)

    try {
      const treatment = await readJson<{ id: string }>(
        await fetch('/api/treatments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            toothNumbers: formatTeeth(formData.toothNumbers),
            cost,
            treatmentPlanItemId: planItemId || undefined,
          }),
        })
      )
      router.push(`/treatments/${treatment.id}`)
    } catch (error) {
      toast(toastError('save the treatment', error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink trail={trail} fallback="/treatments" fallbackLabel="Treatments" />}
        title="New treatment"
        description="Record a new treatment for a patient"
      />

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6" noValidate>
        {/* Patient Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Patient
            </CardTitle>
            <CardDescription>Choose the patient for this treatment</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField label="Patient" htmlFor="patient" required error={errors.patient}>
              {(control) => (
                <PatientPicker<Patient>
                  {...control}
                  value={selectedPatient}
                  onChange={handlePatientChange}
                  initialPatientId={preselectedPatientId}
                />
              )}
            </FormField>
          </CardContent>
        </Card>

        {/* Doctor and Procedure */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5" />
              Treatment details
            </CardTitle>
            <CardDescription>
              {planItemId
                ? 'A step of the patient’s treatment plan. Completing this treatment completes the step.'
                : 'Choose the doctor and the procedure'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Doctor" htmlFor="doctor" required error={errors.doctor}>
                {(control) => (
                  <Select
                    value={formData.doctorId}
                    onValueChange={(value) => {
                      setFormData({ ...formData, doctorId: value })
                      setErrors((prev) => ({ ...prev, doctor: undefined }))
                    }}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue placeholder="Choose a doctor" />
                    </SelectTrigger>
                    <SelectContent>
                      {doctors.map((doctor) => (
                        <SelectItem key={doctor.id} value={doctor.id}>
                          Dr. {doctor.firstName} {doctor.lastName}
                          {doctor.specialization && ` - ${doctor.specialization}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              {/*
                Searchable, because a Select is a list you scroll and a
                catalogue is not a short list. The page holds the catalogue
                itself — it needs each procedure's defaults and price — and
                hands it to the picker.
              */}
              <FormField label="Procedure" htmlFor="procedure" required error={errors.procedure}>
                {(control) => (
                  <ProcedurePicker<Procedure>
                    {...control}
                    procedures={procedures}
                    value={formData.procedureId || null}
                    selectedLabel={selectedProcedure ? selectedProcedure.name : null}
                    onSelect={handleProcedureSelect}
                    onClear={() => handleProcedureSelect(null)}
                  />
                )}
              </FormField>
            </div>

            {selectedProcedure && (
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="font-medium">{selectedProcedure.name}</div>
                {selectedProcedure.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedProcedure.description}
                  </p>
                )}
                <div className="flex gap-4 mt-2 text-sm">
                  <span>Duration: {selectedProcedure.defaultDuration} min</span>
                  <span>Base price: {formatCurrency(selectedProcedure.basePrice)}</span>
                </div>
              </div>
            )}

            <FormField
              label="Treatment cost"
              htmlFor="cost"
              error={errors.cost}
              hint="Leave blank to charge the plan's quoted price or the procedure's list price."
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={formData.cost}
                  onChange={(raw) => setFormData({ ...formData, cost: raw })}
                />
              )}
            </FormField>
          </CardContent>
        </Card>

        {/* Dental Chart */}
        {/*
          The picker now reads the patient's chart and marks what is already
          wrong with each tooth. The component this replaces accepted findings
          as a prop and was rendered here without them, so a dentist choosing
          teeth for a treatment was shown a permanently healthy mouth.
        */}
        {selectedPatient && (
          <ToothPicker
            patientId={selectedPatient.id}
            selected={formData.toothNumbers}
            onChange={(teeth) => setFormData((prev) => ({ ...prev, toothNumbers: teeth }))}
            defaultToFindings
            // A child opens on the primary teeth (bug report 12 Oct, finding 55).
            age={selectedPatient.age}
            dateOfBirth={selectedPatient.dateOfBirth}
          />
        )}

        {/* Clinical Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Clinical notes</CardTitle>
            <CardDescription>Document the clinical findings and treatment notes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="chiefComplaint">Chief complaint</Label>
              <Textarea
                id="chiefComplaint"
                value={formData.chiefComplaint}
                onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
                placeholder="Patient's main concern or reason for visit…"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="diagnosis">Diagnosis</Label>
              <Textarea
                id="diagnosis"
                value={formData.diagnosis}
                onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                placeholder="Clinical diagnosis…"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="findings">Clinical findings</Label>
              <Textarea
                id="findings"
                value={formData.findings}
                onChange={(e) => setFormData({ ...formData, findings: e.target.value })}
                placeholder="Examination findings…"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="procedureNotes">Procedure notes</Label>
                <VoiceInput
                  onTranscript={(text) =>
                    setFormData((prev) => ({
                      ...prev,
                      procedureNotes: prev.procedureNotes ? prev.procedureNotes + ' ' + text : text,
                    }))
                  }
                />
              </div>
              <Textarea
                id="procedureNotes"
                value={formData.procedureNotes}
                onChange={(e) => setFormData({ ...formData, procedureNotes: e.target.value })}
                placeholder="Details of the procedure performed… (use the mic to dictate)"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="materialsUsed">Materials used</Label>
              <Textarea
                id="materialsUsed"
                value={formData.materialsUsed}
                onChange={(e) => setFormData({ ...formData, materialsUsed: e.target.value })}
                placeholder="List of materials and supplies used…"
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Follow-up */}
        <Card>
          <CardHeader>
            <CardTitle>Follow-up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="followUpRequired"
                checked={formData.followUpRequired}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, followUpRequired: checked as boolean })
                }
              />
              <Label htmlFor="followUpRequired">Follow-up required</Label>
            </div>

            {formData.followUpRequired && (
              <div className="space-y-2">
                <Label htmlFor="followUpDate">Follow-up date</Label>
                <Input
                  id="followUpDate"
                  type="date"
                  value={formData.followUpDate}
                  onChange={(e) => setFormData({ ...formData, followUpDate: e.target.value })}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" asChild>
            <Link href="/treatments">Cancel</Link>
          </Button>
          <SubmitButton busy={loading} busyLabel="Creating treatment…" icon={Save}>
            Create treatment
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}
