'use client'

import { useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { CNIC_PLACEHOLDER, formatCNICInput } from '@/lib/cnic'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormField } from '@/components/ui/form-field'
import { PhoneInput } from '@/components/ui/phone-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { BackLink, useTrail } from '@/components/ui/trail'
import { Textarea } from '@/components/ui/textarea'
import { FormActions, FormSection } from '@/components/ui/form-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Eye, EyeOff, UserPlus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { ALL_ROLES, ROLE_LABELS, SECONDARY_ROLES } from '@/lib/rbac'
import { useCan } from '@/hooks/use-can'
import { isoDay } from '@/lib/dates'
import { validatePassword } from '@/lib/password-policy'
import { ToastAction } from '@/components/ui/toast'
import { isValidEmail } from '@/lib/email-address'
import { phoneProblem } from '@/lib/staff-rules'
import { toastError, toastSuccess } from '@/lib/toast-utils'

/** The fields that can carry an inline error. */
type ErrorField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'password'
  | 'role'
  | 'phone'
  | 'alternatePhone'
  | 'emergencyPhone'

/** In the order they appear, so the first one is the one scrolled to. */
const ERROR_ORDER: ErrorField[] = [
  'firstName',
  'lastName',
  'email',
  'password',
  'role',
  'phone',
  'alternatePhone',
  'emergencyPhone',
]

export default function NewStaffPage() {
  const router = useRouter()
  const trail = useTrail('New staff member')
  const canManageAdmins = useCan('users:manage') === true
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  // Warn before a half-filled form is thrown away by a stray click — but not
  // during the navigation a successful save makes.
  const guard = useFormGuard(loading)
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<ErrorField, string>>>({})

  const [formData, setFormData] = useState({
    // Basic Info
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    alternatePhone: '',
    role: '',
    clinicalRole: '',
    password: '',

    // Personal Details
    dateOfBirth: '',
    gender: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',

    // Documents
    cnic: '',
    nationalTaxNo: '',

    // Professional
    qualification: '',
    specialization: '',
    licenseNumber: '',
    joiningDate: isoDay(new Date()),

    // Emergency
    emergencyContact: '',
    emergencyPhone: '',
  })

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // A field's message goes as soon as it is touched again.
    if (field in errors) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  /**
   * What is wrong with the form, field by field. The same rules the API
   * applies (finding 28), checked here first so the form says so — under the
   * field — before a round trip.
   */
  const validate = (): Partial<Record<ErrorField, string>> => {
    const found: Partial<Record<ErrorField, string>> = {}
    if (!formData.firstName.trim()) found.firstName = 'Enter a first name'
    if (!formData.lastName.trim()) found.lastName = 'Enter a last name'
    if (!formData.email.trim()) found.email = 'Enter an email address'
    else if (!isValidEmail(formData.email)) found.email = 'Enter a valid email address'
    const weak = validatePassword(formData.password)
    if (weak) found.password = weak
    if (!formData.role) found.role = 'Choose a role'
    const phone = phoneProblem(formData.phone, 'Phone', { required: true })
    if (phone) found.phone = phone
    const alternate = phoneProblem(formData.alternatePhone, 'Alternate phone')
    if (alternate) found.alternatePhone = alternate
    const emergency = phoneProblem(formData.emergencyPhone, 'Emergency phone')
    if (emergency) found.emergencyPhone = emergency
    return found
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const found = validate()
    setErrors(found)
    const first = ERROR_ORDER.find((field) => found[field])
    if (first) {
      toast(toastError('create the staff member', 'Check the highlighted fields.'))
      const element = document.getElementById(first)
      element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      element?.focus()
      return
    }

    try {
      setLoading(true)

      const response = await fetch('/api/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        // The plan's staff limit: say which plan, and offer the way past it
        // rather than leave the administrator to find the pricing page
        // (finding 53).
        if (error.code === 'STAFF_LIMIT') {
          toast({
            ...toastError('create the staff member', error.error),
            action: (
              <ToastAction altText="See plans" onClick={() => router.push('/pricing')}>
                See plans
              </ToastAction>
            ),
          })
          setLoading(false)
          return
        }
        throw new Error(error.error || 'Failed to create staff member')
      }

      const staff = await response.json()

      toast(toastSuccess('Staff member created', `${staff.firstName} ${staff.lastName}`))

      // Saved: leaving now is not leaving unsaved work.
      guard.reset()
      router.push('/staff')
    } catch (error) {
      console.error('Error creating staff:', error)
      toast(toastError('create the staff member', error))
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New staff member"
        description="Create a new staff member account"
        back={<BackLink trail={trail} fallback="/staff" fallbackLabel="Staff" />}
      />

      <form ref={guard} onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Account Information */}
        <FormSection
          title="Account information"
          description="Login credentials and role assignment"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="First name" htmlFor="firstName" required error={errors.firstName}>
              {(control) => (
                <Input
                  {...control}
                  value={formData.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                  placeholder="Enter first name"
                />
              )}
            </FormField>
            <FormField label="Last name" htmlFor="lastName" required error={errors.lastName}>
              {(control) => (
                <Input
                  {...control}
                  value={formData.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                  placeholder="Enter last name"
                />
              )}
            </FormField>

            <FormField label="Email" htmlFor="email" required error={errors.email}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="staff@yourclinic.com"
                />
              )}
            </FormField>

            <FormField label="Password" htmlFor="password" required error={errors.password}>
              {(control) => (
                <div className="relative">
                  <Input
                    {...control}
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    placeholder="8 to 32 characters"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </FormField>

            <FormField label="Role" htmlFor="role" required error={errors.role}>
              {(control) => (
                <Select
                  value={formData.role}
                  onValueChange={(value) => handleChange('role', value)}
                >
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Administrator is offered only to an administrator: the
                        server refuses anybody else — see staffChangeRefusal. */}
                    {ALL_ROLES.filter(
                      (r) => r !== 'ADMIN' || canManageAdmins || formData.role === 'ADMIN'
                    ).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>

            {/* Optional second role — for the owner who also treats patients.
                Capabilities become the union of the two. See lib/rbac.ts. */}
            <FormField
              label="Also works as (optional)"
              htmlFor="clinicalRole"
              hint="For someone who holds two jobs — an owner who also treats patients. They get the permissions of both roles."
            >
              {(control) => (
                <Select
                  value={formData.clinicalRole || 'NONE'}
                  onValueChange={(value) =>
                    handleChange('clinicalRole', value === 'NONE' ? '' : value)
                  }
                >
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="No second role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No second role</SelectItem>
                    {SECONDARY_ROLES.filter((r) => r !== formData.role).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          </div>
        </FormSection>

        {/* Contact Information */}
        <FormSection title="Contact information" description="Phone and address details">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FormField label="Phone" htmlFor="phone" required error={errors.phone}>
              {(control) => (
                <PhoneInput
                  {...control}
                  value={formData.phone}
                  onChange={(value) => handleChange('phone', value)}
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
                  autoComplete="off"
                  value={formData.alternatePhone}
                  onChange={(value) => handleChange('alternatePhone', value)}
                />
              )}
            </FormField>

            <div className="space-y-2 md:col-span-2 xl:col-span-3">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => handleChange('address', e.target.value)}
                placeholder="Enter full address"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                placeholder="Lahore"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => handleChange('state', e.target.value)}
                placeholder="Punjab"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postalCode">Postal code</Label>
              <Input
                id="postalCode"
                value={formData.postalCode}
                onChange={(e) => handleChange('postalCode', e.target.value)}
                placeholder="54000"
              />
            </div>
          </div>
        </FormSection>

        {/* Personal Details */}
        <FormSection title="Personal details" description="Personal and identification information">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">Date of birth</Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => handleChange('dateOfBirth', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select
                value={formData.gender}
                onValueChange={(value) => handleChange('gender', value)}
              >
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
              <Label htmlFor="cnic">CNIC</Label>
              <Input
                id="cnic"
                value={formData.cnic}
                onChange={(e) => handleChange('cnic', formatCNICInput(e.target.value))}
                placeholder={CNIC_PLACEHOLDER}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nationalTaxNo">National tax number (NTN)</Label>
              <Input
                id="nationalTaxNo"
                value={formData.nationalTaxNo}
                onChange={(e) => handleChange('nationalTaxNo', e.target.value)}
                placeholder="1234567"
              />
            </div>
          </div>
        </FormSection>

        {/* Professional Details */}
        <FormSection
          title="Professional details"
          description="Qualifications and employment information"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="qualification">Qualification</Label>
              <Input
                id="qualification"
                value={formData.qualification}
                onChange={(e) => handleChange('qualification', e.target.value)}
                placeholder="BDS, MDS"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="specialization">Specialization</Label>
              <Input
                id="specialization"
                value={formData.specialization}
                onChange={(e) => handleChange('specialization', e.target.value)}
                placeholder="Orthodontics, Endodontics"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="licenseNumber">License number</Label>
              <Input
                id="licenseNumber"
                value={formData.licenseNumber}
                onChange={(e) => handleChange('licenseNumber', e.target.value)}
                placeholder="TN/12345"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="joiningDate">Joining date</Label>
              <Input
                id="joiningDate"
                type="date"
                max={isoDay(new Date())}
                value={formData.joiningDate}
                onChange={(e) => handleChange('joiningDate', e.target.value)}
              />
            </div>
          </div>
        </FormSection>

        {/* Emergency Contact */}
        <FormSection title="Emergency contact" description="Contact person in case of emergency">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="emergencyContact">Contact name</Label>
              <Input
                id="emergencyContact"
                value={formData.emergencyContact}
                onChange={(e) => handleChange('emergencyContact', e.target.value)}
                placeholder="Full name"
              />
            </div>
            <FormField label="Contact phone" htmlFor="emergencyPhone" error={errors.emergencyPhone}>
              {(control) => (
                <PhoneInput
                  {...control}
                  autoComplete="off"
                  value={formData.emergencyPhone}
                  onChange={(value) => handleChange('emergencyPhone', value)}
                />
              )}
            </FormField>
          </div>
        </FormSection>

        {/* Submit, pinned to the bottom while the form scrolls */}
        <FormActions>
          <Button variant="outline" type="button" asChild>
            <Link href={trail.back('/staff')}>Cancel</Link>
          </Button>
          <SubmitButton busy={loading} busyLabel="Creating…" icon={UserPlus}>
            Create staff member
          </SubmitButton>
        </FormActions>
      </form>
    </div>
  )
}
