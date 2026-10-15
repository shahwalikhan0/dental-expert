'use client'

import { useState, useEffect, use } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/ui/form-field'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { SubmitButton } from '@/components/ui/submit-button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PatientSummaryCard } from '@/components/patients/patient-picker'
import { AlertTriangle, Calendar, Clock, User, Check, Loader2, Save } from 'lucide-react'
import { formatTime } from '@/lib/appointment-utils'
import { subjectName, subjectPhone } from '@/lib/visitors'
import { formatPhone } from '@/lib/utils'
import { toastError } from '@/lib/toast-utils'

/** The fields that can be missing on submit, each said under its own control. */
type FieldErrors = Partial<Record<'doctor' | 'date' | 'time', string>>

interface Doctor {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  specialization: string | null
}

interface Assistant {
  id: string
  firstName: string
  lastName: string
}

/** Radix `Select` cannot hold '', so "No assistant" needs a value of its own. */
const NO_ASSISTANT = 'none'

interface TimeSlot {
  time: string
  available: boolean
}

interface Appointment {
  id: string
  appointmentNo: string
  scheduledDate: string
  scheduledTime: string
  duration: number
  appointmentType: string
  status: string
  priority: string
  chiefComplaint: string | null
  notes: string | null
  patientId: string | null
  doctorId: string
  assistantId: string | null
  /** Null on a walk-in, which has a visitor instead. */
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
  } | null
  visitor: {
    id: string
    name: string
    phone: string | null
  } | null
  doctor: {
    id: string
    firstName: string
    lastName: string
  }
  assistant: Assistant | null
}

export default function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()

  const [loading, setLoading] = useState(true)
  // Could not be loaded, as opposed to not existing (a 404).
  const [failed, setFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [reload, setReload] = useState(0)
  const { toast } = useToast()

  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const trail = useTrail(appointment ? `Edit ${appointment.appointmentNo}` : null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  // Loaded on their own: the assistant is optional, so a slow or failed list
  // must not hold up the form or the save.
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [assistantsState, setAssistantsState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Form state
  const [selectedDoctor, setSelectedDoctor] = useState('')
  const [selectedAssistant, setSelectedAssistant] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [duration, setDuration] = useState('30')
  const [appointmentType, setAppointmentType] = useState('CONSULTATION')
  const [priority, setPriority] = useState('NORMAL')
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [notes, setNotes] = useState('')

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setFailed(false)
      try {
        const [appointmentRes, doctorsRes] = await Promise.all([
          fetch(`/api/appointments/${id}`),
          fetch('/api/staff/doctors'),
        ])

        if (appointmentRes.ok) {
          const data = await appointmentRes.json()
          setAppointment(data)
          // Set form values
          setSelectedDoctor(data.doctorId)
          setSelectedAssistant(data.assistantId ?? '')
          setSelectedDate(data.scheduledDate.slice(0, 10))
          setSelectedTime(data.scheduledTime)
          setDuration(data.duration.toString())
          setAppointmentType(data.appointmentType)
          setPriority(data.priority)
          setChiefComplaint(data.chiefComplaint || '')
          setNotes(data.notes || '')
        } else if (appointmentRes.status !== 404) {
          // A 404 is answered by the "not found" view below; anything else is
          // a failure, said on the page with a way to try again.
          setFailed(true)
        }

        if (doctorsRes.ok) {
          const data = await doctorsRes.json()
          setDoctors(data.doctors)
        }
      } catch (err) {
        console.error('Error fetching data:', err)
        setFailed(true)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [id, reload])

  useEffect(() => {
    let current = true
    fetch('/api/staff/assistants')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the assistants')
        const data = await response.json()
        if (!current) return
        setAssistants(data.assistants ?? [])
        setAssistantsState('ready')
      })
      .catch((err) => {
        console.error('Error fetching assistants:', err)
        if (current) setAssistantsState('failed')
      })
    return () => {
      current = false
    }
  }, [])

  /**
   * Who the picker offers, and who the save sends.
   *
   * The assistant already on the appointment is always an option, even when
   * the list no longer has them (deactivated since) or never arrived: the
   * form sends the assistant on every save, and an option missing from the
   * list would otherwise read as "No assistant" and take them off unasked.
   * The dentist chosen above is left out — one person cannot be both.
   */
  const assistantOptions = [
    ...assistants,
    ...(appointment?.assistant && !assistants.some((a) => a.id === appointment.assistant!.id)
      ? [appointment.assistant]
      : []),
  ].filter((a) => a.id !== selectedDoctor)
  const assistantId = assistantOptions.some((a) => a.id === selectedAssistant)
    ? selectedAssistant
    : ''

  // Fetch available time slots when doctor and date change
  useEffect(() => {
    const fetchSlots = async () => {
      if (!selectedDoctor || !selectedDate) {
        setTimeSlots([])
        return
      }

      setLoadingSlots(true)
      try {
        const response = await fetch(
          `/api/appointments/slots?doctorId=${selectedDoctor}&date=${selectedDate}&duration=${duration}`
        )

        if (response.ok) {
          const data = await response.json()
          if (data.available) {
            // Mark current time as available if it matches original appointment
            const slots = data.slots.map((slot: TimeSlot) => ({
              ...slot,
              available:
                slot.available ||
                (appointment &&
                  appointment.doctorId === selectedDoctor &&
                  appointment.scheduledDate.slice(0, 10) === selectedDate &&
                  slot.time === appointment.scheduledTime),
            }))
            setTimeSlots(slots)
          } else {
            setTimeSlots([])
          }
        }
      } catch (err) {
        console.error('Error fetching slots:', err)
      } finally {
        setLoadingSlots(false)
      }
    }

    fetchSlots()
  }, [selectedDoctor, selectedDate, duration, appointment])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Every missing field at once, under its own control, plus one toast.
    const found: FieldErrors = {}
    if (!selectedDoctor) found.doctor = 'Select a doctor'
    if (!selectedDate) found.date = 'Select a date'
    if (!selectedTime) found.time = 'Select a time slot'
    setErrors(found)
    const first = (['doctor', 'date', 'time'] as const).find((key) => found[key])
    if (first) {
      toast(toastError('save the appointment', 'Check the highlighted fields.'))
      document
        .getElementById(`appointment-${first}`)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: selectedDoctor,
          assistantId: assistantId || null,
          scheduledDate: selectedDate,
          scheduledTime: selectedTime,
          duration: parseInt(duration),
          appointmentType,
          priority,
          chiefComplaint: chiefComplaint || null,
          notes: notes || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update appointment')
      }

      router.push(trail.back(`/appointments/${id}`))
    } catch (err) {
      toast(toastError('save the appointment', err))
    } finally {
      setSubmitting(false)
    }
  }

  const back = (
    <BackLink
      trail={trail}
      fallback={`/appointments/${id}`}
      fallbackLabel={appointment?.appointmentNo ?? 'Appointment'}
    />
  )

  if (loading) return <PageSkeleton variant="form" />

  if (failed) {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this appointment" onRetry={() => setReload((n) => n + 1)} />
      </div>
    )
  }

  if (!appointment) {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState
          icon={AlertTriangle}
          title="Appointment not found"
          description="It may have been removed, or the link is wrong."
          actionLabel="Back to appointments"
          actionHref="/appointments"
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit appointment" description={appointment.appointmentNo} back={back} />

      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Patient Info (Read-only) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Patient
              </CardTitle>
              <CardDescription>
                Patient cannot be changed for an existing appointment
              </CardDescription>
            </CardHeader>
            <CardContent>
              {appointment.patient ? (
                // The chosen patient, drawn the one way — read-only here.
                <PatientSummaryCard patient={appointment.patient} />
              ) : (
                <div className="rounded-lg border p-4 bg-muted/50">
                  <p className="font-medium">{subjectName(appointment)}</p>
                  {/* A walk-in has no patient number to show — saying so is more
                      use than a blank line where one is expected. */}
                  <p className="text-sm text-muted-foreground">Walk-in, not registered</p>
                  <p className="text-sm text-muted-foreground">
                    {formatPhone(subjectPhone(appointment)) || '—'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Doctor & Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Schedule
              </CardTitle>
              <CardDescription>Update the doctor, assistant, date, or time</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Doctor" required htmlFor="appointment-doctor" error={errors.doctor}>
                {(control) => (
                  <Select
                    value={selectedDoctor}
                    onValueChange={(value) => {
                      setSelectedDoctor(value)
                      setErrors((prev) => ({ ...prev, doctor: undefined }))
                    }}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue placeholder="Select a doctor" />
                    </SelectTrigger>
                    <SelectContent>
                      {doctors.map((doctor) => (
                        <SelectItem key={doctor.id} value={doctor.id}>
                          Dr. {doctor.firstName} {doctor.lastName}
                          {doctor.specialization && ` (${doctor.specialization})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField
                label="Assisted by"
                htmlFor="appointment-assistant"
                hint={
                  assistantsState === 'failed'
                    ? "Couldn't load the assistants. The rest of the appointment can still be saved."
                    : 'Optional'
                }
              >
                {(control) => (
                  <Select
                    value={assistantId || NO_ASSISTANT}
                    // Radix reports '' when the value arrives in the same render as its
                    // option (the list loading with an assistant already chosen), which
                    // would quietly drop them. "No assistant" has a value of its own,
                    // so '' is never a choice somebody made.
                    onValueChange={(value) => {
                      if (value) setSelectedAssistant(value === NO_ASSISTANT ? '' : value)
                    }}
                    disabled={assistantsState !== 'ready'}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ASSISTANT}>No assistant</SelectItem>
                      {assistantOptions.map((assistant) => (
                        <SelectItem key={assistant.id} value={assistant.id}>
                          {assistant.firstName} {assistant.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Date" required htmlFor="appointment-date" error={errors.date}>
                  {(control) => (
                    <Input
                      {...control}
                      type="date"
                      value={selectedDate}
                      onChange={(e) => {
                        setSelectedDate(e.target.value)
                        setSelectedTime('')
                        setErrors((prev) => ({ ...prev, date: undefined }))
                      }}
                    />
                  )}
                </FormField>
                <div className="space-y-2">
                  <Label htmlFor="appointment-duration">Duration</Label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger id="appointment-duration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="45">45 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="90">1.5 hours</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Time Slots */}
              <div
                className="space-y-2"
                id="appointment-time"
                role="group"
                aria-labelledby="appointment-time-label"
              >
                <p id="appointment-time-label" className="label-required text-sm font-medium">
                  Time slot
                </p>
                {loadingSlots ? (
                  <div className="flex items-center gap-2 p-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading available slots…
                  </div>
                ) : timeSlots.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    No available slots for this date
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {timeSlots.map((slot) => (
                      <Button
                        key={slot.time}
                        type="button"
                        variant={selectedTime === slot.time ? 'default' : 'outline'}
                        size="sm"
                        disabled={!slot.available}
                        className={
                          !slot.available
                            ? 'cursor-not-allowed opacity-50'
                            : selectedTime === slot.time
                              ? ''
                              : 'hover:bg-primary/10'
                        }
                        onClick={() => {
                          setSelectedTime(slot.time)
                          setErrors((prev) => ({ ...prev, time: undefined }))
                        }}
                      >
                        {selectedTime === slot.time && <Check className="mr-1 h-3 w-3" />}
                        {formatTime(slot.time)}
                      </Button>
                    ))}
                  </div>
                )}
                {errors.time && <p className="text-sm text-destructive">{errors.time}</p>}
              </div>
            </CardContent>
          </Card>

          {/* Appointment Details */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Appointment details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="appointment-type">Appointment type</Label>
                  <Select value={appointmentType} onValueChange={setAppointmentType}>
                    <SelectTrigger id="appointment-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CONSULTATION">Consultation</SelectItem>
                      <SelectItem value="PROCEDURE">Procedure</SelectItem>
                      <SelectItem value="FOLLOW_UP">Follow-up</SelectItem>
                      <SelectItem value="EMERGENCY">Emergency</SelectItem>
                      <SelectItem value="CHECK_UP">Check-up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="appointment-priority">Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger id="appointment-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="URGENT">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-3">
                  <Label htmlFor="appointment-complaint">Chief complaint</Label>
                  <Input
                    id="appointment-complaint"
                    placeholder="Patient's main concern or reason for visit"
                    value={chiefComplaint}
                    onChange={(e) => setChiefComplaint(e.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-3">
                  <Label htmlFor="appointment-notes">Notes</Label>
                  <Input
                    id="appointment-notes"
                    placeholder="Additional notes about the appointment"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 flex justify-end gap-4">
          <Button type="button" variant="outline" asChild>
            <Link href={trail.back(`/appointments/${id}`)}>Cancel</Link>
          </Button>
          <SubmitButton busy={submitting} icon={Save}>
            Save changes
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}
