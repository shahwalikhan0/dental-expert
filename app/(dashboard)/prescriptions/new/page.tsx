'use client'

import { useState, useEffect, useMemo, useId } from 'react'
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
import { Plus, Trash2, AlertTriangle, Stethoscope } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { BackLink, useTrail } from '@/components/ui/trail'
import { FormField, fieldIds } from '@/components/ui/form-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { IconTooltip } from '@/components/ui/icon-action'
import { PatientPicker, patientName } from '@/components/patients/patient-picker'
import { MedicationPicker } from '@/components/catalogue/medication-picker'
import { toastError, toastSuccess } from '@/lib/toast-utils'
import { medicalAlerts } from '@/lib/medical-history'
// Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
// import { type AllergyClash } from '@/lib/medical-history'
// import { describeAllergyClashes, prescriptionAllergyClashes } from '@/lib/prescribing'
import { isEmptyLine, lineRefusal } from '@/lib/prescribing'
import { useCan } from '@/hooks/use-can'
import {
  medicationStock,
  type MedicationStock,
  type MedicationStockRow,
} from '@/lib/medication-stock'
import { cn } from '@/lib/utils'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import {
  appendTemplateLines,
  linesFromTemplate,
  usableTemplateItems,
} from '@/lib/prescription-templates'
import { formatTeeth, parseTeeth } from '@/lib/teeth'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { fetchHandedPatient } from '@/lib/prefill'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  /** On a patient fetched by id. The search answers with `age` instead. */
  dateOfBirth?: string | null
  age?: number | null
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
    medication?: { genericName: string | null; isActive?: boolean } | null
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

/** A React key per row, so a removed row does not hand its state to the next.
 *  Module state, so it must never reach the DOM: the server's copy has been
 *  counting since the process started while the browser's starts at zero.
 *  It used to be the label ↔ input id, which is what made this page log a
 *  hydration mismatch on every open (bug report 12 Oct, finding 67). The ids
 *  come from `useId` now — see `idBase` below. */
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

/** What is wrong with each field of one medication row, for the inline errors. */
interface RowErrors {
  medication?: string
  dosage?: string
  frequency?: string
  duration?: string
  quantity?: string
  /** Anything the field checks do not cover — said under the row. */
  other?: string
}

interface FormErrors {
  patient?: string
  rows: Record<number, RowErrors>
}

/**
 * The inline errors for one row, or null when it is fine.
 *
 * The same rules as `lineRefusal` (lib/prescribing.ts), which the server runs,
 * said per field so each message sits under the box it is about. A row the
 * prescriber never touched is not checked — unless it is the only one, when
 * there is nothing to prescribe at all.
 */
function rowErrors(row: MedicationRow, index: number, onlyRow: boolean): RowErrors | null {
  if (isEmptyLine(row) && !onlyRow) return null
  const errors: RowErrors = {}
  if (!row.medicationName.trim()) errors.medication = 'Choose a medicine from the catalogue.'
  if (!row.dosage.trim()) errors.dosage = 'Give a dosage.'
  if (!row.frequency.trim()) errors.frequency = 'Give a frequency.'
  if (!row.duration.trim()) errors.duration = 'Give a duration.'
  if (row.quantity.trim()) {
    const n = Number(row.quantity)
    if (!Number.isInteger(n) || n <= 0) errors.quantity = 'A whole number above zero.'
  }
  if (Object.keys(errors).length === 0) {
    const refusal = lineRefusal(row, index)
    if (refusal) errors.other = refusal
  }
  return Object.keys(errors).length ? errors : null
}

export default function NewPrescriptionPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // So the patient record opened from here can offer the way back.
  const trail = useTrail('New prescription')
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  // Label ↔ input ids, the same on the server and in the browser. See
  // `rowKey` above for why they are not the row keys.
  const idBase = useId()

  /*
   * Prescribing takes `clinical:sign` (finding 36): dentists, the clinic
   * manager and the administrator; the API refuses anyone else. A
   * form that can only end in a 403 is a form filled in for nothing, so other
   * roles are told so instead of being given one. `null` while the session
   * loads, which shows the form rather than flashing the notice.
   */
  const canPrescribe = useCan('clinical:sign')

  const [saving, setSaving] = useState(false)
  // Warn before a half-filled form is thrown away by a stray click — but not
  // during the navigation a successful save performs.
  const formRef = useFormGuard(saving)
  // Inline errors appear from the first attempt to save, and then follow the
  // form as it is corrected.
  const [showErrors, setShowErrors] = useState(false)

  // Patient selection
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)

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
   * The patient this form was opened for (`?patientId=`), handed to the
   * picker, which fetches it by id the way lib/prefill.ts does. Not when the
   * form was opened from a treatment: then the treatment names the patient
   * (below), so a hand-edited URL cannot attach a prescription to the wrong
   * record.
   */
  const handedPatientId = presetTreatmentId ? null : searchParams.get('patientId')

  /** What to put in front of the prescriber before they choose anything. */
  const patientAlerts = useMemo(
    () => (selectedPatient?.medicalHistory ? medicalAlerts(selectedPatient.medicalHistory) : []),
    [selectedPatient]
  )

  // Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
  // /**
  //  * Which rows clash with a recorded allergy, by row index.
  //  *
  //  * Recomputed as the prescription is typed rather than checked once on save,
  //  * so the warning appears beside the drug that caused it while the prescriber
  //  * is still looking at that row.
  //  */
  // const clashesByRow = useMemo(() => {
  //   // The same function `POST /api/prescriptions` runs, so the warning here
  //   // and the server's refusal cannot disagree about what clashes.
  //   const found = prescriptionAllergyClashes(
  //     selectedPatient?.medicalHistory?.allergies,
  //     medications.map((row) => ({ name: row.medicationName, genericName: row.genericName }))
  //   )
  //   const map = new Map<number, AllergyClash[]>()
  //   for (const { line, ...clash } of found) {
  //     map.set(line, [...(map.get(line) ?? []), clash])
  //   }
  //   return map
  // }, [selectedPatient, medications])

  /** What is wrong with the form now; empty until the first attempt to save. */
  const errors: FormErrors = useMemo(() => {
    if (!showErrors) return { rows: {} }
    const found: FormErrors = { rows: {} }
    if (!selectedPatient) found.patient = 'Choose the patient this prescription is for.'
    const onlyRow = medications.every(isEmptyLine)
    medications.forEach((row, index) => {
      const rowProblem = rowErrors(row, index, onlyRow && index === 0)
      if (rowProblem) found.rows[index] = rowProblem
    })
    return found
  }, [showErrors, selectedPatient, medications])

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
    // A medicine retired from the catalogue since the template was saved is
    // left out and named, not added (the server would refuse it) and not
    // dropped in silence (finding 48).
    const { usable, inactive } = usableTemplateItems(template.items)
    // One sentence for the toast, because the toaster shows one toast at a
    // time and a second would hide the first.
    const leftOut = inactive.length
      ? `${inactive.join(', ')} ${inactive.length === 1 ? 'was' : 'were'} left out: deactivated in the drug catalogue.`
      : ''
    if (usable.length === 0) {
      toast(toastError(`add anything from ${template.name}`, leftOut))
      return
    }

    const result = appendTemplateLines(medications, linesFromTemplate(usable) as any)

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

    const added = result.duplicates.length
      ? `${result.added} medicine${result.added === 1 ? '' : 's'} added. ${result.duplicates.join(
          ', '
        )} was already on this prescription — check the dose before saving.`
      : `${result.added} medicine${result.added === 1 ? '' : 's'} added to what you had.`

    toast({
      title: `${template.name} added`,
      description: leftOut ? `${added} ${leftOut}` : added,
      variant: result.duplicates.length || leftOut ? 'destructive' : undefined,
    })
  }

  const handleSubmit = async () => {
    /*
     * The untouched starter row is left out; every other row must be whole.
     *
     * This used to keep only the complete rows and send those, so a row with a
     * drug but no dosage vanished from the prescription without a word. The
     * same per-row rules the server runs (lib/prescribing.ts) mark each field
     * that is missing, under the field, with one toast to say so.
     */
    setShowErrors(true)
    const onlyRow = medications.every(isEmptyLine)
    const invalid =
      !selectedPatient ||
      medications.some((row, index) => rowErrors(row, index, onlyRow && index === 0))
    if (invalid || !selectedPatient) {
      toast(toastError('create the prescription', 'Check the highlighted fields.'))
      // After the errors have rendered, take the prescriber to the first one.
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('[aria-invalid="true"]')
        first?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
        first?.focus({ preventScroll: true })
      })
      return
    }
    const validMeds = medications.filter((m) => !isEmptyLine(m))

    // Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
    // // A warning that costs nothing to ignore is a warning people stop reading.
    // // This one asks for a deliberate answer, and takes no for one — but it does
    // // not refuse, because a prescriber may have a reason and software that
    // // says no outright gets worked around on paper.
    // const confirmClashes = (clashes: AllergyClash[]) =>
    //   confirm({
    //     title: `Prescribe for ${patientName(selectedPatient)} despite a recorded allergy?`,
    //     description: `${describeAllergyClashes(clashes)}.`,
    //     confirmLabel: 'Prescribe anyway',
    //     tone: 'destructive',
    //   })
    //
    // // Sent only once the prescriber has said yes. The server runs the same
    // // check and refuses a clash without it (finding 35).
    // let allergyAcknowledged = false
    // if (clashesByRow.size > 0) {
    //   if (!(await confirmClashes([...clashesByRow.values()].flat()))) return
    //   allergyAcknowledged = true
    // }

    const payload = {
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
        // Sent as typed: the server refuses anything that is not a whole
        // number above zero, rather than this quietly sending `NaN`.
        quantity: m.quantity.trim() ? Number(m.quantity) : null,
        instructions: m.instructions || null,
      })),
    }

    // Allergies are hidden for now (19 Oct 2026); uncomment to bring them back. With them, this sent
    // `{ ...payload, allergyAcknowledged }` and took the flag as an argument.
    const post = () =>
      fetch('/api/prescriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

    setSaving(true)
    try {
      const res = await post()
      const result = await res.json()

      // Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
      // /*
      //  * The server found a clash this screen did not show — it reads the
      //  * generic name from the catalogue, and the record may have changed since
      //  * the patient was loaded. Asked here the same way, and sent again only
      //  * on a yes.
      //  */
      // if (res.status === 409 && result?.code === 'ALLERGY_CLASH' && !allergyAcknowledged) {
      //   if (!(await confirmClashes(result.allergyClashes ?? []))) return
      //   res = await post(true)
      //   result = await res.json()
      // }

      if (!res.ok) throw new Error(result.error || 'Failed to save prescription')

      toast(toastSuccess('Prescription created', result.data.prescriptionNo))
      router.push(`/prescriptions/${result.data.id}`)
    } catch (error) {
      toast(toastError('create the prescription', error))
    } finally {
      setSaving(false)
    }
  }

  const back = <BackLink trail={trail} fallback="/prescriptions" fallbackLabel="Prescriptions" />

  if (canPrescribe === false) {
    return (
      <div className="space-y-6">
        <PageHeader back={back} title="New prescription" />
        <Card>
          <CardHeader>
            <CardTitle>Your role cannot write a prescription</CardTitle>
            <CardDescription>
              A prescription is issued in the prescriber&apos;s name, so it is written by a dentist,
              the clinic manager or an administrator. You can still read and print the prescriptions
              already issued.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const patientField = fieldIds('rx-patient', { error: errors.patient, required: true })

  /*
   * Its own block, not a clause appended to the phone number. Allergies were
   * shown as muted small print beside the ID, which is where the eye goes last
   * on a screen whose whole purpose is choosing a drug. Drawn inside the
   * patient card, under the name.
   */
  const medicalAlertBlock = selectedPatient ? (
    patientAlerts.length > 0 ? (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3" role="alert">
        <p className="text-sm font-semibold text-destructive">Medical alerts</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {patientAlerts.map((alert, i) => (
            <Badge key={i} variant={alert.tone === 'danger' ? 'destructive' : 'secondary'}>
              {alert.label}
            </Badge>
          ))}
        </div>
      </div>
    ) : (
      /* An empty history and an unasked question look identical on a screen
         that shows nothing, and they are not the same. */
      <p className="text-sm text-muted-foreground">
        No medical conditions recorded.{' '}
        <Link
          href={trail.to(`/patients/${selectedPatient.id}`)}
          className="underline hover:text-foreground"
        >
          Check the record
        </Link>{' '}
        before prescribing.
      </p>
    )
  ) : null

  return (
    <div ref={formRef} className="space-y-6">
      <PageHeader
        back={back}
        title="New prescription"
        description="Create a new e-prescription for a patient"
      />

      <div className="space-y-6">
        {/*
          Where this prescription came from, when it came from somewhere.
          Shown rather than hidden in the payload: a dentist should be able to
          see that this is attached to an extraction before they save it.
        */}
        {treatment && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-200">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600/10">
              <Stethoscope className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                Prescribing for {treatment.procedure?.name ?? 'treatment'} · {treatment.treatmentNo}
              </span>
              <span className="block text-xs opacity-80">
                The diagnosis and teeth below were carried across. Both are editable.
              </span>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setTreatment(null)}>
              Unlink
            </Button>
          </div>
        )}

        {/* Patient Selection */}
        <FormSection title="Patient" description="Select the patient for this prescription">
          <div className="space-y-2">
            {/*
              The shared picker: opens onto the newest patients, searches the
              register from the second letter, and arrow keys work. A link that
              names a patient (?patientId=) hands it over.
            */}
            <PatientPicker<Patient>
              id={patientField.id}
              aria-describedby={patientField.control['aria-describedby']}
              aria-invalid={patientField.control['aria-invalid']}
              value={selectedPatient}
              onChange={setSelectedPatient}
              initialPatientId={handedPatientId}
              alert={medicalAlertBlock}
            />
            {errors.patient && (
              <p id={patientField.errorId} className="text-sm text-destructive">
                {errors.patient}
              </p>
            )}
          </div>
        </FormSection>

        {/* Templates */}
        <FormSection
          title="Start from a template"
          description="Adds its medicines to whatever you have already typed. Nothing is replaced."
          aside={
            <Button asChild variant="outline" size="sm">
              <Link href="/prescriptions/templates">Manage templates</Link>
            </Button>
          }
        >
          <div>
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
          </div>
        </FormSection>

        <FormSection
          title="Diagnosis & teeth"
          description="Which teeth this prescription is about. Findings already on the patient's chart are marked."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Diagnosis or condition">
                {(control) => (
                  <Input
                    {...control}
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="e.g., Dental caries, Periodontal disease"
                  />
                )}
              </FormField>
              <FormField label="Valid until">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                  />
                )}
              </FormField>
            </div>

            <div className="space-y-2">
              <Label>Teeth</Label>
              {selectedPatient ? (
                <ToothPicker
                  patientId={selectedPatient.id}
                  selected={teeth}
                  onChange={setTeeth}
                  defaultToFindings
                  // A child opens on the primary teeth (bug report 12 Oct, finding 55).
                  age={selectedPatient.age}
                  dateOfBirth={selectedPatient.dateOfBirth}
                />
              ) : (
                <p className="text-muted-foreground rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm">
                  Choose a patient first — the chart above shows their findings.
                </p>
              )}
            </div>
          </div>
        </FormSection>

        {/* Medications: full width, because each row is a form of its own and
            would be cramped beside a section heading. */}
        <Card>
          <CardHeader>
            <CardTitle>Medications</CardTitle>
            <CardDescription>Choose each medicine from your drug catalogue</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {medications.map((med, index) => {
              const rowError = errors.rows[index] ?? {}
              return (
                <div key={med.key} className="space-y-4 rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2.5 text-sm font-semibold">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {index + 1}
                      </span>
                      Medication {index + 1}
                    </span>
                    {medications.length > 1 && (
                      <IconTooltip label={`Remove medication ${index + 1}`}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove medication ${index + 1}`}
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeMedRow(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </IconTooltip>
                    )}
                  </div>

                  {/*
                    A picker, not a text box. It used to be an Input with a
                    suggestion list: picking a suggestion linked the row to the
                    drug catalogue, typing a name and ignoring the list did not,
                    and nothing downstream could tell the two apart. Stock,
                    contraindications and side effects all hang off that link, so
                    a row without one is a row that silently opts out of every
                    check on this screen.
                  */}
                  <FormField
                    label="Medication"
                    required
                    htmlFor={`${idBase}-medication-${index}`}
                    error={rowError.medication}
                  >
                    {(control) => (
                      <MedicationPicker<MedicationOption>
                        id={control.id}
                        aria-describedby={control['aria-describedby']}
                        aria-invalid={control['aria-invalid']}
                        value={med.medicationId}
                        selectedLabel={med.medicationName}
                        onSelect={(chosen) => selectMedication(chosen, index)}
                        onClear={() => clearMedication(index)}
                      />
                    )}
                  </FormField>

                  {/*
                    What the catalogue knows about this drug, shown while it is
                    being prescribed rather than filed where nobody reads it.
                    These two columns existed on Medication from the start and
                    were written to by the catalogue form, but no screen had ever
                    displayed them — a field that writes to nowhere.
                  */}
                  {(med.contraindications || med.sideEffects) && (
                    <div className="rounded-xl bg-muted/60 p-3 text-xs">
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

                  {/* Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
                    Beside the drug that caused it, not gathered into a summary at
                    the bottom. The prescriber is looking at this row.
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
                  */}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    <FormField label="Dosage" required error={rowError.dosage}>
                      {(control) => (
                        <Input
                          {...control}
                          value={med.dosage}
                          onChange={(e) => updateMedRow(index, 'dosage', e.target.value)}
                          placeholder="1 tablet"
                        />
                      )}
                    </FormField>
                    <FormField label="Frequency" required error={rowError.frequency}>
                      {(control) => (
                        <Input
                          {...control}
                          value={med.frequency}
                          onChange={(e) => updateMedRow(index, 'frequency', e.target.value)}
                          placeholder="3 times a day"
                        />
                      )}
                    </FormField>
                    <FormField label="Duration" required error={rowError.duration}>
                      {(control) => (
                        <Input
                          {...control}
                          value={med.duration}
                          onChange={(e) => updateMedRow(index, 'duration', e.target.value)}
                          placeholder="5 days"
                        />
                      )}
                    </FormField>
                    <FormField label="Route">
                      {(control) => (
                        <Select
                          value={med.route}
                          onValueChange={(v) => updateMedRow(index, 'route', v)}
                        >
                          <SelectTrigger id={control.id}>
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
                      )}
                    </FormField>
                    <FormField label="Timing">
                      {(control) => (
                        <Select
                          value={med.timing || undefined}
                          onValueChange={(v) => updateMedRow(index, 'timing', v)}
                        >
                          <SelectTrigger id={control.id}>
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
                      )}
                    </FormField>
                    <FormField label="Quantity" error={rowError.quantity}>
                      {(control) => (
                        <Input
                          {...control}
                          type="number"
                          value={med.quantity}
                          onChange={(e) => updateMedRow(index, 'quantity', e.target.value)}
                          placeholder="10"
                        />
                      )}
                    </FormField>
                  </div>

                  <FormField label="Special instructions">
                    {(control) => (
                      <Input
                        {...control}
                        value={med.instructions}
                        onChange={(e) => updateMedRow(index, 'instructions', e.target.value)}
                        placeholder="Take with warm water, avoid dairy…"
                      />
                    )}
                  </FormField>

                  {rowError.other && <p className="text-sm text-destructive">{rowError.other}</p>}
                </div>
              )
            })}

            <Button type="button" variant="outline" onClick={addMedRow} className="w-full">
              <Plus className="h-4 w-4" />
              Add another medication
            </Button>
          </CardContent>
        </Card>

        {/* Notes */}
        <FormSection
          title="Additional notes"
          description="Advice and follow-up for the patient, printed under the medicines"
        >
          <Textarea
            aria-label="Additional notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="General advice, follow-up instructions…"
            rows={3}
          />
        </FormSection>

        {/* Submit, pinned to the bottom while the form scrolls */}
        <FormActions>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(trail.back('/prescriptions'))}
          >
            Cancel
          </Button>
          <SubmitButton
            type="button"
            onClick={handleSubmit}
            busy={saving}
            busyLabel="Creating prescription…"
          >
            Create prescription
          </SubmitButton>
        </FormActions>
      </div>
      {ConfirmDialogComponent}
    </div>
  )
}
