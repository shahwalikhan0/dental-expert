'use client'

import { useState, useEffect, use } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { formatCNIC, formatCNICInput } from '@/lib/cnic'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FormActions, FormSection } from '@/components/ui/form-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { FormField } from '@/components/ui/form-field'
import { PhoneInput } from '@/components/ui/phone-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { BackLink, useTrail } from '@/components/ui/trail'
import { Eye, EyeOff, Save, UserX } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { validatePassword } from '@/lib/password-policy'
import { ALL_ROLES, ROLE_LABELS, SECONDARY_ROLES } from '@/lib/rbac'
import { useCan } from '@/hooks/use-can'
import { isoDay } from '@/lib/dates'
import { ToastAction } from '@/components/ui/toast'
import { isValidEmail } from '@/lib/email-address'
import { STAFF_HR_FIELDS, phoneProblem } from '@/lib/staff-rules'
import { toastError, toastSuccess } from '@/lib/toast-utils'
import {
  OpenAppointmentsDialog,
  type OpenAppointment,
} from '@/app/(dashboard)/staff/_components/open-appointments-dialog'

/** The fields that can carry an inline error. */
type ErrorField =
  'firstName' | 'lastName' | 'email' | 'newPassword' | 'phone' | 'alternatePhone' | 'emergencyPhone'

/** In the order they appear, so the first one is the one scrolled to. */
const ERROR_ORDER: ErrorField[] = [
  'firstName',
  'lastName',
  'email',
  'newPassword',
  'phone',
  'alternatePhone',
  'emergencyPhone',
]

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const canManageAdmins = useCan('users:manage') === true
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  // The record could not be fetched (failed), or does not exist (missing).
  const [failed, setFailed] = useState(false)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Warn before a half-filled form is thrown away by a stray click — but not
  // during the navigation a successful save makes. A callback ref, so it
  // attaches when the form appears after the skeleton.
  const guard = useFormGuard(saving)
  const [errors, setErrors] = useState<Partial<Record<ErrorField, string>>>({})
  // The name as loaded, for the back link and the trail — not as being typed.
  const [savedName, setSavedName] = useState<string | null>(null)
  const trail = useTrail(savedName ? `Edit ${savedName}` : null)
  const [showPassword, setShowPassword] = useState(false)
  /**
   * Whether the private fields came back. They go only to `staff:hr` (finding
   * 42); without them the Personal Details card is not shown, and they are
   * not sent back — a blank field would otherwise overwrite what is on file.
   */
  const [hasHrFields, setHasHrFields] = useState(true)
  // Appointments still booked with this person, when switching them off was
  // refused until confirmed (finding 21).
  const [openDiary, setOpenDiary] = useState<OpenAppointment[] | null>(null)

  const [formData, setFormData] = useState({
    // Basic Info
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    alternatePhone: '',
    role: '',
    clinicalRole: '',
    newPassword: '',

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
    joiningDate: '',

    // Financial

    // Emergency
    emergencyContact: '',
    emergencyPhone: '',

    // Status
    isActive: true,
  })

  const [shifts, setShifts] = useState<
    Array<{
      dayOfWeek: number
      startTime: string
      endTime: string
      isActive: boolean
    }>
  >([])

  const fetchStaff = async () => {
    try {
      setLoading(true)
      setFailed(false)
      setMissing(false)
      const response = await fetch(`/api/staff/${resolvedParams.id}`)
      if (response.status === 404) {
        setMissing(true)
        return
      }
      if (!response.ok) throw new Error('Failed to fetch staff')

      const data = await response.json()

      setSavedName(`${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || null)
      setHasHrFields('cnic' in data)
      setFormData({
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email: data.user?.email || data.email || '',
        phone: data.phone || '',
        alternatePhone: data.alternatePhone || '',
        role: data.user.role || '',
        clinicalRole: data.user.clinicalRole || '',
        newPassword: '',
        dateOfBirth: isoDay(data.dateOfBirth),
        gender: data.gender || '',
        address: data.address || '',
        city: data.city || '',
        state: data.state || '',
        postalCode: data.postalCode || '',
        cnic: formatCNIC(data.cnic) || '',
        nationalTaxNo: data.nationalTaxNo || '',
        qualification: data.qualification || '',
        specialization: data.specialization || '',
        licenseNumber: data.licenseNumber || '',
        // The stored value is UTC midnight of the day chosen; read as that day.
        joiningDate: data.joiningDate ? String(data.joiningDate).slice(0, 10) : '',
        emergencyContact: data.emergencyContact || '',
        emergencyPhone: data.emergencyPhone || '',
        isActive: data.isActive,
      })

      // Initialize shifts for all 7 days
      const initialShifts = dayNames.map((_, index) => {
        const existingShift = data.shifts?.find((s: any) => s.dayOfWeek === index)
        return (
          existingShift || {
            dayOfWeek: index,
            startTime: '09:00',
            endTime: '18:00',
            isActive: false,
          }
        )
      })
      setShifts(initialShifts)
    } catch (error) {
      console.error('Error fetching staff:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Loading the screen's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStaff()
    // Refetch when what is asked changes; `fetchStaff` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedParams.id])

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // A field's message goes as soon as it is touched again.
    if (field in errors) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  /**
   * What is wrong with the form, field by field — the same rules the API
   * applies (finding 28), said under the field before a round trip.
   */
  const validate = (): Partial<Record<ErrorField, string>> => {
    const found: Partial<Record<ErrorField, string>> = {}
    if (!formData.firstName.trim()) found.firstName = 'Enter a first name'
    if (!formData.lastName.trim()) found.lastName = 'Enter a last name'
    if (!formData.email.trim()) found.email = 'Enter an email address'
    else if (!isValidEmail(formData.email)) found.email = 'Enter a valid email address'
    const weak = formData.newPassword ? validatePassword(formData.newPassword) : null
    if (weak) found.newPassword = weak
    const phone = phoneProblem(formData.phone, 'Phone', { required: true })
    if (phone) found.phone = phone
    const alternate = phoneProblem(formData.alternatePhone, 'Alternate phone')
    if (alternate) found.alternatePhone = alternate
    const emergency = hasHrFields ? phoneProblem(formData.emergencyPhone, 'Emergency phone') : null
    if (emergency) found.emergencyPhone = emergency
    return found
  }

  const handleShiftChange = (dayOfWeek: number, field: string, value: string | boolean) => {
    setShifts((prev) =>
      prev.map((shift) => (shift.dayOfWeek === dayOfWeek ? { ...shift, [field]: value } : shift))
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await save(false)
  }

  /**
   * Save the profile, then the shifts.
   *
   * `confirm` is sent only from the dialog that lists the appointments still
   * booked with somebody being switched off — the server refuses the change
   * with 409 and that list until it has been seen.
   */
  const save = async (confirm: boolean) => {
    const found = validate()
    setErrors(found)
    const first = ERROR_ORDER.find((field) => found[field])
    if (first) {
      toast(toastError('save the staff member', 'Check the highlighted fields.'))
      const element = document.getElementById(first)
      element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      element?.focus()
      return
    }

    // Leave out what this person was never shown — see `hasHrFields`.
    const payload: Record<string, unknown> = { ...formData, confirm }
    if (!hasHrFields) for (const field of STAFF_HR_FIELDS) delete payload[field]

    try {
      setSaving(true)

      // Update staff profile
      const response = await fetch(`/api/staff/${resolvedParams.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        if (response.status === 409 && Array.isArray(error.appointments)) {
          setOpenDiary(error.appointments)
          return
        }
        if (error.code === 'STAFF_LIMIT') {
          toast({
            ...toastError('save the staff member', error.error),
            action: (
              <ToastAction altText="See plans" onClick={() => router.push('/pricing')}>
                See plans
              </ToastAction>
            ),
          })
          return
        }
        throw new Error(error.error || 'Failed to update staff member')
      }
      setOpenDiary(null)

      // Update shifts
      const activeShifts = shifts.filter((s) => s.isActive)
      const shiftsResponse = await fetch(`/api/staff/${resolvedParams.id}/shifts`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shifts: activeShifts }),
      })

      if (!shiftsResponse.ok) {
        console.error('Failed to update shifts')
      }

      toast(toastSuccess('Staff member saved', `${formData.firstName} ${formData.lastName}`.trim()))

      // Saved: leaving now is not leaving unsaved work.
      guard.reset()
      router.push(`/staff/${resolvedParams.id}`)
    } catch (error) {
      console.error('Error updating staff:', error)
      toast(toastError('save the staff member', error))
    } finally {
      setSaving(false)
    }
  }

  const back = (
    <BackLink
      trail={trail}
      fallback={`/staff/${resolvedParams.id}`}
      fallbackLabel={savedName ?? 'Staff member'}
    />
  )

  if (loading) return <PageSkeleton variant="form" />

  if (missing) {
    return (
      <EmptyState
        icon={UserX}
        title="Staff member not found"
        description="They may have been removed, or the link is wrong."
        actionLabel="Back to staff"
        actionHref="/staff"
      />
    )
  }

  if (failed) return <LoadFailed what="this staff member" onRetry={fetchStaff} />

  const canEditRole = (r: string) => r !== 'ADMIN' || canManageAdmins || formData.role === 'ADMIN'

  return (
    <div className="space-y-6">
      <PageHeader title="Edit staff member" description={savedName ?? undefined} back={back} />

      <form ref={guard} onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Basic Information */}
        <FormSection title="Basic information" description="Name and role details">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="First name" htmlFor="firstName" required error={errors.firstName}>
              {(control) => (
                <Input
                  {...control}
                  value={formData.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Last name" htmlFor="lastName" required error={errors.lastName}>
              {(control) => (
                <Input
                  {...control}
                  value={formData.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                />
              )}
            </FormField>

            <FormField
              label="Email"
              htmlFor="email"
              required
              error={errors.email}
              hint="Also their sign-in. Letters are stored in lower case."
              className="md:col-span-2"
            >
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                />
              )}
            </FormField>

            <FormField label="Role" htmlFor="role" required>
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
                    {ALL_ROLES.filter(canEditRole).map((r) => (
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

        {/* Sign-in: a new password and whether the account works at all, apart
            from the name and role so switching somebody off is not one field
            among many. */}
        <FormSection title="Sign-in and status" description="Password and account access">
          <div className="space-y-4">
            <FormField
              label="New password"
              htmlFor="newPassword"
              error={errors.newPassword}
              hint="Leave blank to keep the current one."
            >
              {(control) => (
                <div className="relative md:max-w-sm">
                  <Input
                    {...control}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={formData.newPassword}
                    onChange={(e) => handleChange('newPassword', e.target.value)}
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

            <div className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="isActive">Account status</Label>
                <p className="text-sm text-muted-foreground">
                  {formData.isActive ? 'Active — can sign in' : 'Inactive — cannot sign in'}
                </p>
              </div>
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => handleChange('isActive', checked)}
              />
            </div>
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

            {hasHrFields && (
              <>
                <div className="space-y-2 md:col-span-2 xl:col-span-3">
                  <Label htmlFor="address">Address</Label>
                  <Textarea
                    id="address"
                    value={formData.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => handleChange('city', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => handleChange('state', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postalCode">Postal code</Label>
                  <Input
                    id="postalCode"
                    value={formData.postalCode}
                    onChange={(e) => handleChange('postalCode', e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </FormSection>

        {/* Personal Details — CNIC, date of birth, NTN and emergency
            contact. Present only for `staff:hr` (finding 42). */}
        {hasHrFields && (
          <FormSection
            title="Personal details"
            description="Personal and identification information"
          >
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nationalTaxNo">National tax number (NTN)</Label>
                <Input
                  id="nationalTaxNo"
                  value={formData.nationalTaxNo}
                  onChange={(e) => handleChange('nationalTaxNo', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContact">Emergency contact</Label>
                <Input
                  id="emergencyContact"
                  value={formData.emergencyContact}
                  onChange={(e) => handleChange('emergencyContact', e.target.value)}
                />
              </div>
              <FormField
                label="Emergency phone"
                htmlFor="emergencyPhone"
                error={errors.emergencyPhone}
              >
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
        )}

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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="specialization">Specialization</Label>
              <Input
                id="specialization"
                value={formData.specialization}
                onChange={(e) => handleChange('specialization', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="licenseNumber">License number</Label>
              <Input
                id="licenseNumber"
                value={formData.licenseNumber}
                onChange={(e) => handleChange('licenseNumber', e.target.value)}
              />
            </div>
            {/* Correctable now (finding 47): the attendance register
                refuses every day before it, so a wrong one blocked
                back-filling. Moving it later is refused by the server
                while attendance is recorded before the new date. */}
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

        {/* Work Schedule */}
        <FormSection title="Work schedule" description="Configure weekly work hours">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shifts.map((shift, index) => (
              <div
                key={shift.dayOfWeek}
                className={`rounded-xl border p-4 transition-colors ${
                  shift.isActive ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Label htmlFor={`shift-${shift.dayOfWeek}`} className="font-semibold">
                    {dayNames[index]}
                  </Label>
                  <Switch
                    id={`shift-${shift.dayOfWeek}`}
                    checked={shift.isActive}
                    onCheckedChange={(checked) =>
                      handleShiftChange(shift.dayOfWeek, 'isActive', checked)
                    }
                  />
                </div>
                {shift.isActive ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`shift-${shift.dayOfWeek}-start`} className="text-xs">
                        Start
                      </Label>
                      <Input
                        id={`shift-${shift.dayOfWeek}-start`}
                        type="time"
                        value={shift.startTime}
                        onChange={(e) =>
                          handleShiftChange(shift.dayOfWeek, 'startTime', e.target.value)
                        }
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`shift-${shift.dayOfWeek}-end`} className="text-xs">
                        End
                      </Label>
                      <Input
                        id={`shift-${shift.dayOfWeek}-end`}
                        type="time"
                        value={shift.endTime}
                        onChange={(e) =>
                          handleShiftChange(shift.dayOfWeek, 'endTime', e.target.value)
                        }
                        className="h-9"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Day off</p>
                )}
              </div>
            ))}
          </div>
        </FormSection>

        {/* Save, pinned to the bottom while the form scrolls */}
        <FormActions>
          <Button variant="outline" type="button" asChild>
            <Link href={trail.back(`/staff/${resolvedParams.id}`)}>Cancel</Link>
          </Button>
          <SubmitButton busy={saving} busyLabel="Saving…" icon={Save}>
            Save changes
          </SubmitButton>
        </FormActions>
      </form>

      <OpenAppointmentsDialog
        open={openDiary !== null}
        onOpenChange={(open) => {
          if (!open) setOpenDiary(null)
        }}
        name={`${formData.firstName} ${formData.lastName}`.trim()}
        appointments={openDiary ?? []}
        busy={saving}
        onConfirm={() => save(true)}
        trail={trail}
      />
    </div>
  )
}
