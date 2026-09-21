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
import { useConfirmDialog } from '@/components/ui/confirm-dialog'

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
}

interface MedicationRow {
  key: number
  medicationId: string | null
  medicationName: string
  /** Carried so the allergy check can read it. Not sent, not displayed: a row
      typed by hand has none, and the check falls back to the written name. */
  genericName: string | null
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
  const [activeMedRow, setActiveMedRow] = useState<number | null>(null)

  // Form data
  const [diagnosis, setDiagnosis] = useState('')
  const [notes, setNotes] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [medications, setMedications] = useState<MedicationRow[]>([
    {
      key: ++rowKey,
      medicationId: null,
      medicationName: '',
      genericName: null,
      dosage: '',
      frequency: '',
      duration: '',
      route: 'Oral',
      timing: '',
      quantity: '',
      instructions: '',
    },
  ])

  // Pre-fill patient from query param
  useEffect(() => {
    const pid = searchParams.get('patientId')
    if (pid) {
      fetch(`/api/patients/${pid}`)
        .then((r) => r.json())
        .then((result) => {
          if (result.success || result.data || result.id) {
            const p = result.data || result
            setSelectedPatient(p)
          }
        })
        .catch(() => {})
    }
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
          `/api/medications?search=${encodeURIComponent(term)}&limit=10&active=true`
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

  const selectMedication = (med: MedicationOption, rowIndex: number) => {
    setMedications((prev) =>
      prev.map((r, i) =>
        i === rowIndex
          ? {
              ...r,
              medicationId: med.id,
              medicationName: `${med.name}${med.strength ? ` ${med.strength}` : ''}${med.form ? ` (${med.form})` : ''}`,
              genericName: med.genericName,
              dosage: r.dosage || med.defaultDosage || '',
              frequency: r.frequency || med.defaultFrequency || '',
              duration: r.duration || med.defaultDuration || '',
            }
          : r
      )
    )
    setMedSearch('')
    setMedOptions([])
    setActiveMedRow(null)
  }

  const updateMedRow = (index: number, field: keyof MedicationRow, value: string) => {
    setMedications((prev) =>
      prev.map((r, i) =>
        i === index
          ? {
              ...r,
              [field]: value,
              // Typing over a name that was picked from the catalogue detaches
              // the row from it. Keeping the old generic would let the allergy
              // check answer for a drug that is no longer written here.
              ...(field === 'medicationName' ? { medicationId: null, genericName: null } : {}),
            }
          : r
      )
    )
  }

  const addMedRow = () => {
    setMedications((prev) => [
      ...prev,
      {
        key: ++rowKey,
        medicationId: null,
        medicationName: '',
        genericName: null,
        dosage: '',
        frequency: '',
        duration: '',
        route: 'Oral',
        timing: '',
        quantity: '',
        instructions: '',
      },
    ])
  }

  const removeMedRow = (index: number) => {
    if (medications.length <= 1) return
    setMedications((prev) => prev.filter((_, i) => i !== index))
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
    <div ref={formRef} className="container mx-auto p-6 max-w-4xl">
      <Button variant="ghost" className="mb-4" onClick={() => router.push('/prescriptions')}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to Prescriptions
      </Button>

      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ClipboardList className="h-8 w-8" />
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
                {(patients.length > 0 || searchingPatients) && (
                  <div className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                    {searchingPatients ? (
                      <div className="p-3 text-center text-sm text-muted-foreground">
                        Searching...
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
        <Card>
          <CardHeader>
            <CardTitle>Diagnosis</CardTitle>
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

                {/* Medication name with search */}
                <div className="relative">
                  <Label>Medication Name *</Label>
                  <Input
                    value={activeMedRow === index ? medSearch : med.medicationName}
                    onChange={(e) => {
                      if (activeMedRow !== index) setActiveMedRow(index)
                      setMedSearch(e.target.value)
                      updateMedRow(index, 'medicationName', e.target.value)
                    }}
                    onFocus={() => setActiveMedRow(index)}
                    placeholder="Search from catalog or type name..."
                  />
                  {activeMedRow === index && medOptions.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                      {medOptions.map((m) => (
                        <button
                          key={m.id}
                          className="w-full px-3 py-2 text-left hover:bg-accent text-sm"
                          onClick={() => selectMedication(m, index)}
                        >
                          <span className="font-medium">{m.name}</span>
                          {m.strength && (
                            <span className="text-muted-foreground ml-1">{m.strength}</span>
                          )}
                          {m.form && <span className="text-muted-foreground ml-1">({m.form})</span>}
                          {m.genericName && (
                            <span className="text-muted-foreground ml-2">— {m.genericName}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

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
