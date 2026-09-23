'use client'

import { useState, useEffect, useMemo } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchHandedPatient } from '@/lib/prefill'
import { usePatientSearch } from '@/hooks/use-patient-search'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { isoDay } from '@/lib/dates'
import { SearchSelect, type SearchOption } from '@/components/ui/search-select'
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
import { ArrowLeft, Search, User, Stethoscope, Save, AlertCircle, Loader2 } from 'lucide-react'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { procedureCategoryConfig, formatCurrency } from '@/lib/treatment-utils'
import { TreatmentAssist } from '@/components/ai/treatment-assist'
import { VoiceInput } from '@/components/clinical/voice-input'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  email: string | null
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

export default function NewTreatmentPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const searchParams = useSearchParams()
  const preselectedPatientId = searchParams.get('patientId')
  const preselectedAppointmentId = searchParams.get('appointmentId')
  // A treatment plan's "start this item" hands over the procedure as well as
  // the patient. It was read by nobody, so the one field that made the link
  // worth clicking arrived empty.
  const preselectedProcedureId = searchParams.get('procedureId')

  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const patientSearch = usePatientSearch<Patient>()

  // Form state
  const [formData, setFormData] = useState({
    patientId: preselectedPatientId || '',
    doctorId: '',
    procedureId: preselectedProcedureId || '',
    appointmentId: preselectedAppointmentId || '',
    toothNumbers: [] as number[],
    chiefComplaint: '',
    diagnosis: '',
    findings: '',
    procedureNotes: '',
    materialsUsed: '',
    followUpRequired: false,
    followUpDate: '',
    cost: '',
  })

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [selectedProcedure, setSelectedProcedure] = useState<Procedure | null>(null)

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [doctorsRes, proceduresRes, handedPatient] = await Promise.all([
          fetch('/api/staff/doctors'),
          fetch('/api/procedures?all=true&isActive=true'),
          preselectedPatientId ? fetchHandedPatient<Patient>(preselectedPatientId) : null,
        ])

        // Asked for by id. The register is searched on the server — see
        // hooks/use-patient-search.ts — so there is no local list to find it
        // in, and there never should have been.
        if (handedPatient) {
          setSelectedPatient(handedPatient)
        }

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
                    cost: prev.cost || procedure.basePrice.toString(),
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
  }, [preselectedPatientId, preselectedProcedureId])

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient)
    setFormData({ ...formData, patientId: patient.id })
  }

  /**
   * The catalogue as select options, category first so that typing a category
   * name still finds its procedures and the list reads in the same order the
   * grouped dropdown did.
   */
  const procedureOptions: SearchOption[] = useMemo(
    () =>
      // The category grouping this replaced existed only to draw headings in
      // a Select. The search field shows the category on each row instead, so
      // it is searchable rather than merely visible.
      procedures.map((proc) => ({
        id: proc.id,
        label: proc.name,
        hint: formatCurrency(proc.basePrice),
        detail: `${proc.code} · ${procedureCategoryConfig[proc.category]?.label || proc.category}`,
      })),
    [procedures]
  )

  const handleProcedureSelect = (procedureId: string) => {
    const procedure = procedures.find((p) => p.id === procedureId)
    setSelectedProcedure(procedure || null)
    setFormData((prev) =>
      withProcedureDefaults(
        {
          ...prev,
          procedureId,
          cost: procedure ? procedure.basePrice.toString() : '',
        },
        procedure || null
      )
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (!formData.patientId) {
      setError('Please select a patient')
      return
    }
    if (!formData.doctorId) {
      setError('Please select a doctor')
      return
    }
    if (!formData.procedureId) {
      setError('Please select a procedure')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/treatments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          toothNumbers: formData.toothNumbers.length > 0 ? formData.toothNumbers.join(',') : null,
          cost: formData.cost ? parseFloat(formData.cost) : null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create treatment')
      }

      const treatment = await response.json()
      router.push(`/treatments/${treatment.id}`)
    } catch (error: any) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Go back" asChild>
          <Link href="/treatments">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="page-title">New Treatment</h1>
          <p className="text-muted-foreground">Record a new treatment for a patient</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2 dark:bg-red-950/30 dark:border-red-800/60 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
        {/* Patient Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Patient Information
            </CardTitle>
            <CardDescription>Select the patient for this treatment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedPatient ? (
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium">
                      {selectedPatient.firstName} {selectedPatient.lastName}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {selectedPatient.patientId} | {selectedPatient.phone}
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedPatient(null)
                    setFormData({ ...formData, patientId: '' })
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search patients by name, phone, or ID..."
                    value={patientSearch.term}
                    onChange={(e) => patientSearch.setTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto border rounded-lg">
                  {patientSearch.searching ? (
                    <p className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching…
                    </p>
                  ) : patientSearch.results.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      {patientSearch.failed
                        ? 'Could not search just now. Check the connection and try again.'
                        : patientSearch.isSearch
                          ? `No patients found for “${patientSearch.searchedFor}”`
                          : 'No patients found'}
                    </div>
                  ) : (
                    patientSearch.results.map((patient) => (
                      <button
                        key={patient.id}
                        type="button"
                        onClick={() => handlePatientSelect(patient)}
                        className="w-full flex items-center gap-4 p-3 hover:bg-muted/50 border-b last:border-b-0 text-left"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                          <User className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium">
                            {patient.firstName} {patient.lastName}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {patient.patientId} | {patient.phone}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Doctor and Procedure */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5" />
              Treatment Details
            </CardTitle>
            <CardDescription>Select the doctor and procedure</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="doctor">Doctor *</Label>
                <Select
                  value={formData.doctorId}
                  onValueChange={(value) => setFormData({ ...formData, doctorId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select doctor" />
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="procedure">Procedure *</Label>
                {/*
                  Searchable, because a Select is a list you scroll and a
                  catalogue is not a short list. A clinic with sixty procedures
                  across ten categories made this a scroll to the right heading
                  and then a scroll within it, every time, with no way to type
                  "crown" and be done.
                */}
                <SearchSelect
                  id="procedure"
                  value={formData.procedureId || null}
                  selectedLabel={selectedProcedure ? selectedProcedure.name : null}
                  options={procedureOptions}
                  onSelect={(option) => handleProcedureSelect(option.id)}
                  onClear={() => handleProcedureSelect('')}
                  placeholder="Search procedures by name or code…"
                  emptyMessage="No procedure of that name in the catalogue."
                  emptyAction={
                    <Link
                      href="/settings/procedures"
                      target="_blank"
                      className="text-sm text-primary hover:underline"
                    >
                      Open the procedure catalogue
                    </Link>
                  }
                  aria-label="Procedure"
                />
              </div>
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
                  <span>Base Price: {formatCurrency(selectedProcedure.basePrice)}</span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="cost">Treatment Cost</Label>
              <Input
                id="cost"
                type="number"
                step="0.01"
                value={formData.cost}
                onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                placeholder="Enter treatment cost"
              />
            </div>
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
            onChange={(teeth) => setFormData({ ...formData, toothNumbers: teeth })}
            defaultToFindings
          />
        )}

        {/* Clinical Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Clinical Notes</CardTitle>
            <CardDescription>Document the clinical findings and treatment notes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="chiefComplaint">Chief Complaint</Label>
              <Textarea
                id="chiefComplaint"
                value={formData.chiefComplaint}
                onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
                placeholder="Patient's main concern or reason for visit..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="diagnosis">Diagnosis</Label>
              <Textarea
                id="diagnosis"
                value={formData.diagnosis}
                onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                placeholder="Clinical diagnosis..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="findings">Clinical Findings</Label>
              <Textarea
                id="findings"
                value={formData.findings}
                onChange={(e) => setFormData({ ...formData, findings: e.target.value })}
                placeholder="Examination findings..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="procedureNotes">Procedure Notes</Label>
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
                placeholder="Details of the procedure performed... (use mic for voice dictation)"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="materialsUsed">Materials Used</Label>
              <Textarea
                id="materialsUsed"
                value={formData.materialsUsed}
                onChange={(e) => setFormData({ ...formData, materialsUsed: e.target.value })}
                placeholder="List of materials and supplies used..."
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* AI Treatment Assistant */}
        {formData.patientId && formData.procedureId && (
          <TreatmentAssist
            patientId={formData.patientId}
            procedureId={formData.procedureId}
            procedureName={procedures.find((p) => p.id === formData.procedureId)?.name}
            diagnosis={formData.diagnosis}
            findings={formData.findings}
            procedureNotes={formData.procedureNotes}
          />
        )}

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
                <Label htmlFor="followUpDate">Follow-up Date</Label>
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
          <Button type="submit" disabled={loading}>
            {loading ? (
              'Creating...'
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Create Treatment
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
