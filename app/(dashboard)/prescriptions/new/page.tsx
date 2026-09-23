'use client'

import { useState, useEffect, useMemo } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ClipboardList,
  Plus,
  Trash2,
  Loader2,
  Search,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react'
import { allergyClashes, medicalAlerts } from '@/lib/medical-history'
import { SearchSelect, type SearchOption } from '@/components/ui/search-select'
import {
  medicationStock,
  type MedicationStock,
  type MedicationStockRow,
} from '@/lib/medication-stock'
import { cn } from '@/lib/utils'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { appendTemplateLines, linesFromTemplate } from '@/lib/prescription-templates'
import { formatTeeth, parseTeeth } from '@/lib/teeth'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { fetchHandedPatient } from '@/lib/prefill'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  dateOfBirth: string | null
  /** Allergies live here, not flat on the patient. This page declared
      `allergies: string | null` and rendered a warning against it, which meant
      the warning was never once shown. */
  medicalHistory: {
    allergies: string[]
    conditions: string[]
    isPregnant: boolean
  } | null
}

interface MedicationOption {
  id: string
  name: string
  genericName: string | null
  form: string | null
  strength: string | null
  defaultDosage: string | null
  defaultFrequency: string | null
  defaultDuration: string | null
  contraindications: string | null
  sideEffects: string | null
  inventoryItems?: MedicationStockRow[]
}

interface TemplateOption {
  id: string
  name: string
  description: string | null
  category: string | null
  diagnosis: string | null
  notes: string | null
  items: Array<{
    medicationId: string | null
    medicationName: string
    dosage: string
    frequency: string
    duration: string
    route: string
    timing: string | null
    quantity: number | null
    instructions: string | null
    medication?: { genericName: string | null } | null
  }>
}

interface TreatmentContext {
  id: string
  treatmentNo: string
  toothNumbers: string | null
  diagnosis: string | null
  patientId: string
  procedure?: { name: string } | null
  patient?: { id: string; patientId: string; firstName: string; lastName: string } | null
}

interface MedicationRow {
  key: number
  medicationId: string | null
  medicationName: string
  /** Carried so the allergy check can read it, and now always present: the
      field only accepts catalogue entries, so there is no hand-typed row for
      the check to fall back on. Not sent — the server reads it from the id. */
  genericName: string | null
  /** Shown beside the row while prescribing. Not sent and not stored: these
      belong to the drug, not to this prescription, and copying them onto the
      record would freeze today's warning into a document read years later. */
  contraindications: string | null
  sideEffects: string | null
  stock: MedicationStock | null
  dosage: string
  frequency: string
  duration: string
  route: string
  timing: string
  quantity: string
  instructions: string
}

const ROUTES = [
  'Oral',
  'Topical',
  'Sublingual',
  'Buccal',
  'IV',
  'IM',
  'Subcutaneous',
  'Inhalation',
  'Nasal',
  'Otic',
  'Ophthalmic',
  'Rectal',
  'Vaginal',
]
const TIMINGS = [
  'Before food',
  'After food',
  'With food',
  'Empty stomach',
  'At bedtime',
  'As needed',
  'Morning',
  'Evening',
  'Morning & Evening',
]

let rowKey = 0

/**
 * An empty medication line.
 *
 * One factory rather than two object literals: the initial row and the row
 * that "Add medicine" appends were written out separately, so every field
 * added to the row had to be added twice or one of the two would be missing
 * it — which is how a row can arrive at the allergy check with `undefined`
 * where a string was expected.
 */
function blankMedRow(): MedicationRow {
  return {
    key: ++rowKey,
    medicationId: null,
    medicationName: '',
    genericName: null,
    contraindications: null,
    sideEffects: null,
    stock: null,
    dosage: '',
    frequency: '',
    duration: '',
    route: 'Oral',
    timing: '',
    quantity: '',
    instructions: '',
  }
}

export default function NewPrescriptionPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const [saving, setSaving] = useState(false)

  // Patient selection
  const [patientSearch, setPatientSearch] = useState('')
  const debouncedPatientSearch = useDebouncedValue(patientSearch)
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [searchingPatients, setSearchingPatients] = useState(false)

  // Medication search
  const [medSearch, setMedSearch] = useState('')
  const debouncedMedSearch = useDebouncedValue(medSearch)
  const [medOptions, setMedOptions] = useState<MedicationOption[]>([])
  const [searchingMeds, setSearchingMeds] = useState(false)

  /*
   * Templates, the treatment this is being written during, and the teeth.
   *
   * `?treatmentId=` is how the treatment screen hands over: prescribing after
   * an extraction should not mean retyping the patient, the diagnosis and the
   * tooth that was just pulled.
   */
  const presetTreatmentId = searchParams.get('treatmentId')
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null)
  const [treatment, setTreatment] = useState<TreatmentContext | null>(null)
  const [teeth, setTeeth] = useState<number[]>([])

  // Form data
  const [diagnosis, setDiagnosis] = useState('')
  const [notes, setNotes] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [medications, setMedications] = useState<MedicationRow[]>([blankMedRow()])

  /**
   * Pre-fill the patient this form was opened for.
   *
   * This read `result.data || result` against a route that answers
   * `{ success, patient }`, so it set the envelope as the patient: an object
   * with no name and no id, which the form rendered as a blank selection and
   * would have submitted as one. See lib/prefill.ts.
   */
  useEffect(() => {
    const pid = searchParams.get('patientId')
    if (!pid) return
    const controller = new AbortController()
    fetchHandedPatient<Patient>(pid, controller.signal).then((patient) => {
      if (patient && !controller.signal.aborted) setSelectedPatient(patient)
    })
    return () => controller.abort()
  }, [searchParams])

  /**
   * Patient search.
   *
   * The wait lived in a `setTimeout` here; it is `useDebouncedValue` now, as it
   * is on every other search box. Clearing that timer covered a request not yet
   * sent but not one already in flight, so a slow answer for a shorter term
   * could still land last and overwrite the right one — hence `current`.
   */
  useEffect(() => {
    const term = debouncedPatientSearch.trim()
    if (term.length < 2) {
      setPatients([])
      return
    }

    let current = true
    setSearchingPatients(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(term)}&limit=10`)
        const result = await res.json()
        if (!current) return
        setPatients(result.data || result.patients || [])
      } catch {
        if (current) setPatients([])
      } finally {
        if (current) setSearchingPatients(false)
      }
    })()

    return () => {
      current = false
    }
  }, [debouncedPatientSearch])

  /** Medication search. Same shape as the patient search above. */
  useEffect(() => {
    const term = debouncedMedSearch.trim()
    if (term.length < 2) {
      setMedOptions([])
      return
    }

    let current = true
    setSearchingMeds(true)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/medications?search=${encodeURIComponent(term)}&limit=10&active=true&sort=name`
        )
        const result = await res.json()
        if (!current) return
        setMedOptions(result.data || [])
      } catch {
        if (current) setMedOptions([])
      } finally {
        if (current) setSearchingMeds(false)
      }
    })()

    return () => {
      current = false
    }
  }, [debouncedMedSearch])

  /** What to put in front of the prescriber before they choose anything. */
  const patientAlerts = useMemo(
    () => (selectedPatient?.medicalHistory ? medicalAlerts(selectedPatient.medicalHistory) : []),
    [selectedPatient]
  )

  /**
   * Which rows clash with a recorded allergy, by row index.
   *
   * Recomputed as the prescription is typed rather than checked once on save,
   * so the warning appears beside the drug that caused it while the prescriber
   * is still looking at that row.
   */
  const clashesByRow = useMemo(() => {
    const allergies = selectedPatient?.medicalHistory?.allergies
    if (!allergies?.length) return new Map<number, ReturnType<typeof allergyClashes>>()

    const map = new Map<number, ReturnType<typeof allergyClashes>>()
    medications.forEach((row, index) => {
      const found = allergyClashes(allergies, {
        name: row.medicationName,
        genericName: row.genericName,
      })
      if (found.length > 0) map.set(index, found)
    })
    return map
  }, [selectedPatient, medications])

  /**
   * The catalogue results in the shape the select renders.
   *
   * Mapped rather than passed through, because `SearchSelect` shows a label, a
   * hint and a detail line and knows nothing about strengths or generic names.
   */
  const medOptionsForSelect: SearchOption[] = useMemo(
    () =>
      medOptions.map((m) => ({
        id: m.id,
        label: `${m.name}${m.strength ? ` ${m.strength}` : ''}`,
        hint: m.form || undefined,
        detail: m.genericName || undefined,
      })),
    [medOptions]
  )

  const selectMedication = (med: MedicationOption, rowIndex: number) => {
    setMedications((prev) =>
      prev.map((r, i) =>
        i === rowIndex
          ? {
              ...r,
              medicationId: med.id,
              medicationName: `${med.name}${med.strength ? ` ${med.strength}` : ''}${med.form ? ` (${med.form})` : ''}`,
              genericName: med.genericName,
              // Read from the catalogue and held for display only. The
              // prescription stores neither: they describe the drug, and a
              // warning copied onto a record in 2026 would still be showing
              // 2026's wording when somebody reads that record in 2031.
              contraindications: med.contraindications,
              sideEffects: med.sideEffects,
              stock: medicationStock(med.inventoryItems),
              dosage: r.dosage || med.defaultDosage || '',
              frequency: r.frequency || med.defaultFrequency || '',
              duration: r.duration || med.defaultDuration || '',
            }
          : r
      )
    )
    setMedSearch('')
    setMedOptions([])
  }

  /**
   * Detach a row from the catalogue.
   *
   * The medication field no longer takes free text, so there is no "typed over
   * it" case to handle — clearing is explicit, and it clears everything the
   * catalogue supplied. The dosage and the rest are left alone: they were
   * offered as defaults and may since have been edited on purpose.
   */
  const clearMedication = (rowIndex: number) => {
    setMedications((prev) =>
      prev.map((r, i) =>
        i === rowIndex
          ? {
              ...r,
              medicationId: null,
              medicationName: '',
              genericName: null,
              contraindications: null,
              sideEffects: null,
              stock: null,
            }
          : r
      )
    )
  }

  const updateMedRow = (index: number, field: keyof MedicationRow, value: string) => {
    setMedications((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  const addMedRow = () => {
    setMedications((prev) => [...prev, blankMedRow()])
  }

  const removeMedRow = (index: number) => {
    if (medications.length <= 1) return
    setMedications((prev) => prev.filter((_, i) => i !== index))
  }

  /* The list is short and clinic-wide, so it is fetched once rather than searched. */
  useEffect(() => {
    let cancelled = false
    fetch('/api/prescription-templates')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.data)) setTemplates(data.data)
      })
      .catch(() => {
        /* No templates is a prescription form without a shortcut, not a
           broken one. */
      })
    return () => {
      cancelled = true
    }
  }, [])

  /*
   * Arriving from a treatment: carry across what it already knows.
   *
   * The diagnosis and the teeth are prefilled and remain editable — the
   * dentist may be treating 46 and prescribing for 46 and 47. The patient is
   * taken from the treatment rather than trusted from the query string, so a
   * hand-edited URL cannot attach a prescription to the wrong record.
   */
  useEffect(() => {
    if (!presetTreatmentId) return
    let cancelled = false
    fetch(`/api/treatments/${encodeURIComponent(presetTreatmentId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const t: TreatmentContext | undefined = data?.data ?? data
        if (cancelled || !t?.id) return
        setTreatment(t)
        setTeeth(parseTeeth(t.toothNumbers))
        if (t.diagnosis) setDiagnosis((current) => current || t.diagnosis || '')
        /*
         * The patient is re-fetched rather than taken from the treatment.
         *
         * `/api/treatments/[id]` selects a handful of patient columns and does
         * not include `medicalHistory`, which is where allergies live. Using
         * that object here would leave `allergies` undefined, and the clash
         * check below reads it — so prescribing from a treatment would have
         * been the one route into this form with the allergy warning silently
         * switched off. Same loader the `?patientId=` arrival uses.
         */
        if (t.patient?.id) {
          fetchHandedPatient<Patient>(t.patient.id).then((patient) => {
            if (!cancelled && patient) setSelectedPatient(patient)
          })
        }
      })
      .catch(() => {
        /* Prescribing still works; it just will not be linked. */
      })
    return () => {
      cancelled = true
    }
  }, [presetTreatmentId])

  /**
   * Put a template's medicines on the form.
   *
   * Appends. A dentist who has typed two medicines and then reaches for
   * "Post-extraction" is adding to their work, not replacing it — see
   * lib/prescription-templates.ts. Duplicates are added and announced rather
   * than blocked: the same drug at two strengths is a real prescription, and
   * silently adding a second amoxicillin is how somebody dispenses twice.
   */
  const applyTemplate = (template: TemplateOption) => {
    const result = appendTemplateLines(medications, linesFromTemplate(template.items) as any)

    // Filled out to a whole row rather than spread onto nothing: a template
    // line carries no key and none of the catalogue's display fields, and a
    // row missing them would render with `undefined` where the select expects
    // a value.
    setMedications(
      result.lines.map((line: any) => ({
        ...blankMedRow(),
        ...line,
        key: line.key ?? ++rowKey,
      })) as MedicationRow[]
    )
    setAppliedTemplateId(template.id)
    if (template.diagnosis) setDiagnosis((current) => current || template.diagnosis || '')
    if (template.notes) setNotes((current) => (current ? current : template.notes || ''))

    toast({
      title: `${template.name} added`,
      description: result.duplicates.length
        ? `${result.added} medicine${result.added === 1 ? '' : 's'} added. ${result.duplicates.join(
            ', '
          )} was already on this prescription — check the dose before saving.`
        : `${result.added} medicine${result.added === 1 ? '' : 's'} added to what you had.`,
      variant: result.duplicates.length ? 'destructive' : undefined,
    })
  }

  const handleSubmit = async () => {
    if (!selectedPatient) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select a patient' })
      return
    }

    const validMeds = medications.filter(
      (m) => m.medicationName && m.dosage && m.frequency && m.duration
    )
    if (validMeds.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Add at least one medication with dosage, frequency, and duration',
      })
      return
    }

    // A warning that costs nothing to ignore is a warning people stop reading.
    // This one asks for a deliberate answer, and takes no for one — but it does
    // not refuse, because a prescriber may have a reason and software that
    // says no outright gets worked around on paper.
    if (clashesByRow.size > 0) {
      const listed = [...clashesByRow.values()]
        .flat()
        .map((c) => `${c.drug} against a recorded allergy to ${c.allergy}`)
        .join('; ')

      const proceed = await confirm({
        title: 'This prescription clashes with a recorded allergy',
        description: `${listed}. Prescribe anyway?`,
        confirmLabel: 'Prescribe anyway',
        variant: 'destructive',
      })
      if (!proceed) return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/prescriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          // Provenance, clinical context, and this patient's teeth. All three
          // are optional and all three are copied, never referenced — see the
          // notes on the Prescription model.
          templateId: appliedTemplateId,
          treatmentId: treatment?.id ?? null,
          toothNumbers: formatTeeth(teeth),
          diagnosis,
          notes,
          validUntil: validUntil || null,
          medications: validMeds.map((m) => ({
            medicationId: m.medicationId,
            medicationName: m.medicationName,
            dosage: m.dosage,
            frequency: m.frequency,
            duration: m.duration,
            route: m.route,
            timing: m.timing || null,
            quantity: m.quantity ? parseInt(m.quantity) : null,
            instructions: m.instructions || null,
          })),
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)

      toast({
        title: 'Prescription created',
        description: `${result.data.prescriptionNo} saved successfully`,
      })
      router.push(`/prescriptions/${result.data.id}`)
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={formRef} className="mx-auto max-w-4xl">
      <Button variant="ghost" className="mb-4" onClick={() => router.push('/prescriptions')}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to Prescriptions
      </Button>

      <div className="mb-6">
        <h1 className="page-title flex items-center gap-2">
          <ClipboardList className="h-6 w-6" />
          New Prescription
        </h1>
        <p className="text-muted-foreground">Create a new e-prescription for a patient</p>
      </div>

      <div className="space-y-6">
        {/* Patient Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Patient</CardTitle>
            <CardDescription>Select the patient for this prescription</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedPatient ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium">
                      {selectedPatient.firstName} {selectedPatient.lastName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {selectedPatient.patientId} · {selectedPatient.phone}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedPatient(null)}>
                    Change
                  </Button>
                </div>

                {/*
                  Its own block, not a clause appended to the phone number.
                  Allergies were shown as muted small print beside the ID, which
                  is where the eye goes last on a screen whose whole purpose is
                  choosing a drug.
                */}
                {patientAlerts.length > 0 ? (
                  <div
                    className="rounded-lg border border-destructive/50 bg-destructive/10 p-3"
                    role="alert"
                  >
                    <p className="text-sm font-semibold text-destructive">Medical alerts</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {patientAlerts.map((alert, i) => (
                        <Badge
                          key={i}
                          variant={alert.tone === 'danger' ? 'destructive' : 'secondary'}
                        >
                          {alert.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* An empty history and an unasked question look identical on
                     a screen that shows nothing, and they are not the same. */
                  <p className="text-sm text-muted-foreground">
                    No allergies or conditions recorded.{' '}
                    <Link
                      href={`/patients/${selectedPatient.id}`}
                      className="underline hover:text-foreground"
                    >
                      Check the record
                    </Link>{' '}
                    before prescribing.
                  </p>
                )}
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search patient by name, ID, or phone..."
                  data-form-guard="ignore"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  className="pl-9"
                />
                {debouncedPatientSearch.trim().length >= 2 && (
                  <div className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                    {searchingPatients ? (
                      <div className="p-3 text-center text-sm text-muted-foreground">
                        Searching...
                      </div>
                    ) : patients.length === 0 ? (
                      // Closing the list on nothing-found left the prescriber
                      // looking at a plain box, which is what it looks like
                      // before a search has finished.
                      <div className="p-3 text-sm text-muted-foreground">
                        No patients found for &ldquo;{debouncedPatientSearch.trim()}&rdquo;
                      </div>
                    ) : (
                      patients.map((p) => (
                        <button
                          key={p.id}
                          className="w-full px-3 py-2 text-left hover:bg-accent text-sm"
                          onClick={() => {
                            setSelectedPatient(p)
                            setPatientSearch('')
                            setPatients([])
                          }}
                        >
                          <span className="font-medium">
                            {p.firstName} {p.lastName}
                          </span>
                          <span className="text-muted-foreground ml-2">
                            {p.patientId} · {p.phone}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Diagnosis */}
        {/*
          Where this prescription came from, when it came from somewhere.
          Shown rather than hidden in the payload: a dentist should be able to
          see that this is attached to an extraction before they save it.
        */}
        {treatment && (
          <Card className="border-primary/30 bg-primary/[0.04]">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="text-sm">
                <p className="font-medium">
                  Prescribing for {treatment.procedure?.name ?? 'treatment'} ·{' '}
                  {treatment.treatmentNo}
                </p>
                <p className="text-muted-foreground text-xs">
                  The diagnosis and teeth below were carried across. Both are editable.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setTreatment(null)}>
                Unlink
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Templates */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Start from a template</CardTitle>
              <CardDescription>
                Adds its medicines to whatever you have already typed. Nothing is replaced.
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/prescriptions/templates">Manage</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No templates yet.{' '}
                <Link href="/prescriptions/templates/new" className="text-primary hover:underline">
                  Create one
                </Link>{' '}
                from a prescription you write often.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {templates.map((template) => (
                  <Button
                    key={template.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyTemplate(template)}
                  >
                    {template.name}
                    <span className="text-muted-foreground ml-2 text-xs">
                      {template.items.length}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Diagnosis &amp; teeth</CardTitle>
            <CardDescription>
              Which teeth this prescription is about. Findings already on the patient&apos;s chart
              are marked.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Diagnosis / Condition</Label>
              <Input
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="e.g., Dental caries, Periodontal disease"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Valid Until</Label>
                <Input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Teeth</Label>
              {selectedPatient ? (
                <ToothPicker
                  patientId={selectedPatient.id}
                  selected={teeth}
                  onChange={setTeeth}
                  defaultToFindings
                />
              ) : (
                <p className="text-muted-foreground rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm">
                  Choose a patient first — the chart above shows their findings.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Medications */}
        <Card>
          <CardHeader>
            <CardTitle>Medications</CardTitle>
            <CardDescription>
              Add medications from your drug catalog or type manually
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {medications.map((med, index) => (
              <div key={med.key} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    Medication {index + 1}
                  </span>
                  {medications.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removeMedRow(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {/*
                  A select, not a text box. It used to be an Input with a
                  suggestion list: picking a suggestion linked the row to the
                  drug catalogue, typing a name and ignoring the list did not,
                  and nothing downstream could tell the two apart. Stock,
                  contraindications and side effects all hang off that link, so
                  a row without one is a row that silently opts out of every
                  check on this screen.
                */}
                <div>
                  <Label htmlFor={`medication-${med.key}`}>Medication *</Label>
                  <SearchSelect
                    id={`medication-${med.key}`}
                    value={med.medicationId}
                    selectedLabel={med.medicationName}
                    options={medOptionsForSelect}
                    loading={searchingMeds}
                    onSearchChange={setMedSearch}
                    onSelect={(option) => {
                      const chosen = medOptions.find((m) => m.id === option.id)
                      if (chosen) selectMedication(chosen, index)
                    }}
                    onClear={() => clearMedication(index)}
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
                    aria-label="Medication"
                  />
                </div>

                {/*
                  What the catalogue knows about this drug, shown while it is
                  being prescribed rather than filed where nobody reads it.
                  These two columns existed on Medication from the start and
                  were written to by the catalogue form, but no screen had ever
                  displayed them — a field that writes to nowhere.
                */}
                {(med.contraindications || med.sideEffects) && (
                  <div className="rounded-lg border border-border/60 bg-foreground/[0.02] p-3 text-xs">
                    {med.contraindications && (
                      <p>
                        <span className="font-semibold">Contraindications: </span>
                        <span className="text-muted-foreground">{med.contraindications}</span>
                      </p>
                    )}
                    {med.sideEffects && (
                      <p className={med.contraindications ? 'mt-1' : undefined}>
                        <span className="font-semibold">Side effects: </span>
                        <span className="text-muted-foreground">{med.sideEffects}</span>
                      </p>
                    )}
                  </div>
                )}

                {/*
                  Stock, when the drug is linked to a shelf. "Not tracked" is
                  deliberately silent: on the day this shipped nothing was
                  linked, and a warning on every row would have trained
                  prescribers to ignore the one that matters.
                */}
                {med.stock && med.stock.state !== 'unlinked' && (
                  <p
                    className={cn(
                      'text-xs',
                      med.stock.state === 'ok'
                        ? 'text-muted-foreground'
                        : 'font-medium text-amber-700 dark:text-amber-400'
                    )}
                  >
                    {med.stock.label}
                  </p>
                )}

                {/*
                  Beside the drug that caused it, not gathered into a summary at
                  the bottom. The prescriber is looking at this row.
                */}
                {clashesByRow.has(index) && (
                  <div
                    className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3"
                    role="alert"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                    <div className="text-sm">
                      {clashesByRow.get(index)!.map((c, i) => (
                        <p key={i} className="text-destructive">
                          <span className="font-semibold">
                            {c.note ? 'Check before prescribing' : 'Allergy clash'}
                          </span>{' '}
                          — this patient is recorded as allergic to {c.allergy}
                          {c.note ? `, and ${c.drug} is a ${c.note}` : ''}.
                        </p>
                      ))}
                      <p className="text-muted-foreground mt-1">
                        Change the drug, or confirm on the next screen that you mean it.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label>Dosage *</Label>
                    <Input
                      value={med.dosage}
                      onChange={(e) => updateMedRow(index, 'dosage', e.target.value)}
                      placeholder="1 tablet"
                    />
                  </div>
                  <div>
                    <Label>Frequency *</Label>
                    <Input
                      value={med.frequency}
                      onChange={(e) => updateMedRow(index, 'frequency', e.target.value)}
                      placeholder="3 times a day"
                    />
                  </div>
                  <div>
                    <Label>Duration *</Label>
                    <Input
                      value={med.duration}
                      onChange={(e) => updateMedRow(index, 'duration', e.target.value)}
                      placeholder="5 days"
                    />
                  </div>
                  <div>
                    <Label>Route</Label>
                    <Select
                      value={med.route}
                      onValueChange={(v) => updateMedRow(index, 'route', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROUTES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Timing</Label>
                    <Select
                      value={med.timing || undefined}
                      onValueChange={(v) => updateMedRow(index, 'timing', v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMINGS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      value={med.quantity}
                      onChange={(e) => updateMedRow(index, 'quantity', e.target.value)}
                      placeholder="10"
                    />
                  </div>
                </div>

                <div>
                  <Label>Special Instructions</Label>
                  <Input
                    value={med.instructions}
                    onChange={(e) => updateMedRow(index, 'instructions', e.target.value)}
                    placeholder="Take with warm water, avoid dairy..."
                  />
                </div>
              </div>
            ))}

            <Button variant="outline" onClick={addMedRow} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Another Medication
            </Button>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Additional Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="General advice, follow-up instructions..."
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => router.push('/prescriptions')}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving} size="lg">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Prescription
          </Button>
        </div>
      </div>
      {ConfirmDialogComponent}
    </div>
  )
}
