'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { useToast } from '@/hooks/use-toast'
import { MergeDialog } from '@/components/patients/merge-dialog'
import { PortalAccessCard } from '@/components/patients/portal-access-card'
import { FamilyCard } from '@/components/patients/family-card'
import { ClinicalNotesCard } from '@/components/patients/clinical-notes-card'
import { PatientLedger } from '@/components/billing/patient-ledger'
import { CreateInvoiceBar } from '@/components/billing/create-invoice-bar'
import { useSession } from 'next-auth/react'
import { holderCan } from '@/lib/rbac'
import { useCan } from '@/hooks/use-can'
import { prescriberName } from '@/lib/prescribing'
import {
  ArrowLeft,
  Calendar,
  Phone,
  Mail,
  MapPin,
  Edit,
  FileText,
  User,
  Stethoscope,
  CreditCard,
  Heart,
  AlertCircle,
  FileCheck,
  History,
  Pill,
  TestTube,
  Activity,
  Smile,
  Merge,
  NotebookPen,
  UserCheck,
  UserX,
} from 'lucide-react'
import { DentalChart } from '@/components/dental-chart'
import { describeTeethByQuadrant, parseTeeth } from '@/lib/teeth'
import { PatientFormSubmissions } from '@/components/forms/patient-form-submissions'
import { formatDate, formatTime } from '@/lib/appointment-utils'
import { ClickableRow } from '@/components/ui/data-grid'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PerioPanel } from '@/components/clinical/perio-panel'
import { bloodGroupLabel, genderLabel } from '@/lib/labels'
import { displayDate } from '@/lib/dates'
import { ActiveFilters } from '@/components/ui/active-filters'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { humanise } from '@/lib/labels'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  alternatePhone?: string
  dateOfBirth: string
  gender: string
  bloodGroup?: string
  address?: string
  city?: string
  state?: string
  postalCode?: string
  occupation?: string
  /** False once deactivated, or merged away as a duplicate. */
  isActive: boolean
  emergencyContactName?: string
  emergencyContactPhone?: string
  emergencyContactRelation?: string
  /** Set when this record was merged away as a duplicate. */
  mergedInto?: {
    id: string
    patientId: string
    firstName: string
    lastName: string
  } | null
  medicalHistory?: {
    allergies?: string[]
    conditions?: string[]
    currentMedications?: string[]
    familyDentalHistory?: string | null
  }
  appointments: any[]
  /**
   * Absent when the caller may not read them — the clinical parts without
   * `clinical:read`, the invoices without `billing:read`. See the route.
   */
  treatments?: any[]
  invoices?: any[]
  prescriptions?: Prescription[]
  _count: {
    appointments: number
    treatments?: number
    invoices?: number
    prescriptions?: number
  }
}

interface Prescription {
  id: string
  prescriptionNo: string
  diagnosis?: string | null
  toothNumbers?: string | null
  createdAt: string
  doctor?: { firstName: string; lastName: string } | null
  medications: { id: string; medicationName: string; dosage: string; frequency: string }[]
}

interface TimelineEvent {
  id: string
  type: 'appointment' | 'treatment' | 'payment' | 'document' | 'prescription' | 'lab_order'
  date: string
  title: string
  description?: string
  status?: string
  metadata?: Record<string, any>
}

/**
 * The tabs this record has, and the only values `?tab=` will honour.
 *
 * Named rather than trusted from the query string: an unknown value would
 * render a Tabs root with no matching content, which looks like a patient whose
 * record has gone blank.
 */
const PATIENT_TABS = [
  'overview',
  'dental-chart',
  'perio',
  'timeline',
  'appointments',
  'treatments',
  'notes',
  'prescriptions',
  'billing',
  'forms',
]

/**
 * Tabs that are the clinical record, and the one that is the account.
 *
 * Shown only to somebody who may read them. The front desk was shown the
 * chart, the perio exam, the treatments, the notes and the prescriptions —
 * diagnoses and medicines included — on a record whose every one of those
 * screens refuses them on its own (bug report 12 Oct, finding 5).
 */
const CLINICAL_TABS = ['dental-chart', 'perio', 'treatments', 'notes', 'prescriptions']
const BILLING_TABS = ['billing']

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const { toast } = useToast()
  // Offering a button the server will refuse is worse than not offering it.
  // The server remains the authority; see the route.
  const { data: session } = useSession()
  const holder = { role: session?.user?.role, clinicalRole: session?.user?.clinicalRole }
  const canManagePortal = holderCan(holder, 'patients:write')
  const canEditPatient = holderCan(holder, 'patients:write')
  const canReadClinical = holderCan(holder, 'clinical:read')
  const canWriteClinical = holderCan(holder, 'clinical:write')
  // Prescribing is the dentist's act: `clinical:sign`, as the prescription
  // route requires. `clinical:write` let the assistant and the administrator
  // open a form that would be refused.
  const canPrescribe = useCan('clinical:sign') === true
  const canReadBilling = holderCan(holder, 'billing:read')
  const canWriteBilling = holderCan(holder, 'billing:write')
  const canReadLab = holderCan(holder, 'lab:read')
  const canBook = holderCan(holder, 'appointments:write')
  // Merging and deactivating are both behind `patients:delete` on the server
  // — see their routes for why a merge is not a `patients:write` act.
  const canRetire = holderCan(holder, 'patients:delete')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [patient, setPatient] = useState<Patient | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(patient ? `${patient.firstName} ${patient.lastName}` : null)
  const [loading, setLoading] = useState(true)
  /**
   * Which tab is open, kept in the URL.
   *
   * It was component state, which meant a dentist could not send a colleague a
   * link to a patient's chart, a refresh dropped back to Overview, and Back
   * from an invoice returned to Overview rather than to Billing — the tab the
   * invoice was opened from. Nine tabs make that a real cost.
   */
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab') ?? ''
  const visibleTabs = PATIENT_TABS.filter(
    (tab) =>
      (canReadClinical || !CLINICAL_TABS.includes(tab)) &&
      (canReadBilling || !BILLING_TABS.includes(tab))
  )
  const activeTab = visibleTabs.includes(requestedTab) ? requestedTab : 'overview'

  /**
   * Is there anything to show, rather than: is there a row?
   *
   * A history that was recorded and then cleared leaves a row with three empty
   * lists behind it. Keying the card on the row drew an empty card, which reads
   * as a panel that failed to load rather than as a record with nothing in it.
   */
  const history = patient?.medicalHistory
  const hasMedicalHistory = Boolean(
    history &&
    ((history.allergies?.length ?? 0) > 0 ||
      (history.conditions?.length ?? 0) > 0 ||
      (history.currentMedications?.length ?? 0) > 0)
  )

  const setActiveTab = (tab: string) => {
    const next = new URLSearchParams(searchParams.toString())
    if (tab === 'overview') next.delete('tab')
    else next.set('tab', tab)
    const query = next.toString()
    // `replace`, not `push`: flicking between tabs should not fill the back
    // button with steps the user has to press their way out of.
    router.replace(query ? `?${query}` : '?', { scroll: false })
  }

  // Timeline state
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineFilter, setTimelineFilter] = useState<string>('all')

  const fetchPatient = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/patients/${resolvedParams.id}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `Failed to fetch patient (${response.status})`)
      }

      const data = await response.json()
      setPatient(data.patient)
    } catch (error: any) {
      console.error('Error fetching patient:', error)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to load patient details',
      })
    } finally {
      setLoading(false)
    }
  }, [resolvedParams.id, toast])

  useEffect(() => {
    fetchPatient()
  }, [fetchPatient])

  /**
   * Deactivate, with the server's reasons for refusing shown as they are.
   *
   * The route refuses a patient who owes money or is in the chair, and says
   * which — the toast is that sentence, so the desk knows what to settle first.
   */
  const deactivate = async () => {
    try {
      const response = await fetch(`/api/patients/${resolvedParams.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'The patient could not be deactivated')
      toast({ title: 'Patient deactivated', description: data.message })
      fetchPatient()
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not deactivate',
        description: error.message,
      })
    }
  }

  const reactivate = async () => {
    setReactivating(true)
    try {
      const response = await fetch(`/api/patients/${resolvedParams.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'The patient could not be reactivated')
      toast({
        title: 'Patient reactivated',
        description: 'They are back on the register and can be booked again.',
      })
      fetchPatient()
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not reactivate',
        description: error.message,
      })
    } finally {
      setReactivating(false)
    }
  }

  const fetchTimeline = useCallback(async () => {
    try {
      setTimelineLoading(true)
      const typeParam = timelineFilter !== 'all' ? `?type=${timelineFilter}` : ''
      const response = await fetch(`/api/patients/${resolvedParams.id}/timeline${typeParam}`)
      if (!response.ok) throw new Error('Failed to fetch timeline')

      const data = await response.json()
      setTimelineEvents(data.events)
    } catch (error) {
      console.error('Error fetching timeline:', error)
    } finally {
      setTimelineLoading(false)
    }
  }, [resolvedParams.id, timelineFilter])

  useEffect(() => {
    if (activeTab === 'timeline') {
      fetchTimeline()
    }
  }, [activeTab, fetchTimeline])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Patient not found</p>
        <Button onClick={() => router.push('/patients')}>Back to Patients</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <BackLink trail={trail} fallback="/patients" fallbackLabel="Patients" />
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-lg">
              {patient.firstName[0]}
              {patient.lastName[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="page-title">
              {patient.firstName} {patient.lastName}
            </h1>
            <p className="text-muted-foreground">Patient ID: {patient.patientId}</p>
            <div className="flex items-center gap-2 mt-2">
              {!patient.isActive && !patient.mergedInto && (
                <Badge variant="destructive">Inactive</Badge>
              )}
              <Badge variant="outline">{genderLabel(patient.gender)}</Badge>
              {patient.bloodGroup && (
                <Badge variant="secondary">{bloodGroupLabel(patient.bloodGroup)}</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditPatient && (
            <Button variant="outline" asChild>
              <Link href={`/patients/${patient.id}/edit`}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Link>
            </Button>
          )}
          {/*
            Two records for one person is the commonest mess a front desk makes.
            The registration form has always warned about a likely duplicate
            before it is created; this is what to do about the ones already in
            the register, of which there was previously nothing at all.
          */}
          {canRetire && patient.isActive && (
            <Button variant="outline" onClick={() => setMergeOpen(true)}>
              <Merge className="h-4 w-4 mr-2" />
              Merge duplicate
            </Button>
          )}
          {canRetire && patient.isActive && (
            <Button variant="outline" onClick={() => setDeactivateOpen(true)}>
              <UserX className="h-4 w-4 mr-2" />
              Deactivate
            </Button>
          )}
          {canBook && patient.isActive && (
            <Button asChild>
              <Link href={trail.to(`/appointments/new?patientId=${patient.id}`)}>
                <Calendar className="h-4 w-4 mr-2" />
                Book Appointment
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/*
        A record that was merged away. Its patient ID is printed on
        prescriptions and receipts the clinic has already handed out, so opening
        it must say where the history went rather than show an empty record.
      */}
      {patient.mergedInto && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm">
              This record was merged into{' '}
              <span className="font-medium">
                {patient.mergedInto.firstName} {patient.mergedInto.lastName} (
                {patient.mergedInto.patientId})
              </span>
              . The history is there.
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link href={trail.to(`/patients/${patient.mergedInto.id}`)}>Open that record</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/*
        Deactivated, and not merged away. There was no way back from this (bug
        report 12 Oct, finding 22); the history is all still here, and a
        patient who returns after two years is the same patient.
      */}
      {!patient.isActive && !patient.mergedInto && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm">
              This patient is inactive. They cannot be booked or invoiced until they are
              reactivated.
            </p>
            {canEditPatient && (
              <Button size="sm" variant="outline" onClick={reactivate} disabled={reactivating}>
                <UserCheck className="h-4 w-4 mr-2" />
                {reactivating ? 'Reactivating…' : 'Reactivate'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="overview" className="gap-2">
            <User className="h-4 w-4" />
            <span>Overview</span>
          </TabsTrigger>
          {canReadClinical && (
            <TabsTrigger value="dental-chart" className="gap-2">
              <Smile className="h-4 w-4" />
              <span>Dental Chart</span>
            </TabsTrigger>
          )}
          {canReadClinical && (
            <TabsTrigger value="perio" className="gap-2">
              <Activity className="h-4 w-4" />
              <span>Perio</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="timeline" className="gap-2">
            <History className="h-4 w-4" />
            <span>Timeline</span>
          </TabsTrigger>
          <TabsTrigger value="appointments" className="gap-2">
            <Calendar className="h-4 w-4" />
            <span>Appointments</span>
          </TabsTrigger>
          {canReadClinical && (
            <TabsTrigger value="treatments" className="gap-2">
              <Stethoscope className="h-4 w-4" />
              <span>Treatments</span>
            </TabsTrigger>
          )}
          {canReadClinical && (
            <TabsTrigger value="notes" className="gap-2">
              <NotebookPen className="h-4 w-4" />
              <span>Notes</span>
            </TabsTrigger>
          )}
          {canReadClinical && (
            <TabsTrigger value="prescriptions" className="gap-2">
              <Pill className="h-4 w-4" />
              <span>Prescriptions</span>
              <Badge variant="secondary" className="ml-1">
                {patient._count.prescriptions ?? 0}
              </Badge>
            </TabsTrigger>
          )}
          {canReadBilling && (
            <TabsTrigger value="billing" className="gap-2">
              <CreditCard className="h-4 w-4" />
              <span>Billing</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="forms" className="gap-2">
            <FileCheck className="h-4 w-4" />
            <span>Forms</span>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Its status is read with `patients:write`, the permission that
              manages it, so anyone without it was only ever refused (403). */}
          {canManagePortal && <PortalAccessCard patientId={patient.id} canManage />}
          <FamilyCard
            patientId={patient.id}
            patientName={`${patient.firstName} ${patient.lastName}`}
            canEdit={holderCan(session?.user, 'patients:write')}
          />
          <div className="grid gap-6 md:grid-cols-2">
            {/* Contact Information */}
            <Card>
              <CardHeader>
                <CardTitle>Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p>{patient.phone}</p>
                    {patient.alternatePhone && (
                      <p className="text-sm text-muted-foreground">{patient.alternatePhone}</p>
                    )}
                  </div>
                </div>
                {patient.email && (
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Email</p>
                      <p>{patient.email}</p>
                    </div>
                  </div>
                )}
                {patient.address && (
                  <div className="flex items-center gap-3">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Address</p>
                      <p>{patient.address}</p>
                      <p className="text-sm text-muted-foreground">
                        {[patient.city, patient.state, patient.postalCode]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Personal Details */}
            <Card>
              <CardHeader>
                <CardTitle>Personal Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Date of Birth</p>
                    <p>{displayDate(patient.dateOfBirth)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Gender</p>
                    <p>{genderLabel(patient.gender)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Blood Group</p>
                    <p>{bloodGroupLabel(patient.bloodGroup)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Occupation</p>
                    <p>{patient.occupation || 'N/A'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Emergency Contact */}
            <Card>
              <CardHeader>
                <CardTitle>Emergency Contact</CardTitle>
              </CardHeader>
              <CardContent>
                {patient.emergencyContactName ? (
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm text-muted-foreground">Name</p>
                      <p>{patient.emergencyContactName}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <p>{patient.emergencyContactPhone}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Relation</p>
                      <p>{patient.emergencyContactRelation}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No emergency contact on file</p>
                )}
              </CardContent>
            </Card>

            {/* Medical History Summary */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-4 w-4" />
                  Medical History
                </CardTitle>
                {canEditPatient && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={trail.to(`/patients/${patient.id}/edit`)}>
                      {hasMedicalHistory ? 'Edit' : 'Record'}
                    </Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {hasMedicalHistory ? (
                  <div className="space-y-3">
                    {(history?.allergies?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground">Allergies</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {history?.allergies?.map((allergy) => (
                            <Badge key={allergy} variant="destructive">
                              {allergy}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {(history?.conditions?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground">Medical Conditions</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {history?.conditions?.map((condition) => (
                            <Badge key={condition} variant="secondary">
                              {condition}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {(history?.currentMedications?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground">Current Medications</p>
                        <p className="text-sm">{history?.currentMedications?.join(', ')}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Nothing recorded — an allergy noted here is checked against every prescription.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Dental Chart Tab */}
        {canReadClinical && (
          <TabsContent value="dental-chart" className="space-y-6">
            <DentalChart patientId={patient.id} />
          </TabsContent>
        )}

        {/* The tooth chart says what a tooth is; this says what the gum around
            it is doing. Adjacent tabs because they are read together. */}
        {canReadClinical && (
          <TabsContent value="perio" className="space-y-6">
            <PerioPanel patientId={patient.id} />
          </TabsContent>
        )}

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Patient Timeline</CardTitle>
                <CardDescription>
                  Complete history of appointments, treatments, payments, and documents
                </CardDescription>
              </div>
              <Select value={timelineFilter} onValueChange={setTimelineFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="appointment">Appointments</SelectItem>
                  {/* Only the kinds the timeline will return to this caller —
                      the route leaves the others out. */}
                  {canReadClinical && <SelectItem value="treatment">Treatments</SelectItem>}
                  {canReadBilling && <SelectItem value="payment">Payments</SelectItem>}
                  <SelectItem value="document">Documents</SelectItem>
                  {canReadClinical && <SelectItem value="prescription">Prescriptions</SelectItem>}
                  {canReadLab && <SelectItem value="lab_order">Lab Orders</SelectItem>}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <ActiveFilters
                className="-mt-2 mb-4"
                noun="events"
                onClearAll={() => setTimelineFilter('all')}
                filters={[
                  {
                    label: 'Showing',
                    value: timelineFilter === 'all' ? null : humanise(timelineFilter),
                    onClear: () => setTimelineFilter('all'),
                  },
                ]}
              />
              {timelineLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : timelineEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[200px]">
                  <History className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No events found</p>
                </div>
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />

                  <div className="space-y-6">
                    {timelineEvents.map((event, index) => {
                      const getEventIcon = () => {
                        switch (event.type) {
                          case 'appointment':
                            return <Calendar className="h-4 w-4" />
                          case 'treatment':
                            return <Stethoscope className="h-4 w-4" />
                          case 'payment':
                            return <CreditCard className="h-4 w-4" />
                          case 'document':
                            return <FileText className="h-4 w-4" />
                          case 'prescription':
                            return <Pill className="h-4 w-4" />
                          case 'lab_order':
                            return <TestTube className="h-4 w-4" />
                          default:
                            return <User className="h-4 w-4" />
                        }
                      }

                      const getEventColor = () => {
                        switch (event.type) {
                          case 'appointment':
                            return 'bg-blue-100 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60'
                          case 'treatment':
                            return 'bg-green-100 text-green-600 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800/60'
                          case 'payment':
                            return 'bg-yellow-100 text-yellow-600 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800/60'
                          case 'document':
                            return 'bg-purple-100 text-purple-600 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800/60'
                          case 'prescription':
                            return 'bg-orange-100 text-orange-600 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800/60'
                          case 'lab_order':
                            return 'bg-pink-100 text-pink-600 border-pink-200 dark:bg-pink-950/40 dark:text-pink-400 dark:border-pink-800/60'
                          default:
                            return 'bg-muted text-muted-foreground border-border'
                        }
                      }

                      return (
                        <div key={event.id} className="relative flex gap-4 pl-1">
                          {/* Timeline dot */}
                          <div
                            className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 ${getEventColor()}`}
                          >
                            {getEventIcon()}
                          </div>

                          {/* Event content */}
                          <div className="flex-1 pb-6">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="font-medium">{event.title}</p>
                                {event.description && (
                                  <p className="text-sm text-muted-foreground">
                                    {event.description}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="text-sm text-muted-foreground">
                                  {displayDate(event.date)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(event.date), 'p')}
                                </p>
                              </div>
                            </div>

                            {event.status && (
                              <Badge
                                variant={
                                  event.status === 'COMPLETED' || event.status === 'PAID'
                                    ? 'default'
                                    : event.status === 'CANCELLED'
                                      ? 'destructive'
                                      : 'secondary'
                                }
                                className="mt-2"
                              >
                                {event.status}
                              </Badge>
                            )}

                            {/* Additional metadata display */}
                            {event.metadata && Object.keys(event.metadata).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {event.metadata.toothNumbers && (
                                  <span className="text-xs bg-muted px-2 py-1 rounded">
                                    Teeth:{' '}
                                    {describeTeethByQuadrant(
                                      parseTeeth(String(event.metadata.toothNumbers))
                                    ) || String(event.metadata.toothNumbers)}
                                  </span>
                                )}
                                {event.metadata.cost && (
                                  <span className="text-xs bg-muted px-2 py-1 rounded">
                                    Rs {Number(event.metadata.cost).toLocaleString()}
                                  </span>
                                )}
                                {event.metadata.amount && (
                                  <span className="text-xs bg-muted px-2 py-1 rounded">
                                    Rs {Number(event.metadata.amount).toLocaleString()}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appointments Tab */}
        <TabsContent value="appointments" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Appointments</CardTitle>
                <CardDescription>Recent and upcoming appointments</CardDescription>
              </div>
              {canBook && patient.isActive && (
                <Button asChild>
                  <Link href={trail.to(`/appointments/new?patientId=${patient.id}`)}>
                    <Calendar className="h-4 w-4 mr-2" />
                    New Appointment
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {patient.appointments.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[200px]">
                  <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No appointments found</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Doctor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patient.appointments.map((apt) => (
                      <ClickableRow
                        key={apt.id}
                        href={trail.to(`/appointments/${apt.id}`)}
                        label={`Open appointment on ${formatDate(apt.scheduledDate)}`}
                      >
                        <TableCell>
                          <div>
                            <p className="font-medium">{formatDate(apt.scheduledDate)}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatTime(apt.scheduledTime)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{apt.appointmentType}</TableCell>
                        <TableCell>
                          {apt.doctor ? prescriberName(apt.doctor) : 'Not assigned'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              apt.status === 'COMPLETED'
                                ? 'default'
                                : apt.status === 'CANCELLED'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {apt.status}
                          </Badge>
                        </TableCell>
                      </ClickableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Treatments Tab */}
        {canReadClinical && (
          <TabsContent value="treatments" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Treatment History</CardTitle>
                <CardDescription>Past procedures and treatments</CardDescription>
              </CardHeader>
              <CardContent>
                {(patient.treatments ?? []).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[200px]">
                    <Stethoscope className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No treatments recorded</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Procedure</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Doctor</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(patient.treatments ?? []).map((treatment) => (
                        <ClickableRow
                          key={treatment.id}
                          href={trail.to(`/treatments/${treatment.id}`)}
                          label={`Open ${treatment.procedure.name}`}
                        >
                          <TableCell>{displayDate(treatment.createdAt)}</TableCell>
                          <TableCell className="font-medium">{treatment.procedure.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{treatment.procedure.category}</Badge>
                          </TableCell>
                          <TableCell>
                            {treatment.doctor ? prescriberName(treatment.doctor) : 'N/A'}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                treatment.status === 'COMPLETED'
                                  ? 'default'
                                  : treatment.status === 'CANCELLED'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                            >
                              {treatment.status}
                            </Badge>
                          </TableCell>
                        </ClickableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Notes Tab */}
        {canReadClinical && (
          <TabsContent value="notes" className="space-y-6">
            <ClinicalNotesCard
              patientId={patient.id}
              canWrite={canWriteClinical}
              canSign={holderCan(holder, 'clinical:sign')}
            />
          </TabsContent>
        )}

        {/* Prescriptions Tab */}
        {canReadClinical && (
          <TabsContent value="prescriptions" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Prescriptions</CardTitle>
                  <CardDescription>What this patient was told to take, and when</CardDescription>
                </div>
                {/* Writing one needs `clinical:sign`; reading the list does not. */}
                {canPrescribe && patient.isActive && (
                  <Button asChild>
                    <Link href={trail.to(`/prescriptions/new?patientId=${patient.id}`)}>
                      <Pill className="h-4 w-4 mr-2" />
                      New Prescription
                    </Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {(patient.prescriptions ?? []).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[200px]">
                    <Pill className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No prescriptions written</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Number</TableHead>
                        <TableHead>Medications</TableHead>
                        <TableHead>Doctor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(patient.prescriptions ?? []).map((rx) => (
                        <ClickableRow
                          key={rx.id}
                          href={trail.to(`/prescriptions/${rx.id}`)}
                          label={`Open prescription ${rx.prescriptionNo}`}
                        >
                          <TableCell>{displayDate(rx.createdAt)}</TableCell>
                          <TableCell className="font-medium">{rx.prescriptionNo}</TableCell>
                          <TableCell>
                            {rx.medications.length === 0 ? (
                              <span className="text-muted-foreground">No medicines</span>
                            ) : (
                              <div className="space-y-0.5">
                                {rx.medications.map((med) => (
                                  <p key={med.id} className="text-sm">
                                    <span className="font-medium">{med.medicationName}</span>
                                    <span className="text-muted-foreground">
                                      {' '}
                                      {med.dosage} · {med.frequency}
                                    </span>
                                  </p>
                                ))}
                              </div>
                            )}
                            {rx.diagnosis && (
                              <p className="text-xs text-muted-foreground mt-1">{rx.diagnosis}</p>
                            )}
                          </TableCell>
                          <TableCell>{rx.doctor ? prescriberName(rx.doctor) : 'N/A'}</TableCell>
                        </ClickableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Billing Tab */}
        {canReadBilling && (
          <TabsContent value="billing" className="space-y-6">
            {/*
              A running balance, not a list of invoices with their own balances.
              What the desk is asked is "what do I owe you?", and the old table
              left that sum to whoever was standing there. See lib/ledger.ts.
            */}
            {/* The way in to billing from the record (review 4.1). Not for an
                inactive patient, who the invoice route will not bill. */}
            {canWriteBilling && patient.isActive && (
              <CreateInvoiceBar patientId={patient.id} to={trail.to} />
            )}
            <PatientLedger patientId={patient.id} />
          </TabsContent>
        )}

        {/* Forms Tab */}
        <TabsContent value="forms" className="space-y-6">
          <PatientFormSubmissions patientId={patient.id} />
        </TabsContent>
      </Tabs>
      {canRetire && (
        <MergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          patient={patient}
          onMerged={() => fetchPatient()}
        />
      )}
      <ConfirmDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        title={`Deactivate ${patient.firstName} ${patient.lastName}?`}
        description="They leave the patient list and their upcoming appointments are cancelled. Their history is kept, and they can be reactivated from this record at any time. A patient who owes money or is in the clinic now cannot be deactivated."
        confirmLabel="Deactivate"
        onConfirm={deactivate}
      />
    </div>
  )
}
