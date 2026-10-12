'use client'

import { useState, useEffect } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchHandedPatient } from '@/lib/prefill'
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
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ArrowLeft, Calendar, Clock, User, Search, Check, Loader2, Video } from 'lucide-react'
import { formatTime } from '@/lib/appointment-utils'
import { isoDay } from '@/lib/dates'

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

export default function NewAppointmentPage() {
  const router = useRouter()
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

  // Data
  const [patients, setPatients] = useState<Patient[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Form state
  const [patientSearch, setPatientSearch] = useState('')
  const debouncedPatientSearch = useDebouncedValue(patientSearch)
  const [searchingPatients, setSearchingPatients] = useState(false)
  // How many the register actually holds, so a list capped at eight can say so.
  const [patientCount, setPatientCount] = useState(0)
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

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        // The dentists, and the one patient we were told to start with.
        //
        // This used to fetch `/api/patients?all=true` — every patient in the
        // register, into the browser, to be filtered there. A practice with
        // twenty thousand records downloaded all twenty thousand to book one
        // appointment. The register is searched on the server now, as it is
        // everywhere else in this application.
        const [doctorsRes, handedPatient] = await Promise.all([
          fetch('/api/staff/doctors'),
          preselectedPatientId ? fetchHandedPatient<Patient>(preselectedPatientId) : null,
        ])

        if (doctorsRes.ok) {
          const data = await doctorsRes.json()
          setDoctors(data.doctors)
        }

        // Arriving with a patient already chosen — the recall list's Book, a
        // patient's own record — must not ask the receptionist to search for
        // the name they just clicked. See lib/prefill.ts for why this used to.
        if (handedPatient) setSelectedPatient(handedPatient)
      } catch (err) {
        console.error('Error fetching data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [preselectedPatientId])

  /**
   * Finding a patient, on the server.
   *
   * Matching used to happen here, against the whole register, one column at a
   * time — so "John Smith" matched nothing, because neither the forename nor
   * the surname contains both words. The server does it now, and knows how to
   * read a full name.
   */
  useEffect(() => {
    if (debouncedPatientSearch.trim().length < 2) {
      setPatients([])
      setPatientCount(0)
      return
    }

    let current = true
    setSearchingPatients(true)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/patients?search=${encodeURIComponent(debouncedPatientSearch.trim())}&limit=8`
        )
        if (!current) return
        if (!res.ok) throw new Error('search failed')
        const data = await res.json()
        if (!current) return
        setPatients(data.patients ?? [])
        setPatientCount(data.pagination?.total ?? (data.patients ?? []).length)
      } catch {
        if (current) {
          setPatients([])
          setPatientCount(0)
        }
      } finally {
        if (current) setSearchingPatients(false)
      }
    })()

    return () => {
      current = false
    }
  }, [debouncedPatientSearch])

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
          toast({ variant: 'destructive', title: 'Could not load the available times' })
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
        toast({ variant: 'destructive', title: 'Could not load the available times' })
      } finally {
        if (current) setLoadingSlots(false)
      }
    }

    fetchSlots()
    return () => {
      current = false
    }
  }, [selectedDoctor, selectedDate, duration, toast])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const incomplete = (description: string) =>
      toast({ variant: 'destructive', title: 'Appointment not booked', description })

    if (isWalkIn) {
      if (visitorName.trim().length < 2) {
        incomplete('A walk-in needs a name')
        return
      }
    } else if (!selectedPatient) {
      incomplete('Please select a patient')
      return
    }

    if (!selectedDoctor) {
      incomplete('Please select a doctor')
      return
    }

    if (!selectedDate) {
      incomplete('Please select a date')
      return
    }

    if (!selectedTime) {
      incomplete('Please select a time slot')
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
        const data = await response.json()
        throw new Error(data.error || 'Failed to create appointment')
      }

      router.push('/appointments')
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Could not book the appointment',
        description: err.message,
      })
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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Go back" asChild>
          <Link href="/appointments">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="page-title">New Appointment</h1>
          <p className="text-muted-foreground">Schedule a new appointment for a patient</p>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit}>
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
              <div className="inline-flex rounded-md border p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={isWalkIn ? 'ghost' : 'default'}
                  onClick={() => setIsWalkIn(false)}
                >
                  Registered patient
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={isWalkIn ? 'default' : 'ghost'}
                  onClick={() => {
                    setIsWalkIn(true)
                    setSelectedPatient(null)
                  }}
                >
                  Walk-in
                </Button>
              </div>

              {isWalkIn ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="visitorName">Name *</Label>
                    <Input
                      id="visitorName"
                      value={visitorName}
                      onChange={(e) => setVisitorName(e.target.value)}
                      placeholder="What they gave at the desk"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="visitorPhone">Phone</Label>
                    <Input
                      id="visitorPhone"
                      value={visitorPhone}
                      onChange={(e) => setVisitorPhone(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <p className="sm:col-span-2 text-xs text-muted-foreground">
                    No patient record is created. Register them later from Walk-ins if they come
                    back, and this visit will follow them.
                  </p>
                </div>
              ) : selectedPatient ? (
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {selectedPatient.firstName} {selectedPatient.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">{selectedPatient.patientId}</p>
                      <p className="text-sm text-muted-foreground">{selectedPatient.phone}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPatient(null)}
                    >
                      Change
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search patient by name, phone, or ID..."
                      data-form-guard="ignore"
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border">
                    {patientSearch.trim().length < 2 ? (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        Type two letters of a name, a phone number or a patient ID.
                      </p>
                    ) : searchingPatients ? (
                      <p className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching…
                      </p>
                    ) : patients.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        <p>No patients found</p>
                        <Button variant="link" size="sm" asChild>
                          <Link href="/patients/new">Add New Patient</Link>
                        </Button>
                      </div>
                    ) : (
                      <>
                        {/*
                          Real buttons, not clickable divs. The front desk works
                          at a keyboard: this list could previously only be
                          reached with a mouse, so finding a patient meant
                          typing a name and then letting go of the keyboard.
                        */}
                        {patients.map((patient) => (
                          <button
                            key={patient.id}
                            type="button"
                            className="flex w-full items-center justify-between border-b p-3 text-left last:border-0 hover:bg-muted/50 focus:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => {
                              setSelectedPatient(patient)
                              setPatientSearch('')
                            }}
                          >
                            <span>
                              <span className="block font-medium">
                                {patient.firstName} {patient.lastName}
                              </span>
                              <span className="block text-sm text-muted-foreground">
                                {patient.patientId} | {patient.phone}
                              </span>
                            </span>
                          </button>
                        ))}
                        {/*
                          The list stops at eight. It used to stop at five and
                          say nothing, so a common surname could hide the right
                          patient behind a cut-off nobody could see.
                        */}
                        {patientCount > patients.length && (
                          <p className="p-3 text-center text-xs text-muted-foreground">
                            Showing {patients.length} of {patientCount}. Narrow the search — add a
                            surname, or type the phone number.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </>
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
              <div className="space-y-2">
                <Label>Doctor *</Label>
                <Select value={selectedDoctor} onValueChange={setSelectedDoctor}>
                  <SelectTrigger>
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Date *</Label>
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value)
                      setSelectedTime('')
                    }}
                    min={getMinDate()}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Duration</Label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger>
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
              <div className="space-y-2">
                <Label>Time Slot *</Label>
                {loadingSlots ? (
                  <div className="flex items-center gap-2 p-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading available slots...
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
                        onClick={() => setSelectedTime(slot.time)}
                      >
                        {selectedTime === slot.time && <Check className="mr-1 h-3 w-3" />}
                        {formatTime(slot.time)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Appointment Details */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Appointment Details
              </CardTitle>
              <CardDescription>Additional information about the appointment</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Appointment Type</Label>
                  <Select value={appointmentType} onValueChange={setAppointmentType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CONSULTATION">Consultation</SelectItem>
                      <SelectItem value="PROCEDURE">Procedure</SelectItem>
                      <SelectItem value="FOLLOW_UP">Follow Up</SelectItem>
                      <SelectItem value="EMERGENCY">Emergency</SelectItem>
                      <SelectItem value="CHECK_UP">Check Up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger>
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
                  <Label>Chief Complaint</Label>
                  <Input
                    placeholder="Patient's main concern or reason for visit"
                    value={chiefComplaint}
                    onChange={(e) => setChiefComplaint(e.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-3">
                  <Label>Notes</Label>
                  <Input
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
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Calendar className="mr-2 h-4 w-4" />
                Book Appointment
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
