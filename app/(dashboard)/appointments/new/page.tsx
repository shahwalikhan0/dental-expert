'use client'

import { useState, useEffect, useRef } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormActions, FormSection } from '@/components/ui/form-section'
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
import { Calendar, Check, Loader2 } from 'lucide-react'
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
  // Opened from the waitlist's Book action: the entry is closed by the booking.
  const waitlistId = searchParams.get('waitlistId')

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
  // Loaded on their own, after the dentists: the assistant is optional, so a
  // slow or failed list must not hold up the form or the booking.
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [assistantsState, setAssistantsState] = useState<'loading' | 'ready' | 'failed'>('loading')
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
  const [selectedTime, setSelectedTime] = useState('')
  /**
   * The time a link handed over, held until the dentist's slots arrive.
   *
   * It used to go straight into `selectedTime`, and the slot loader below —
   * which clears the time whenever the question changes — cleared it on its
   * first run, so a slot clicked in the book arrived with the dentist and the
   * day but no time. It is chosen now once the slots are back, and only if
   * that time is one of them and still free.
   */
  const handedTime = useRef(
    /^\d{2}:\d{2}$/.test(searchParams.get('time') ?? '') ? searchParams.get('time') : null
  )
  // A free slot linked from the dashboard carries the assistant who is free
  // in it as well. Only sent if the list below actually offers them.
  const [selectedAssistant, setSelectedAssistant] = useState(searchParams.get('assistantId') ?? '')
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
   * The assistant this booking will actually carry: the one chosen, if the
   * list offers them and they are not the dentist chosen above. An id from a
   * link that is not on the list (or a list that never loaded) books with no
   * assistant rather than being refused, and the picker shows exactly that.
   */
  const assistantOptions = assistants.filter((a) => a.id !== selectedDoctor)
  const assistantId = assistantOptions.some((a) => a.id === selectedAssistant)
    ? selectedAssistant
    : ''

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
          // A time handed over by a link is offered once, on the first slots
          // to arrive; after that the receptionist is choosing.
          const wanted = handedTime.current
          handedTime.current = null
          if (wanted && data.slots.some((s: TimeSlot) => s.time === wanted && s.available)) {
            setSelectedTime(wanted)
          }
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
          assistantId: assistantId || null,
          scheduledDate: selectedDate,
          scheduledTime: selectedTime,
          duration: parseInt(duration),
          appointmentType,
          priority,
          chiefComplaint: chiefComplaint || null,
          notes: notes || null,
          ...(waitlistId && !isWalkIn ? { waitlistId } : {}),
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create appointment')
      }

      // Back to the waitlist the booking came from, where the entry now reads
      // Booked; otherwise to the book, as before.
      router.push(waitlistId ? trail.back('/appointments/waitlist') : '/appointments')
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

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Patient Selection */}
        <FormSection
          title="Patient"
          description="A registered patient, or a walk-in the clinic has not registered yet"
        >
          <div className="space-y-4">
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                <p className="text-xs text-muted-foreground md:col-span-2">
                  No patient record is created. Register them later from Walk-ins if they come back,
                  and this visit will follow them.
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
          </div>
        </FormSection>

        {/* Doctor & Schedule */}
        <FormSection
          title="Schedule"
          description="Select doctor, date, and time for the appointment"
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

              <FormField
                label="Assisted by"
                htmlFor="appointment-assistant"
                hint={
                  assistantsState === 'failed'
                    ? "Couldn't load the assistants. The appointment can be booked without one."
                    : 'Optional'
                }
              >
                {(control) => (
                  <Select
                    // Empty while loading, so the placeholder says so.
                    value={assistantsState === 'loading' ? '' : assistantId || NO_ASSISTANT}
                    // Radix reports '' when the value arrives in the same render as its
                    // option (the list loading with an assistant already chosen), which
                    // would quietly drop them. "No assistant" has a value of its own,
                    // so '' is never a choice somebody made.
                    onValueChange={(id) => {
                      if (id) setSelectedAssistant(id === NO_ASSISTANT ? '' : id)
                    }}
                    disabled={assistantsState !== 'ready'}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue placeholder="Loading assistants…" />
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
                <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading available slots…
                </div>
              ) : !selectedDoctor || !selectedDate ? (
                <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                  Select doctor and date to see available slots
                </p>
              ) : slotsError ? (
                <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                  {slotsError}
                </p>
              ) : timeSlots.length === 0 ? (
                <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                  No available slots for this date
                </p>
              ) : (
                /*
                  Boxed, because the list is as long as the day is.

                  A clinic open round the clock offers 48 half-hour slots, which
                  as a plain grid pushed the appointment type, the priority and
                  the Book button off the bottom of the form. Scrolling the
                  slots keeps the rest of the form where it was.
                */
                <div className="max-h-72 overflow-y-auto rounded-xl border p-2">
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
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
                        {selectedTime === slot.time && <Check className="h-3 w-3" />}
                        {formatTime(slot.time)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {errors.time && <p className="text-sm text-destructive">{errors.time}</p>}
            </div>
          </div>
        </FormSection>

        {/* Appointment Details */}
        <FormSection
          title="Appointment details"
          description="Additional information about the appointment"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="appointment-complaint">Chief complaint</Label>
              <Input
                id="appointment-complaint"
                placeholder="Patient's main concern or reason for visit"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="appointment-notes">Notes</Label>
              <Input
                id="appointment-notes"
                placeholder="Additional notes about the appointment"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </FormSection>

        {/* Submit, pinned to the bottom while the form scrolls */}
        <FormActions>
          <Button type="button" variant="outline" asChild>
            <Link href="/appointments">Cancel</Link>
          </Button>
          <SubmitButton busy={submitting} busyLabel="Booking…" icon={Calendar}>
            Book appointment
          </SubmitButton>
        </FormActions>
      </form>
    </div>
  )
}
