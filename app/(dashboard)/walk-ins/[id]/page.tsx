'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormField } from '@/components/ui/form-field'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { PhoneInput } from '@/components/ui/phone-input'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { formatToken } from '@/lib/tokens'
import { splitName } from '@/lib/visitors'
import { formatPhone } from '@/lib/utils'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { AlertTriangle, Trash2, UserPlus } from 'lucide-react'
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
      const data = await readJson<{ patient: { id: string; patientId: string } }>(res)

      toast(
        toastSuccess(
          'Walk-in registered',
          `${form.firstName} ${form.lastName} is now ${data.patient.patientId}. Their visits came with them.`
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

  return (
    <div className="space-y-6 max-w-4xl">
      {ConfirmDialogComponent}
      <PageHeader
        title={visitor.name}
        back={<BackLink trail={trail} fallback="/walk-ins" fallbackLabel="Walk-ins" />}
        badges={
          visitor.convertedPatient ? (
            <Badge variant="outline">Registered</Badge>
          ) : visitor.discardedAt ? (
            <Badge variant="outline" className="text-muted-foreground">
              Discarded
            </Badge>
          ) : (
            <Badge>To decide</Badge>
          )
        }
        description={`${formatPhone(visitor.phone) || 'No phone number'} · first seen ${displayDate(visitor.createdAt)}`}
        actions={
          !decided && (
            <Button variant="outline" className="text-destructive" onClick={discard}>
              <Trash2 className="h-4 w-4 mr-2" />
              Discard
            </Button>
          )
        }
      />

      {visitor.convertedPatient && (
        <Card>
          <CardContent className="py-5 text-sm">
            Registered as{' '}
            <Link
              href={trail.to(`/patients/${visitor.convertedPatient.id}`)}
              className="font-medium hover:underline"
            >
              {visitor.convertedPatient.firstName} {visitor.convertedPatient.lastName} (
              {visitor.convertedPatient.patientId})
            </Link>
            {visitor.convertedBy ? ` by ${visitor.convertedBy.name}` : ''}.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visits</CardTitle>
          <CardDescription>
            These follow the patient record if this walk-in is registered.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Appointment</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Dentist</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visitor.appointments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    No visits recorded.
                  </TableCell>
                </TableRow>
              ) : (
                visitor.appointments.map((appointment) => (
                  <TableRow key={appointment.id}>
                    <TableCell>
                      <Link
                        href={trail.to(`/appointments/${appointment.id}`)}
                        className="hover:underline"
                      >
                        {appointment.appointmentNo}
                      </Link>
                    </TableCell>
                    <TableCell>{displayDateTime(appointment.startsAt)}</TableCell>
                    <TableCell>
                      {appointment.doctor
                        ? `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`
                        : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatToken(appointment.tokenNumber)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind="appointment" status={appointment.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!decided && (
        <form ref={formRef} onSubmit={convert} noValidate>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Register as a patient
              </CardTitle>
              <CardDescription>
                The name was split from what the desk typed. Correct it before saving — this becomes
                a permanent record.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="First name" required htmlFor="firstName" error={errors.firstName}>
                  {(control) => (
                    <Input
                      {...control}
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField label="Last name" required htmlFor="lastName" error={errors.lastName}>
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
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <SubmitButton busy={saving} busyLabel="Registering…" icon={UserPlus}>
                  Register and keep the visits
                </SubmitButton>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  )
}
