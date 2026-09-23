'use client'

import { useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { CNIC_PLACEHOLDER, formatCNIC, formatCNICInput } from '@/lib/cnic'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import { DuplicateDetector } from '@/components/patients/duplicate-detector'
import { BLOOD_GROUP_OPTIONS } from '@/lib/labels'

export default function NewPatientPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const { toast } = useToast()
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

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.firstName || !form.lastName || !form.phone) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'First name, last name, and phone are required.',
      })
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
      if (form.age) payload.age = parseInt(form.age)
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

      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error || `Failed to create patient (${response.status})`)
      }

      const patient = await response.json()

      toast({
        title: 'Patient Created',
        description: `Patient ${form.firstName} ${form.lastName} has been registered successfully.`,
      })

      router.push(`/patients/${patient.id}`)
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create patient',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Go back" asChild>
          <Link href="/patients">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="page-title">New Patient</h1>
          <p className="text-muted-foreground">Register a new patient</p>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Basic details of the patient</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
                placeholder="Enter first name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
                placeholder="Enter last name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => updateField('dateOfBirth', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="age">Age</Label>
              <Input
                id="age"
                type="number"
                value={form.age}
                onChange={(e) => updateField('age', e.target.value)}
                placeholder="Age"
                min="0"
                max="150"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select value={form.gender} onValueChange={(v) => updateField('gender', v)}>
                <SelectTrigger>
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
              <Label htmlFor="bloodGroup">Blood Group</Label>
              <Select value={form.bloodGroup} onValueChange={(v) => updateField('bloodGroup', v)}>
                <SelectTrigger>
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
            <CardTitle>Contact Information</CardTitle>
            <CardDescription>Phone, email, and address details</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone *</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="Enter phone number"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alternatePhone">Alternate Phone</Label>
              <Input
                id="alternatePhone"
                value={form.alternatePhone}
                onChange={(e) => updateField('alternatePhone', e.target.value)}
                placeholder="Alternate phone number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="Enter email address"
              />
            </div>
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
              <Label htmlFor="postalCode">Postal Code</Label>
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
            <CardTitle>Additional Details</CardTitle>
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
              <Label htmlFor="referredBy">Referred By</Label>
              <Input
                id="referredBy"
                value={form.referredBy}
                onChange={(e) => updateField('referredBy', e.target.value)}
                placeholder="Referral source"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referralCode">Referral Code</Label>
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
            <CardTitle>Emergency Contact</CardTitle>
            <CardDescription>Emergency contact information</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="emergencyContactName">Contact Name</Label>
              <Input
                id="emergencyContactName"
                value={form.emergencyContactName}
                onChange={(e) => updateField('emergencyContactName', e.target.value)}
                placeholder="Emergency contact name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergencyContactPhone">Contact Phone</Label>
              <Input
                id="emergencyContactPhone"
                value={form.emergencyContactPhone}
                onChange={(e) => updateField('emergencyContactPhone', e.target.value)}
                placeholder="Emergency contact phone"
              />
            </div>
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
            <Link href="/patients">Cancel</Link>
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Create Patient
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
