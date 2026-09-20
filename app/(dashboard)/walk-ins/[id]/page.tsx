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
import { useToast } from '@/hooks/use-toast'
import { formatToken } from '@/lib/tokens'
import { splitName } from '@/lib/visitors'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { displayDate, displayDateTime } from '@/lib/dates'

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
  const [saving, setSaving] = useState(false)
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
      try {
        const res = await fetch(`/api/visitors/${visitorId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'That walk-in could not be found')

        setVisitor(data.visitor)
        const guessed = splitName(data.visitor.name)
        setForm((current) => ({
          ...current,
          firstName: guessed.firstName,
          lastName: guessed.lastName,
          phone: data.visitor.phone ?? '',
        }))
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to load the walk-in',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [visitorId, toast])

  const convert = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim()) {
      toast({
        title: 'Not enough to register somebody',
        description: 'A patient record needs a first name, a last name and a phone number.',
        variant: 'destructive',
      })
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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not register this walk-in')

      toast({
        title: 'Registered',
        description: `${form.firstName} ${form.lastName} is now ${data.patient.patientId}. Their visits came with them.`,
      })
      router.push(`/patients/${data.patient.id}`)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Could not register this walk-in',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const discard = async () => {
    const ok = await confirm({
      title: `Discard ${visitor?.name}?`,
      description:
        'Their visits stay on the record. They will not appear in the list of walk-ins to decide on.',
      confirmLabel: 'Discard',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/visitors/${visitorId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not discard this walk-in')

      toast({ title: 'Discarded', description: data.message })
      router.push('/walk-ins')
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Could not discard this walk-in',
        variant: 'destructive',
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!visitor) {
    return (
      <div className="space-y-4">
        <BackLink trail={trail} fallback="/walk-ins" fallbackLabel="Walk-ins" />
        <p className="text-sm text-muted-foreground">That walk-in could not be found.</p>
      </div>
    )
  }

  const decided = Boolean(visitor.convertedAt || visitor.discardedAt)

  return (
    <div className="space-y-6 max-w-4xl">
      {ConfirmDialogComponent}
      <BackLink trail={trail} fallback="/walk-ins" fallbackLabel="Walk-ins" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{visitor.name}</h1>
            {visitor.convertedPatient ? (
              <Badge variant="outline">Registered</Badge>
            ) : visitor.discardedAt ? (
              <Badge variant="outline" className="text-muted-foreground">
                Discarded
              </Badge>
            ) : (
              <Badge>To decide</Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            {visitor.phone || 'No phone number'} · first seen {displayDate(visitor.createdAt)}
          </p>
        </div>
        {!decided && (
          <Button variant="outline" className="text-red-600" onClick={discard}>
            <Trash2 className="h-4 w-4 mr-2" />
            Discard
          </Button>
        )}
      </div>

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
                      <Badge variant="outline">
                        {appointment.status.toLowerCase().replace('_', ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!decided && (
        <form onSubmit={convert}>
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
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name *</Label>
                  <Input
                    id="firstName"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name *</Label>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone *</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
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
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4 mr-2" />
                  )}
                  Register and keep the visits
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  )
}
