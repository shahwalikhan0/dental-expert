'use client'

import { useState, useEffect } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { PhoneInput } from '@/components/ui/phone-input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SubmitButton } from '@/components/ui/submit-button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PatientPicker } from '@/components/patients/patient-picker'
import { Calendar, Clock, User, Check, Loader2 } from 'lucide-react'
import { formatTime } from '@/lib/appointment-utils'
import { isoDay } from '@/lib/dates'
import { toastError } from '@/lib/toast-utils'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  email: string | null
}

interface Doctor {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  specialization: string | null
}

interface TimeSlot {
  time: string
  available: boolean
}

/** The fields that can be missing on submit, each said under its own control. */
type FieldErrors = Partial<Record<'patient' | 'visitorName' | 'doctor' | 'date' | 'time', string>>

const PATIENT_MODES = [
  { value: 'registered', label: 'Registered patient' },
  { value: 'walk-in', label: 'Walk-in' },
] as const

export default function NewAppointmentPage() {
  const router = useRouter()
  const trail = useTrail('New appointment')
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const searchParams = useSearchParams()
  const preselectedPatientId = searchParams.get('patientId')

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()
  // Shown in the slot list rather than as a toast: why a day has no times is a
  // statement about the diary, not a complaint about the form, and it clears
  // on its own when the next day is picked.
  const [slotsError, setSlotsError] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})

  // Data
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Form state
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  // Clicking an empty slot in the book arrives here with the dentist, the day
  // and the time already chosen. That is the whole point of the book: booking
  // should be one click and a name, not a form with four dropdowns.
  const [selectedDoctor, setSelectedDoctor] = useState(searchParams.get('doctorId') ?? '')
  // A follow-up booked from a treatment arrives with the date it is due, so
  // the day is already chosen and the slot list loads without a second step.
  const [selectedDate, setSelectedDate] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date') ?? '') ? searchParams.get('date')! : ''
  )
  const [selectedTime, setSelectedTime] = useState(
    /^\d{2}:\d{2}$/.test(searchParams.get('time') ?? '') ? searchParams.get('time')! : ''
  )
  const [duration, setDuration] = useState('30')
  const [appointmentType, setAppointmentType] = useState('CONSULTATION')
  const [priority, setPriority] = useState('NORMAL')
  // Booking a walk-in. The front desk should not have to invent a patient
  // record for somebody who may never come back — see lib/visitors.ts.
  const [isWalkIn, setIsWalkIn] = useState(searchParams.get('walkIn') === '1')
  const [visitorName, setVisitorName] = useState('')
  const [visitorPhone, setVisitorPhone] = useState('')
  // Why the visit was arranged, when the screen that sent us here knows. The
  // recall list knows: "6 month check-up" is the whole reason the row existed,
  // and retyping it is the sort of thing that quietly does not get done.
  const [chiefComplaint, setChiefComplaint] = useState(
    (searchParams.get('reason') ?? '').slice(0, 200)
  )
  const [notes, setNotes] = useState('')

  /**
   * The dentists.
   *
   * The patient a link handed over (`?patientId=` — the recall list's Book, a
   * patient's own record) is fetched by `PatientPicker` itself through
   * `initialPatientId`, so arriving with a patient chosen still does not ask
   * the receptionist to search for the name they just clicked. The register
   * is searched on the server, never downloaded whole.
   */
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const doctorsRes = await fetch('/api/staff/doctors')
        if (doctorsRes.ok) {
          const data = await doctorsRes.json()
          setDoctors(data.doctors)
        }
      } catch (err) {
        console.error('Error fetching data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  /**
   * The times this dentist has free on this day, for an appointment this long.
   *
   * Three things here used to go wrong, all of them ending with the form
   * showing times that were not on offer:
   *
   * - A time chosen before the dentist or the duration changed stayed chosen.
   *   Picking 10:00 for one dentist and then switching to another who is busy
   *   at ten left "10:00" selected and submittable.
   * - A failed request left the previous day's slots on screen. Nothing said
   *   so, and every one of them was bookable.
   * - "No slots available" was set and never cleared, so it survived onto the
   *   next date the receptionist tried.
   */
  useEffect(() => {
    let current = true

    const fetchSlots = async () => {
      // Anything already chosen belongs to the previous question.
      setSelectedTime('')
      setSlotsError('')

      if (!selectedDoctor || !selectedDate) {
        setTimeSlots([])
        return
      }

      setLoadingSlots(true)
      try {
        const response = await fetch(
          `/api/appointments/slots?doctorId=${selectedDoctor}&date=${selectedDate}&duration=${duration}`
        )
        if (!current) return

        if (!response.ok) {
          setTimeSlots([])
          setSlotsError('Those times could not be loaded. Try again.')
          toast(toastError('load the available times'))
          return
        }

        const data = await response.json()
        if (!current) return

        if (data.available) {
          setTimeSlots(data.slots)
        } else {
          setTimeSlots([])
          setSlotsError(data.reason || 'No slots available')
        }
      } catch (err) {
        console.error('Error fetching slots:', err)
        if (!current) return
        setTimeSlots([])
        setSlotsError('Those times could not be loaded. Try again.')
        toast(toastError('load the available times', err))
      } finally {
        if (current) setLoadingSlots(false)
      }
    }

    fetchSlots()
    return () => {
      current = false
    }
  }, [selectedDoctor, selectedDate, duration, toast])

  const clearError = (key: keyof FieldErrors) =>
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Every missing field at once, each under its own control, plus one
    // summary toast — rather than one toast per attempt naming only the first.
    const found: FieldErrors = {}
    if (isWalkIn) {
      if (visitorName.trim().length < 2) found.visitorName = 'A walk-in needs a name'
    } else if (!selectedPatient) {
      found.patient = 'Select a patient'
    }
    if (!selectedDoctor) found.doctor = 'Select a doctor'
    if (!selectedDate) found.date = 'Select a date'
    if (!selectedTime) found.time = 'Select a time slot'

    setErrors(found)
    const first = (['patient', 'visitorName', 'doctor', 'date', 'time'] as const).find(
      (key) => found[key]
    )
    if (first) {
      toast(toastError('book the appointment', 'Check the highlighted fields.'))
      document
        .getElementById(`appointment-${first}`)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isWalkIn
            ? { visitor: { name: visitorName.trim(), phone: visitorPhone.trim() || null } }
            : { patientId: selectedPatient!.id }),
          doctorId: selectedDoctor,
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
        throw new Error(data.error || 'Failed to create appointment')
      }

      router.push('/appointments')
    } catch (err) {
      toast(toastError('book the appointment', err))
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * The earliest day this form will accept.
   *
   * `toISOString` answers in UTC, which is not the day anybody at the desk is
   * having. In Pakistan that is yesterday until five in the morning, so a
   * clinic working an early shift could book into a day that had already gone;
   * west of Greenwich the same line refuses to book the evening that is
   * happening. The server decides "now" in the clinic's own timezone, and this
   * agrees with it.
   */
  const getMinDate = () => isoDay(new Date())

  if (loading) return <PageSkeleton variant="form" />

  return (
    <div className="space-y-6">
      <PageHeader
        title="New appointment"
        description="Schedule a new appointment for a patient"
        back={<BackLink trail={trail} fallback="/appointments" fallbackLabel="Appointments" />}
      />

      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Patient Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Patient
              </CardTitle>
              <CardDescription>
                A registered patient, or a walk-in the clinic has not registered yet
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Two ways in, because a clinic sees both kinds of person and
                  should not have to open a patient record to see the second. */}
              <SegmentedControl
                aria-label="Who the appointment is for"
                size="md"
                value={isWalkIn ? 'walk-in' : 'registered'}
                onChange={(mode) => {
                  const walkIn = mode === 'walk-in'
                  setIsWalkIn(walkIn)
                  if (walkIn) setSelectedPatient(null)
                  setErrors((prev) => ({ ...prev, patient: undefined, visitorName: undefined }))
                }}
                options={PATIENT_MODES}
              />

              {isWalkIn ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Name"
                    required
                    htmlFor="appointment-visitorName"
                    error={errors.visitorName}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        value={visitorName}
                        onChange={(e) => {
                          setVisitorName(e.target.value)
                          clearError('visitorName')
                        }}
                        placeholder="What they gave at the desk"
                      />
                    )}
                  </FormField>
                  <FormField label="Phone" htmlFor="appointment-visitorPhone" hint="Optional">
                    {(control) => (
                      <PhoneInput {...control} value={visitorPhone} onChange={setVisitorPhone} />
                    )}
                  </FormField>
                  <p className="sm:col-span-2 text-xs text-muted-foreground">
                    No patient record is created. Register them later from Walk-ins if they come
                    back, and this visit will follow them.
                  </p>
                </div>
              ) : (
                <FormField
                  label="Patient"
                  required
                  htmlFor="appointment-patient"
                  error={errors.patient}
                >
                  {(control) => (
                    <PatientPicker<Patient>
                      id={control.id}
                      aria-describedby={control['aria-describedby']}
                      aria-invalid={control['aria-invalid']}
                      value={selectedPatient}
                      onChange={(patient) => {
                        setSelectedPatient(patient)
                        if (patient) clearError('patient')
                      }}
                      initialPatientId={preselectedPatientId}
                      allowAdd
                    />
                  )}
                </FormField>
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
              <CardDescription>Select doctor, date, and time for the appointment</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Doctor" required htmlFor="appointment-doctor" error={errors.doctor}>
                {(control) => (
                  <Select
                    value={selectedDoctor}
                    onValueChange={(id) => {
                      setSelectedDoctor(id)
                      clearError('doctor')
                    }}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue placeholder="Choose a doctor" />
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
                        clearError('date')
                      }}
                      min={getMinDate()}
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
                ) : !selectedDoctor || !selectedDate ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Select doctor and date to see available slots
                  </p>
                ) : slotsError ? (
                  <p className="p-4 text-sm text-muted-foreground">{slotsError}</p>
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
                          clearError('time')
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
              <CardDescription>Additional information about the appointment</CardDescription>
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
            <Link href="/appointments">Cancel</Link>
          </Button>
          <SubmitButton busy={submitting} busyLabel="Booking…" icon={Calendar}>
            Book appointment
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}
