'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { FormField } from '@/components/ui/form-field'
import { PhoneInput } from '@/components/ui/phone-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { IconTooltip } from '@/components/ui/icon-action'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { Save, Upload, Trash2, Loader2, Copy } from 'lucide-react'
import { OnlineBookingCard } from '@/components/settings/online-booking-card'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const DAY_LABELS: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

/**
 * `lunch` is carried through but never edited here.
 *
 * `lib/working-hours.ts` reads a per-weekday `{ lunch: { start, end } }` out of
 * this column, and this screen used to parse the schedule without it and
 * re-serialise — so saving opening hours silently destroyed any lunch break
 * that was there, and the slot list quietly started offering midday. Nothing on
 * this screen sets it; the clinic-wide one is at Settings → Appointments. It is
 * preserved so that editing one thing does not delete another.
 */
type DaySchedule = {
  open: string
  close: string
  closed: boolean
  lunch?: { start: string; end: string }
}
type WeekSchedule = Record<string, DaySchedule>

const DEFAULT_SCHEDULE: WeekSchedule = {
  monday: { open: '09:00', close: '20:00', closed: false },
  tuesday: { open: '09:00', close: '20:00', closed: false },
  wednesday: { open: '09:00', close: '20:00', closed: false },
  thursday: { open: '09:00', close: '20:00', closed: false },
  friday: { open: '09:00', close: '20:00', closed: false },
  saturday: { open: '09:00', close: '14:00', closed: false },
  sunday: { open: '', close: '', closed: true },
}

function parseSchedule(raw: string | null | undefined): WeekSchedule {
  if (!raw) return { ...DEFAULT_SCHEDULE }
  try {
    const parsed = JSON.parse(raw)
    const schedule: WeekSchedule = {}
    for (const day of DAYS) {
      const d = parsed[day]
      if (d && d.open && d.close) {
        schedule[day] = {
          open: d.open,
          close: d.close,
          closed: false,
          ...(d.lunch?.start && d.lunch?.end ? { lunch: d.lunch } : {}),
        }
      } else {
        schedule[day] = { open: '', close: '', closed: true }
      }
    }
    return schedule
  } catch {
    return { ...DEFAULT_SCHEDULE }
  }
}

function serializeSchedule(schedule: WeekSchedule): string {
  const obj: Record<
    string,
    { open: string | null; close: string | null; lunch?: { start: string; end: string } }
  > = {}
  for (const day of DAYS) {
    const d = schedule[day]
    obj[day] = d.closed
      ? { open: null, close: null }
      : { open: d.open, close: d.close, ...(d.lunch ? { lunch: d.lunch } : {}) }
  }
  return JSON.stringify(obj)
}

type ClinicForm = {
  name: string
  tagline: string
  phone: string
  alternatePhone: string
  email: string
  website: string
  address: string
  city: string
  state: string
  postalCode: string
  registrationNo: string
  taxRegistrationNo: string
  nationalTaxNo: string
  workingHours: string
  bankName: string
  bankAccountNo: string
  bankIban: string
  mobileWalletId: string
}

/** The fields the clinic route refuses to save blank, in the order they appear. */
const REQUIRED: Array<[keyof ClinicForm, string]> = [
  ['name', 'Enter the clinic’s name.'],
  ['phone', 'Enter the clinic’s main phone number.'],
  ['address', 'Enter the street address.'],
  ['city', 'Enter the city.'],
  ['state', 'Enter the state or province.'],
  ['postalCode', 'Enter the postal code.'],
]

type FieldErrors = Partial<Record<keyof ClinicForm, string>>

export default function ClinicSettingsPage() {
  const { toast } = useToast()
  const trail = useTrail('Clinic information')
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const formRef = useFormGuard(saving)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [logo, setLogo] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [schedule, setSchedule] = useState<WeekSchedule>({ ...DEFAULT_SCHEDULE })
  const [patientPortalEnabled, setPatientPortalEnabled] = useState(false)

  // Form state
  const [formData, setFormData] = useState<ClinicForm>({
    name: '',
    tagline: '',
    phone: '',
    alternatePhone: '',
    email: '',
    website: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    registrationNo: '',
    taxRegistrationNo: '',
    nationalTaxNo: '',
    workingHours: '',
    bankName: '',
    bankAccountNo: '',
    bankIban: '',
    mobileWalletId: '',
  })

  const fetchClinicInfo = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const result = await readJson<{ success?: boolean; data?: Record<string, any> }>(
        await fetch('/api/settings/clinic')
      )

      if (result.success && result.data) {
        setLogo(result.data.logo || null)
        setSchedule(parseSchedule(result.data.workingHours))
        setPatientPortalEnabled(result.data.patientPortalEnabled || false)
        setFormData({
          name: result.data.name || '',
          tagline: result.data.tagline || '',
          phone: result.data.phone || '',
          alternatePhone: result.data.alternatePhone || '',
          email: result.data.email || '',
          website: result.data.website || '',
          address: result.data.address || '',
          city: result.data.city || '',
          state: result.data.state || '',
          postalCode: result.data.postalCode || '',
          registrationNo: result.data.registrationNo || '',
          taxRegistrationNo: result.data.taxRegistrationNo || '',
          nationalTaxNo: result.data.nationalTaxNo || '',
          workingHours: result.data.workingHours || '',
          bankName: result.data.bankName || '',
          bankAccountNo: result.data.bankAccountNo || '',
          bankIban: result.data.bankIban || '',
          mobileWalletId: result.data.mobileWalletId || '',
        })
      }
    } catch (error) {
      console.error('Failed to load clinic information:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading from the server on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchClinicInfo()
  }, [fetchClinicInfo])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingLogo(true)
    try {
      const fd = new FormData()
      fd.append('file', file)

      const result = await readJson<{ logo: string }>(
        await fetch('/api/settings/clinic/logo', { method: 'POST', body: fd })
      )

      setLogo(result.logo)
      toast(toastSuccess('Logo uploaded', 'It shows in the sidebar and on invoices.'))
    } catch (err) {
      toast(toastError('upload the logo', err))
    } finally {
      setUploadingLogo(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleLogoRemove = async () => {
    const ok = await confirm({
      title: 'Remove the clinic logo?',
      description:
        'The sidebar and new invoices show the clinic’s initial instead. You can upload a logo again at any time.',
      confirmLabel: 'Remove logo',
    })
    if (!ok) return

    setUploadingLogo(true)
    try {
      await readJson(await fetch('/api/settings/clinic/logo', { method: 'DELETE' }))

      setLogo(null)
      toast(toastSuccess('Logo removed'))
    } catch (err) {
      toast(toastError('remove the logo', err))
    } finally {
      setUploadingLogo(false)
    }
  }

  const updateDay = useCallback(
    (day: string, field: keyof DaySchedule, value: string | boolean) => {
      setSchedule((prev) => ({
        ...prev,
        [day]: { ...prev[day], [field]: value },
      }))
    },
    []
  )

  const copyToAll = useCallback((sourceDay: string) => {
    setSchedule((prev) => {
      const source = prev[sourceDay]
      const next: WeekSchedule = {}
      for (const day of DAYS) {
        next[day] = { ...source }
      }
      return next
    })
  }, [])

  const handleSave = async (event?: React.FormEvent) => {
    event?.preventDefault()

    const found: FieldErrors = {}
    for (const [field, message] of REQUIRED) {
      if (!formData[field].trim()) found[field] = message
    }
    setErrors(found)
    const first = REQUIRED.find(([field]) => found[field])
    if (first) {
      toast(toastError('save the clinic settings', 'Check the highlighted fields.'))
      const element = document.getElementById(first[0])
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element?.focus({ preventScroll: true })
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...formData,
        workingHours: serializeSchedule(schedule),
        patientPortalEnabled,
      }
      await readJson(
        await fetch('/api/settings/clinic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      )

      // The page stays put after a save, so the guard is told the work is safe.
      formRef.reset()
      toast(toastSuccess('Clinic settings saved'))
    } catch (error) {
      toast(toastError('save the clinic settings', error))
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (field: keyof ClinicForm, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const header = (
    <PageHeader
      back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
      title="Clinic information"
      description="Manage your clinic details and contact information"
    />
  )

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {loading ? (
        <PageSkeleton variant="form" />
      ) : failed ? (
        <>
          {header}
          <LoadFailed what="the clinic settings" onRetry={fetchClinicInfo} />
        </>
      ) : (
        <>
          {header}

          <form ref={formRef} className="space-y-6" onSubmit={handleSave} noValidate>
            {/* Clinic Logo */}
            <Card>
              <CardHeader>
                <CardTitle>Clinic logo</CardTitle>
                <CardDescription>
                  Upload your clinic logo to display in the sidebar and invoices
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  {/* Preview */}
                  {logo ? (
                    <img
                      src={logo}
                      alt="Clinic logo"
                      className="h-20 w-20 rounded-lg object-cover border"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-primary text-primary-foreground text-2xl font-bold border">
                      {formData.name?.charAt(0) || 'D'}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    {/* Uploads at once, so choosing a file is not unsaved work. */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                      onChange={handleLogoUpload}
                      className="hidden"
                      data-form-guard="ignore"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingLogo}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingLogo ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      {logo ? 'Change logo' : 'Upload logo'}
                    </Button>
                    {logo && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={uploadingLogo}
                        onClick={handleLogoRemove}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove logo
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      JPEG, PNG, WebP, GIF or SVG. Max 2 MB.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>Basic information</CardTitle>
                <CardDescription>Primary clinic details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    label="Clinic name"
                    htmlFor="name"
                    required
                    error={errors.name}
                    className="md:col-span-2"
                  >
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.name}
                        onChange={(e) => handleChange('name', e.target.value)}
                        placeholder="Your Dental Clinic"
                      />
                    )}
                  </FormField>

                  <FormField label="Tagline / motto" htmlFor="tagline" className="md:col-span-2">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.tagline}
                        onChange={(e) => handleChange('tagline', e.target.value)}
                        placeholder="Your Smile, Our Priority"
                      />
                    )}
                  </FormField>
                </div>
              </CardContent>
            </Card>

            {/* Contact Information */}
            <Card>
              <CardHeader>
                <CardTitle>Contact information</CardTitle>
                <CardDescription>How patients can reach you</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Primary phone" htmlFor="phone" required error={errors.phone}>
                    {(control) => (
                      <PhoneInput
                        {...control}
                        value={formData.phone}
                        onChange={(value) => handleChange('phone', value)}
                      />
                    )}
                  </FormField>

                  <FormField label="Alternate phone" htmlFor="alternatePhone">
                    {(control) => (
                      <PhoneInput
                        {...control}
                        value={formData.alternatePhone}
                        onChange={(value) => handleChange('alternatePhone', value)}
                      />
                    )}
                  </FormField>

                  <FormField label="Email" htmlFor="email">
                    {(control) => (
                      <Input
                        {...control}
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleChange('email', e.target.value)}
                        placeholder="info@yourclinic.com"
                      />
                    )}
                  </FormField>

                  <FormField label="Website" htmlFor="website">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.website}
                        onChange={(e) => handleChange('website', e.target.value)}
                        placeholder="https://www.yourclinic.com"
                      />
                    )}
                  </FormField>
                </div>
              </CardContent>
            </Card>

            {/* Address */}
            <Card>
              <CardHeader>
                <CardTitle>Address</CardTitle>
                <CardDescription>Clinic location details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField label="Street address" htmlFor="address" required error={errors.address}>
                  {(control) => (
                    <Textarea
                      {...control}
                      value={formData.address}
                      onChange={(e) => handleChange('address', e.target.value)}
                      placeholder="123, Main Street, Ayanavaram"
                      rows={2}
                    />
                  )}
                </FormField>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="City" htmlFor="city" required error={errors.city}>
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.city}
                        onChange={(e) => handleChange('city', e.target.value)}
                        placeholder="Lahore"
                      />
                    )}
                  </FormField>

                  <FormField label="State" htmlFor="state" required error={errors.state}>
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.state}
                        onChange={(e) => handleChange('state', e.target.value)}
                      />
                    )}
                  </FormField>

                  <FormField
                    label="Postal code"
                    htmlFor="postalCode"
                    required
                    error={errors.postalCode}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.postalCode}
                        onChange={(e) => handleChange('postalCode', e.target.value)}
                        placeholder="600023"
                      />
                    )}
                  </FormField>
                </div>
              </CardContent>
            </Card>

            {/* Registration & Tax */}
            <Card>
              <CardHeader>
                <CardTitle>Registration and tax information</CardTitle>
                <CardDescription>Legal and tax registration details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="Registration number" htmlFor="registrationNo">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.registrationNo}
                        onChange={(e) => handleChange('registrationNo', e.target.value)}
                        placeholder="REG123456"
                      />
                    )}
                  </FormField>

                  <FormField label="Sales tax registration (STRN)" htmlFor="taxRegistrationNo">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.taxRegistrationNo}
                        onChange={(e) => handleChange('taxRegistrationNo', e.target.value)}
                        placeholder="29XXXXX1234X1ZX"
                      />
                    )}
                  </FormField>

                  <FormField label="National tax number (NTN)" htmlFor="nationalTaxNo">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.nationalTaxNo}
                        onChange={(e) => handleChange('nationalTaxNo', e.target.value)}
                        placeholder="ABCDE1234F"
                      />
                    )}
                  </FormField>
                </div>
              </CardContent>
            </Card>

            {/* Working Hours */}
            <Card>
              <CardHeader>
                <CardTitle>Working hours</CardTitle>
                <CardDescription>Clinic operating schedule</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Header row */}
                <div className="hidden md:grid md:grid-cols-[140px_1fr_1fr_80px_40px] gap-3 items-center text-xs font-medium text-muted-foreground px-1">
                  <span>Day</span>
                  <span>Opens at</span>
                  <span>Closes at</span>
                  <span className="text-center">Open</span>
                  <span />
                </div>
                <Separator />
                {DAYS.map((day) => {
                  const d = schedule[day]
                  return (
                    <div
                      key={day}
                      className="grid grid-cols-1 md:grid-cols-[140px_1fr_1fr_80px_40px] gap-3 items-center"
                    >
                      <span className="text-sm font-medium">{DAY_LABELS[day]}</span>
                      <Input
                        type="time"
                        aria-label={`${DAY_LABELS[day]} opens at`}
                        value={d.closed ? '' : d.open}
                        disabled={d.closed}
                        onChange={(e) => updateDay(day, 'open', e.target.value)}
                        className={d.closed ? 'opacity-40' : ''}
                      />
                      <Input
                        type="time"
                        aria-label={`${DAY_LABELS[day]} closes at`}
                        value={d.closed ? '' : d.close}
                        disabled={d.closed}
                        onChange={(e) => updateDay(day, 'close', e.target.value)}
                        className={d.closed ? 'opacity-40' : ''}
                      />
                      <div className="flex justify-center">
                        <Switch
                          aria-label={`Open on ${DAY_LABELS[day]}`}
                          checked={!d.closed}
                          onCheckedChange={(checked) => updateDay(day, 'closed', !checked)}
                        />
                      </div>
                      <IconTooltip label="Copy to all days">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Copy ${DAY_LABELS[day]}’s hours to all days`}
                          onClick={() => copyToAll(day)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </IconTooltip>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {/* Bank Details */}
            <Card>
              <CardHeader>
                <CardTitle>Bank and payment details</CardTitle>
                <CardDescription>For invoicing and payment collection</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Bank name" htmlFor="bankName">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.bankName}
                        onChange={(e) => handleChange('bankName', e.target.value)}
                        placeholder="State Bank of India"
                      />
                    )}
                  </FormField>

                  <FormField label="Account number" htmlFor="bankAccountNo">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.bankAccountNo}
                        onChange={(e) => handleChange('bankAccountNo', e.target.value)}
                        placeholder="1234567890"
                      />
                    )}
                  </FormField>

                  <FormField label="IBAN" htmlFor="bankIban">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.bankIban}
                        onChange={(e) => handleChange('bankIban', e.target.value)}
                        placeholder="PK36SCBL0000001123456702"
                      />
                    )}
                  </FormField>

                  <FormField label="Mobile wallet" htmlFor="mobileWalletId">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.mobileWalletId}
                        onChange={(e) => handleChange('mobileWalletId', e.target.value)}
                        placeholder="JazzCash or Easypaisa number"
                      />
                    )}
                  </FormField>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <SubmitButton busy={saving} busyLabel="Saving…" icon={Save} size="lg">
                Save changes
              </SubmitButton>
            </div>
          </form>

          {/* Saves itself, and sits outside the form above: its fields are not
              this page's unsaved work, and its own Save does not send them. */}
          <OnlineBookingCard />
        </>
      )}
      {ConfirmDialogComponent}
    </div>
  )
}
