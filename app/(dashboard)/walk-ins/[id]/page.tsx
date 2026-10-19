'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormField } from '@/components/ui/form-field'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { PhoneInput } from '@/components/ui/phone-input'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import { DuplicateDetector } from '@/components/patients/duplicate-detector'
import { useCan } from '@/hooks/use-can'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { formatToken } from '@/lib/tokens'
import { splitName } from '@/lib/visitors'
import { formatPhone } from '@/lib/utils'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { AlertTriangle, Calendar, Clock, Phone, Trash2, UserCheck, UserPlus } from 'lucide-react'
import { displayDate, displayDateTime } from '@/lib/dates'

type FieldErrors = Partial<Record<'firstName' | 'lastName' | 'phone', string>>

/**
 * One walk-in, and the decision about them.
 *
 * Converting shows the guessed name split for correction before it commits.
 * "Muhammad Ali Khan" splits wrong often enough that committing the guess
 * silently would put the wrong thing in the surname column of a permanent
 * record.
 */

interface Visitor {
  id: string
  name: string
  phone: string | null
  notes: string | null
  createdAt: string
  convertedAt: string | null
  discardedAt: string | null
  convertedPatient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
  } | null
  convertedBy: { id: string; name: string } | null
  discardedBy: { id: string; name: string } | null
  appointments: {
    id: string
    appointmentNo: string
    startsAt: string
    status: string
    tokenNumber: string | null
    doctor: { firstName: string; lastName: string } | null
  }[]
}

const GENDERS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
]

export default function WalkInPage() {
  const router = useRouter()
  const params = useParams()
  const visitorId = params.id as string
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  // Discard goes with the appointment book that made the walk-in; Register
  // makes a patient record. Each is offered only to whoever the server allows.
  const canDiscard = useCan('appointments:write') === true
  const canRegister = useCan('patients:write') === true

  const [visitor, setVisitor] = useState<Visitor | null>(null)
  const [loading, setLoading] = useState(true)
  // Could not be loaded, as opposed to not existing (a 404).
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  // Warn before a half-typed registration is thrown away by a stray click.
  const formRef = useFormGuard(saving)
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    dateOfBirth: '',
    gender: '',
    city: '',
  })

  const trail = useTrail(visitor?.name ?? null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setFailed(false)
      try {
        const res = await fetch(`/api/visitors/${visitorId}`)
        if (res.status === 404) {
          setVisitor(null)
          return
        }
        const data = await readJson<{ visitor: Visitor }>(res)

        setVisitor(data.visitor)
        const guessed = splitName(data.visitor.name)
        setForm((current) => ({
          ...current,
          firstName: guessed.firstName,
          lastName: guessed.lastName,
          phone: data.visitor.phone ?? '',
        }))
      } catch (err) {
        console.error('Error fetching walk-in:', err)
        setFailed(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [visitorId, reload])

  const convert = async (event: React.FormEvent) => {
    event.preventDefault()

    // A patient record needs a first name, a last name and a phone number.
    const found: FieldErrors = {}
    if (!form.firstName.trim()) found.firstName = 'Enter a first name'
    if (!form.lastName.trim()) found.lastName = 'Enter a last name'
    if (!form.phone.trim()) found.phone = 'Enter a phone number'
    setErrors(found)
    const first = (['firstName', 'lastName', 'phone'] as const).find((key) => found[key])
    if (first) {
      toast(toastError('register the walk-in', 'Check the highlighted fields.'))
      document.getElementById(first)?.focus()
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/visitors/${visitorId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          dateOfBirth: form.dateOfBirth || null,
          gender: form.gender || null,
        }),
      })
      const data = await readJson<{
        patient: { id: string; patientId: string }
        sharedPhoneWith?: { id: string; patientId: string; name: string }
      }>(res)

      // A shared phone is allowed, as it is at registration, but the desk is
      // told whose it is — the family can be linked from the new record.
      const shared = data.sharedPhoneWith
        ? ` This phone number is also ${data.sharedPhoneWith.name}'s (${data.sharedPhoneWith.patientId}); link them under Family if they share an account.`
        : ''
      toast(
        toastSuccess(
          'Walk-in registered',
          `${form.firstName} ${form.lastName} is now ${data.patient.patientId}. Their visits came with them.${shared}`
        )
      )
      router.push(`/patients/${data.patient.id}`)
    } catch (err) {
      toast(toastError('register the walk-in', err))
    } finally {
      setSaving(false)
    }
  }

  const discard = async () => {
    const ok = await confirm({
      title: `Discard ${visitor?.name}?`,
      description:
        'Their visits stay on the record. They will not appear in the list of walk-ins to decide on.',
      confirmLabel: 'Discard walk-in',
    })
    if (!ok) return

    try {
      const data = await readJson<{ message?: string }>(
        await fetch(`/api/visitors/${visitorId}`, { method: 'DELETE' })
      )

      toast(toastSuccess('Walk-in discarded', data.message))
      router.push(trail.back('/walk-ins'))
    } catch (err) {
      toast(toastError(`discard ${visitor?.name ?? 'the walk-in'}`, err))
    }
  }

  if (loading && !visitor) return <PageSkeleton variant="detail" />

  if (failed) {
    return (
      <div className="space-y-4">
        <BackLink trail={trail} fallback="/walk-ins" fallbackLabel="Walk-ins" />
        <LoadFailed what="this walk-in" onRetry={() => setReload((n) => n + 1)} />
      </div>
    )
  }

  if (!visitor) {
    return (
      <div className="space-y-4">
        <BackLink trail={trail} fallback="/walk-ins" fallbackLabel="Walk-ins" />
        <EmptyState
          icon={AlertTriangle}
          title="Walk-in not found"
          description="That walk-in could not be found. It may have been removed, or the link is wrong."
          actionLabel="Back to walk-ins"
          actionHref="/walk-ins"
        />
      </div>
    )
  }

  const decided = Boolean(visitor.convertedAt || visitor.discardedAt)
  const words = visitor.name.trim().split(/\s+/).filter(Boolean)
  const initials =
    `${words[0]?.charAt(0) ?? '?'}${words.length > 1 ? words[words.length - 1].charAt(0) : ''}`.toUpperCase()

  return (
    <div className="space-y-6">
      {ConfirmDialogComponent}

      {/*
        The walk-in as a profile: who, how to reach them, when they were first
        seen. Discarding is the rarer, final half of the decision, so it sits
        behind "More"; registering is the form below, where the name is checked
        before it becomes a permanent record.
      */}
      <ProfileHeader
        eyebrow="Walk-in"
        name={visitor.name}
        initials={initials}
        badges={
          visitor.convertedPatient ? (
            <Badge variant="success">Registered</Badge>
          ) : visitor.discardedAt ? (
            <Badge variant="secondary">Discarded</Badge>
          ) : (
            <Badge variant="warning">To decide</Badge>
          )
        }
        facts={[
          { icon: Phone, label: formatPhone(visitor.phone) || 'No phone number' },
          { icon: Clock, label: `First seen ${displayDate(visitor.createdAt)}` },
          {
            icon: Calendar,
            label: `${visitor.appointments.length} visit${visitor.appointments.length === 1 ? '' : 's'}`,
          },
        ]}
        menu={
          !decided && canDiscard
            ? [{ label: 'Discard walk-in', icon: Trash2, onSelect: discard, destructive: true }]
            : []
        }
      />

      {visitor.convertedPatient && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600/10">
            <UserCheck className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 self-center">
            Registered as{' '}
            <Link
              href={trail.to(`/patients/${visitor.convertedPatient.id}`)}
              className="font-semibold underline underline-offset-2"
            >
              {visitor.convertedPatient.firstName} {visitor.convertedPatient.lastName} (
              {visitor.convertedPatient.patientId})
            </Link>
            {visitor.convertedBy ? ` by ${visitor.convertedBy.name}` : ''}.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {!decided && canRegister && (
            <form ref={formRef} onSubmit={convert} noValidate>
              <Card>
                <CardHeader>
                  <CardTitle>Register as a patient</CardTitle>
                  <CardDescription>
                    The name was split from what the desk typed. Correct it before saving — this
                    becomes a permanent record.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      label="First name"
                      required
                      htmlFor="firstName"
                      error={errors.firstName}
                    >
                      {(control) => (
                        <Input
                          {...control}
                          value={form.firstName}
                          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                        />
                      )}
                    </FormField>
                    <FormField
                      label="Last name"
                      required
                      htmlFor="lastName"
                      error={errors.lastName}
                    >
                      {(control) => (
                        <Input
                          {...control}
                          value={form.lastName}
                          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                        />
                      )}
                    </FormField>
                    <FormField label="Phone" required htmlFor="phone" error={errors.phone}>
                      {(control) => (
                        <PhoneInput
                          {...control}
                          value={form.phone}
                          onChange={(phone) => setForm((current) => ({ ...current, phone }))}
                        />
                      )}
                    </FormField>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dateOfBirth">Date of birth</Label>
                      <Input
                        id="dateOfBirth"
                        type="date"
                        value={form.dateOfBirth}
                        onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gender">Gender</Label>
                      <Select
                        value={form.gender}
                        onValueChange={(value) => setForm({ ...form, gender: value })}
                      >
                        <SelectTrigger id="gender">
                          <SelectValue placeholder="Not recorded" />
                        </SelectTrigger>
                        <SelectContent>
                          {GENDERS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={form.city}
                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* The same soft check registration runs: a shared phone or a
                      returning patient is shown, not refused. */}
                  <DuplicateDetector
                    firstName={form.firstName}
                    lastName={form.lastName}
                    phone={form.phone}
                    email={form.email}
                    dateOfBirth={form.dateOfBirth}
                    onSelect={(existingId) => router.push(trail.to(`/patients/${existingId}`))}
                  />

                  <div className="flex justify-end border-t border-border pt-4">
                    <SubmitButton busy={saving} busyLabel="Registering…" icon={UserPlus}>
                      Register and keep the visits
                    </SubmitButton>
                  </div>
                </CardContent>
              </Card>
            </form>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Visits</CardTitle>
              <CardDescription>
                These follow the patient record if this walk-in is registered.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {visitor.appointments.length === 0 ? (
                <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                  No visits recorded.
                </p>
              ) : (
                <LinkList>
                  {visitor.appointments.map((appointment) => (
                    <LinkRow
                      key={appointment.id}
                      href={trail.to(`/appointments/${appointment.id}`)}
                      icon={Calendar}
                      title={
                        appointment.tokenNumber
                          ? `${appointment.appointmentNo} · Token ${formatToken(appointment.tokenNumber)}`
                          : appointment.appointmentNo
                      }
                      subtitle={[
                        displayDateTime(appointment.startsAt),
                        appointment.doctor
                          ? `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      trailing={<StatusBadge kind="appointment" status={appointment.status} />}
                    />
                  ))}
                </LinkList>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Phone" icon={Phone}>
                  {formatPhone(visitor.phone) || null}
                </InfoItem>
                <InfoItem label="First seen" icon={Clock}>
                  {displayDateTime(visitor.createdAt)}
                </InfoItem>
                {visitor.notes && (
                  <InfoItem label="Notes">
                    <span className="whitespace-pre-wrap font-normal">{visitor.notes}</span>
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          {/* What became of them, and who decided — a clinic that saw somebody
              should be able to say afterwards. */}
          {decided && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Outcome</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid className="sm:grid-cols-1">
                  {visitor.convertedAt ? (
                    <>
                      <InfoItem label="Registered">{displayDateTime(visitor.convertedAt)}</InfoItem>
                      <InfoItem label="Registered by">{visitor.convertedBy?.name}</InfoItem>
                    </>
                  ) : (
                    visitor.discardedAt && (
                      <>
                        <InfoItem label="Discarded">
                          {displayDateTime(visitor.discardedAt)}
                        </InfoItem>
                        <InfoItem label="Discarded by">{visitor.discardedBy?.name}</InfoItem>
                      </>
                    )
                  )}
                </InfoGrid>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
