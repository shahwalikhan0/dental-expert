'use client'

import { useState, useEffect } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ArrowLeft, Calendar, Clock, User, Search, Check, Loader2, Video } from 'lucide-react'
import { formatTime } from '@/lib/appointment-utils'

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
  const searchParams = useSearchParams()
  const preselectedPatientId = searchParams.get('patientId')

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Data
  const [patients, setPatients] = useState<Patient[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Form state
  const [patientSearch, setPatientSearch] = useState('')
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
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [notes, setNotes] = useState('')

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [patientsRes, doctorsRes] = await Promise.all([
          fetch('/api/patients?all=true'),
          fetch('/api/staff/doctors'),
        ])

        if (patientsRes.ok) {
          const data = await patientsRes.json()
          setPatients(data.patients)

          // If preselected patient
          if (preselectedPatientId) {
            const patient = data.patients.find((p: Patient) => p.id === preselectedPatientId)
            if (patient) {
              setSelectedPatient(patient)
            }
          }
        }

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
  }, [preselectedPatientId])

  // Fetch available time slots when doctor and date are selected
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
            setTimeSlots(data.slots)
          } else {
            setTimeSlots([])
            setError(data.reason || 'No slots available')
          }
        }
      } catch (err) {
        console.error('Error fetching slots:', err)
      } finally {
        setLoadingSlots(false)
      }
    }

    fetchSlots()
  }, [selectedDoctor, selectedDate, duration])

  // Filter patients based on search
  const filteredPatients = patients.filter(
    (p) =>
      p.firstName.toLowerCase().includes(patientSearch.toLowerCase()) ||
      p.lastName.toLowerCase().includes(patientSearch.toLowerCase()) ||
      p.phone.includes(patientSearch) ||
      p.patientId.toLowerCase().includes(patientSearch.toLowerCase())
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (isWalkIn) {
      if (visitorName.trim().length < 2) {
        setError('A walk-in needs a name')
        return
      }
    } else if (!selectedPatient) {
      setError('Please select a patient')
      return
    }

    if (!selectedDoctor) {
      setError('Please select a doctor')
      return
    }

    if (!selectedDate) {
      setError('Please select a date')
      return
    }

    if (!selectedTime) {
      setError('Please select a time slot')
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
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const getMinDate = () => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  }

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
        <Link href="/appointments">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Appointment</h1>
          <p className="text-muted-foreground">Schedule a new appointment for a patient</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
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
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border">
                    {filteredPatients.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        <p>No patients found</p>
                        <Link href="/patients/new">
                          <Button variant="link" size="sm">
                            Add New Patient
                          </Button>
                        </Link>
                      </div>
                    ) : (
                      filteredPatients.slice(0, 5).map((patient) => (
                        <div
                          key={patient.id}
                          className="flex cursor-pointer items-center justify-between border-b p-3 last:border-0 hover:bg-muted/50"
                          onClick={() => {
                            setSelectedPatient(patient)
                            setPatientSearch('')
                          }}
                        >
                          <div>
                            <p className="font-medium">
                              {patient.firstName} {patient.lastName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {patient.patientId} | {patient.phone}
                            </p>
                          </div>
                        </div>
                      ))
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

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-4">
          <Link href="/appointments">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
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
