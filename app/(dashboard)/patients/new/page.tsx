'use client'

import { useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { CNIC_PLACEHOLDER, formatCNIC, formatCNICInput } from '@/lib/cnic'
import { useRouter } from 'next/navigation'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Save } from 'lucide-react'
import { DuplicateDetector } from '@/components/patients/duplicate-detector'
import { BLOOD_GROUP_OPTIONS } from '@/lib/labels'
import { MedicalHistoryFields } from '@/components/patients/medical-history-fields'
import {
  EMPTY_MEDICAL_HISTORY,
  isBlankMedicalHistory,
  type MedicalHistoryInput,
} from '@/lib/medical-history'

export default function NewPatientPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const { toast } = useToast()
  const trail = useTrail('New patient')
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
    referralCode: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: '',
  })

  /**
   * Kept beside the patient rather than inside `form`, because it is a
   * different shape — three lists, not a flat bag of strings — and because it
   * is sent as its own nested object.
   */
  const [history, setHistory] = useState<MedicalHistoryInput>(EMPTY_MEDICAL_HISTORY)

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
      toast(toastError('create the patient', 'Check the highlighted fields.'))
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

      if (form.dateOfBirth) payload.dateOfBirth = form.dateOfBirth
      if (form.gender) payload.gender = form.gender
      if (form.bloodGroup) payload.bloodGroup = form.bloodGroup
      if (form.alternatePhone) payload.alternatePhone = form.alternatePhone
      if (form.email) payload.email = form.email
      if (form.address) payload.address = form.address
      if (form.city) payload.city = form.city
      if (form.state) payload.state = form.state
      if (form.postalCode) payload.postalCode = form.postalCode
      if (form.cnic) payload.cnic = form.cnic
      if (form.occupation) payload.occupation = form.occupation
      if (form.referredBy) payload.referredBy = form.referredBy
      if (form.referralCode) payload.referralCode = form.referralCode
      if (form.emergencyContactName) payload.emergencyContactName = form.emergencyContactName
      if (form.emergencyContactPhone) payload.emergencyContactPhone = form.emergencyContactPhone
      if (form.emergencyContactRelation)
        payload.emergencyContactRelation = form.emergencyContactRelation
      // Omitted entirely when nothing was filled in, so a patient registered
      // without a history has no row rather than an empty one. "Not asked" and
      // "asked, nothing to report" look the same on screen either way, and the
      // absent row is the honest one.
      if (!isBlankMedicalHistory(history)) payload.medicalHistory = history

      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const patient = await readJson<{ id: string }>(response)

      toast(toastSuccess('Patient created', `${form.firstName} ${form.lastName} is registered.`))

      router.push(`/patients/${patient.id}`)
    } catch (error) {
      toast(toastError('create the patient', error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New patient"
        description="Register a new patient"
        back={<BackLink trail={trail} fallback="/patients" fallbackLabel="Patients" />}
      />

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle>Personal information</CardTitle>
            <CardDescription>Basic details of the patient</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card>
          <CardHeader>
            <CardTitle>Contact information</CardTitle>
            <CardDescription>Phone, email, and address details</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <div className="space-y-2 md:col-span-2 lg:col-span-3">
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
          </CardContent>
        </Card>

        {/* Additional Details */}
        <Card>
          <CardHeader>
            <CardTitle>Additional details</CardTitle>
            <CardDescription>ID, occupation, and referral information</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cnic">CNIC</Label>
              <Input
                id="cnic"
                value={form.cnic}
                onChange={(e) => updateField('cnic', formatCNICInput(e.target.value))}
                placeholder={CNIC_PLACEHOLDER}
                inputMode="numeric"
              />
              <p className="text-muted-foreground text-xs">
                Optional — children are issued a B-Form rather than a CNIC.
              </p>
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referralCode">Referral code</Label>
              <Input
                id="referralCode"
                value={form.referralCode}
                onChange={(e) => updateField('referralCode', e.target.value)}
                placeholder="e.g. REF-A3B2K9"
              />
            </div>
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <CardHeader>
            <CardTitle>Emergency contact</CardTitle>
            <CardDescription>Emergency contact information</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
          </CardContent>
        </Card>

        <MedicalHistoryFields values={history} onChange={setHistory} />

        {/* Duplicate Detection */}
        <DuplicateDetector
          firstName={form.firstName}
          lastName={form.lastName}
          phone={form.phone}
          email={form.email}
          dateOfBirth={form.dateOfBirth}
          cnic={form.cnic}
          onSelect={(existingId) => router.push(`/patients/${existingId}`)}
        />

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" asChild>
            <Link href={trail.back('/patients')}>Cancel</Link>
          </Button>
          <SubmitButton busy={submitting} busyLabel="Creating patient…" icon={Save}>
            Create patient
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}
