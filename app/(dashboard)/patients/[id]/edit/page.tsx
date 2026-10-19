'use client'

import { useState, useEffect } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { CNIC_PLACEHOLDER, formatCNIC, formatCNICInput } from '@/lib/cnic'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useTrail, BackLink } from '@/components/ui/trail'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/ui/form-field'
import { PhoneInput } from '@/components/ui/phone-input'
import { PageHeader } from '@/components/ui/page-header'
import { SubmitButton } from '@/components/ui/submit-button'
import { FormActions, FormSection } from '@/components/ui/form-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { ageInYears, birthDateForAge } from '@/lib/age'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import {
  firstPatientError,
  patientFormErrors,
  type PatientFieldErrors,
} from '@/components/patients/patient-form-errors'
import { AlertTriangle, Save } from 'lucide-react'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { BLOOD_GROUP_OPTIONS } from '@/lib/labels'
import { isoDay } from '@/lib/dates'
import { MedicalHistoryFields } from '@/components/patients/medical-history-fields'
import { EMPTY_MEDICAL_HISTORY, type MedicalHistoryInput } from '@/lib/medical-history'

export default function EditPatientPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const params = useParams()
  const patientId = params.id as string
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [reload, setReload] = useState(0)
  // The name as loaded, for the trail — not the field being typed into.
  const [savedName, setSavedName] = useState<string | null>(null)
  const trail = useTrail(savedName ? `Edit ${savedName}` : null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    age: '',
    gender: '',
    bloodGroup: '',
    phone: '',
    alternatePhone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    cnic: '',
    occupation: '',
    referredBy: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: '',
  })

  const [history, setHistory] = useState<MedicalHistoryInput>(EMPTY_MEDICAL_HISTORY)

  useEffect(() => {
    async function loadPatient() {
      setLoading(true)
      setFailed(false)
      setNotFound(false)
      try {
        const res = await fetch(`/api/patients/${patientId}`)
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        if (!res.ok) throw new Error('Failed to load patient')
        const data = await res.json()
        const p = data.patient || data
        setSavedName(`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null)

        setForm({
          firstName: p.firstName || '',
          lastName: p.lastName || '',
          dateOfBirth: isoDay(p.dateOfBirth),
          age: ageInYears(p.dateOfBirth)?.toString() ?? '',
          gender: p.gender || '',
          bloodGroup: p.bloodGroup || '',
          phone: p.phone || '',
          alternatePhone: p.alternatePhone || '',
          email: p.email || '',
          address: p.address || '',
          city: p.city || '',
          state: p.state || '',
          postalCode: p.postalCode || '',
          cnic: formatCNIC(p.cnic) || '',
          occupation: p.occupation || '',
          referredBy: p.referredBy || '',
          emergencyContactName: p.emergencyContactName || '',
          emergencyContactPhone: p.emergencyContactPhone || '',
          emergencyContactRelation: p.emergencyContactRelation || '',
        })

        // A patient registered before this form asked for a history has no
        // row at all, which is not the same as an empty one — both edit into
        // the same three empty lists here, and only a save writes anything.
        setHistory({
          allergies: p.medicalHistory?.allergies ?? [],
          conditions: p.medicalHistory?.conditions ?? [],
          currentMedications: p.medicalHistory?.currentMedications ?? [],
        })
      } catch {
        // Said on the page, with a way to try again — not as a toast over an
        // empty form that could then be saved over the record.
        setFailed(true)
      } finally {
        setLoading(false)
      }
    }
    loadPatient()
  }, [patientId, reload])

  // Said under each field (docs/UX_STANDARDS.md §5), not only in a toast.
  const [errors, setErrors] = useState<PatientFieldErrors>({})

  function clearError(field: string) {
    setErrors((prev) => (field in prev ? { ...prev, [field]: undefined } : prev))
  }

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    clearError(field)
  }

  // There is no age column — age is read from the date of birth — so an age
  // typed on its own used to be sent and dropped. Each field now fills the
  // other: a date gives the age, and an age gives the date it implies, marked
  // as an estimate until somebody types the real one.
  const [dobEstimated, setDobEstimated] = useState(false)

  function updateDateOfBirth(value: string) {
    const age = ageInYears(value)
    setForm((prev) => ({ ...prev, dateOfBirth: value, age: age === null ? '' : String(age) }))
    setDobEstimated(false)
    clearError('dateOfBirth')
  }

  function updateAge(value: string) {
    const estimate = value === '' ? null : birthDateForAge(Number(value))
    setForm((prev) => ({
      ...prev,
      age: value,
      dateOfBirth: estimate ?? (value === '' && dobEstimated ? '' : prev.dateOfBirth),
    }))
    setDobEstimated(estimate !== null || (value !== '' && dobEstimated))
    clearError('dateOfBirth')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // The same checks the server makes (lib/patient-validation.ts), asked
    // here so the desk is told before the request rather than after it — and
    // told under each field that needs fixing.
    const found = patientFormErrors(form)
    setErrors(found)
    const first = firstPatientError(found)
    if (first) {
      toast(toastError('save the patient', 'Check the highlighted fields.'))
      document.getElementById(first)?.focus()
      return
    }

    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
      }

      // Every optional field is sent, blank as null, so clearing one — a
      // wrong email, a city the patient has moved away from — clears it. They
      // used to be left out when blank, which the route reads as "leave it
      // alone", so the old value came back on the next load.
      const blankAsNull = (value: string) => (value.trim() ? value : null)
      payload.dateOfBirth = blankAsNull(form.dateOfBirth)
      payload.gender = blankAsNull(form.gender)
      payload.bloodGroup = blankAsNull(form.bloodGroup)
      payload.alternatePhone = blankAsNull(form.alternatePhone)
      payload.email = blankAsNull(form.email)
      payload.address = blankAsNull(form.address)
      payload.city = blankAsNull(form.city)
      payload.state = blankAsNull(form.state)
      payload.postalCode = blankAsNull(form.postalCode)
      // Sent even when blank, so clearing a wrongly-entered CNIC actually
      // clears it rather than silently keeping the old value.
      payload.cnic = form.cnic
      payload.occupation = blankAsNull(form.occupation)
      payload.emergencyContactName = blankAsNull(form.emergencyContactName)
      payload.emergencyContactPhone = blankAsNull(form.emergencyContactPhone)
      payload.emergencyContactRelation = blankAsNull(form.emergencyContactRelation)
      // Always sent, unlike on registration: removing the last allergy from a
      // record has to actually remove it, and an omitted key would read as
      // "leave it alone".
      payload.medicalHistory = history

      const response = await fetch(`/api/patients/${patientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      await readJson(response)

      toast(
        toastSuccess('Patient saved', `${form.firstName} ${form.lastName}'s record is up to date.`)
      )

      router.push(trail.back(`/patients/${patientId}`))
    } catch (error) {
      toast(toastError('save the patient', error))
    } finally {
      setSubmitting(false)
    }
  }

  const back = (
    <BackLink
      trail={trail}
      fallback={`/patients/${patientId}`}
      fallbackLabel={savedName ?? 'Patient'}
    />
  )

  if (loading) return <PageSkeleton variant="form" />

  if (failed) {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this patient" onRetry={() => setReload((n) => n + 1)} />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState
          icon={AlertTriangle}
          title="Patient not found"
          description="They may have been removed, or the link is wrong."
          actionLabel="Back to patients"
          actionHref="/patients"
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit patient" description={savedName ?? undefined} back={back} />

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Personal Information */}
        <FormSection title="Personal information" description="Basic details of the patient">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FormField label="First name" required htmlFor="firstName" error={errors.firstName}>
              {(control) => (
                <Input
                  {...control}
                  value={form.firstName}
                  onChange={(e) => updateField('firstName', e.target.value)}
                  placeholder="Enter first name"
                />
              )}
            </FormField>
            <FormField label="Last name" required htmlFor="lastName" error={errors.lastName}>
              {(control) => (
                <Input
                  {...control}
                  value={form.lastName}
                  onChange={(e) => updateField('lastName', e.target.value)}
                  placeholder="Enter last name"
                />
              )}
            </FormField>
            <FormField label="Date of birth" htmlFor="dateOfBirth" error={errors.dateOfBirth}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => updateDateOfBirth(e.target.value)}
                />
              )}
            </FormField>
            <div className="space-y-2">
              <Label htmlFor="age">Age</Label>
              <Input
                id="age"
                type="number"
                value={form.age}
                onChange={(e) => updateAge(e.target.value)}
                placeholder="Age"
                min="0"
                max="150"
              />
              {dobEstimated && (
                <p className="text-xs text-muted-foreground">
                  Date of birth estimated from the age. Replace it if the patient knows the real
                  one.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select value={form.gender} onValueChange={(v) => updateField('gender', v)}>
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bloodGroup">Blood group</Label>
              <Select value={form.bloodGroup} onValueChange={(v) => updateField('bloodGroup', v)}>
                <SelectTrigger id="bloodGroup">
                  <SelectValue placeholder="Select blood group" />
                </SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUP_OPTIONS.map((bg) => (
                    <SelectItem key={bg.value} value={bg.value}>
                      {bg.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </FormSection>

        {/* Contact Information */}
        <FormSection title="Contact information" description="Phone, email, and address details">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FormField label="Phone" required htmlFor="phone" error={errors.phone}>
              {(control) => (
                <PhoneInput
                  {...control}
                  value={form.phone}
                  onChange={(value) => updateField('phone', value)}
                />
              )}
            </FormField>
            <FormField
              label="Alternate phone"
              htmlFor="alternatePhone"
              error={errors.alternatePhone}
            >
              {(control) => (
                <PhoneInput
                  {...control}
                  value={form.alternatePhone}
                  onChange={(value) => updateField('alternatePhone', value)}
                />
              )}
            </FormField>
            <FormField label="Email" htmlFor="email" error={errors.email}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="Enter email address"
                />
              )}
            </FormField>
            <div className="space-y-2 md:col-span-2 xl:col-span-3">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={form.address}
                onChange={(e) => updateField('address', e.target.value)}
                placeholder="Enter full address"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="City"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={form.state}
                onChange={(e) => updateField('state', e.target.value)}
                placeholder="State"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postalCode">Postal code</Label>
              <Input
                id="postalCode"
                value={form.postalCode}
                onChange={(e) => updateField('postalCode', e.target.value)}
                placeholder="Postal code"
              />
            </div>
          </div>
        </FormSection>

        {/* Additional Details */}
        <FormSection
          title="Additional details"
          description="ID, occupation, and referral information"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cnic">CNIC</Label>
              <Input
                id="cnic"
                value={form.cnic}
                onChange={(e) => updateField('cnic', formatCNICInput(e.target.value))}
                placeholder={CNIC_PLACEHOLDER}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="occupation">Occupation</Label>
              <Input
                id="occupation"
                value={form.occupation}
                onChange={(e) => updateField('occupation', e.target.value)}
                placeholder="Enter occupation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referredBy">Referred by</Label>
              <Input
                id="referredBy"
                value={form.referredBy}
                onChange={(e) => updateField('referredBy', e.target.value)}
                placeholder="Referral source"
                disabled
              />
            </div>
          </div>
        </FormSection>

        {/* Emergency Contact */}
        <FormSection title="Emergency contact" description="Emergency contact information">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="emergencyContactName">Contact name</Label>
              <Input
                id="emergencyContactName"
                value={form.emergencyContactName}
                onChange={(e) => updateField('emergencyContactName', e.target.value)}
                placeholder="Emergency contact name"
              />
            </div>
            <FormField
              label="Contact phone"
              htmlFor="emergencyContactPhone"
              error={errors.emergencyContactPhone}
            >
              {(control) => (
                <PhoneInput
                  {...control}
                  value={form.emergencyContactPhone}
                  onChange={(value) => updateField('emergencyContactPhone', value)}
                />
              )}
            </FormField>
            <div className="space-y-2">
              <Label htmlFor="emergencyContactRelation">Relation</Label>
              <Input
                id="emergencyContactRelation"
                value={form.emergencyContactRelation}
                onChange={(e) => updateField('emergencyContactRelation', e.target.value)}
                placeholder="e.g. Spouse, Parent"
              />
            </div>
          </div>
        </FormSection>

        <MedicalHistoryFields values={history} onChange={setHistory} />

        {/* Submit, pinned to the bottom while the form scrolls */}
        <FormActions>
          <Button type="button" variant="outline" asChild>
            <Link href={trail.back(`/patients/${patientId}`)}>Cancel</Link>
          </Button>
          <SubmitButton busy={submitting} busyLabel="Saving…" icon={Save}>
            Save changes
          </SubmitButton>
        </FormActions>
      </form>
    </div>
  )
}
