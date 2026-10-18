'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { medicalAlerts } from '@/lib/medical-history'
import { Separator } from '@/components/ui/separator'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  Calendar,
  Clock,
  User,
  UserPlus,
  UserX,
  Phone,
  Mail,
  MapPin,
  Pencil,
  LogIn,
  LogOut,
  CheckCircle,
  Trash2,
  AlertTriangle,
  Stethoscope,
  FileText,
  Receipt,
  ClipboardPlus,
} from 'lucide-react'
import {
  appointmentTypeConfig,
  priorityConfig,
  formatTime,
  getPatientName,
  getDoctorName,
} from '@/lib/appointment-utils'
import { displayDate, displayDateTime, displayTime } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { toastError } from '@/lib/toast-utils'
import {
  cancelAppointmentConfirm,
  noShowConfirm,
} from '@/components/appointments/appointment-confirms'
import { waitlistOfferToast } from '@/components/appointments/waitlist-offers'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatToken } from '@/lib/tokens'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { canMoveTo, noShowTooEarly } from '@/lib/appointment-status'
import { useCan } from '@/hooks/use-can'
import { newInvoiceHref } from '@/lib/invoice-links'
import { formatCurrency } from '@/lib/i18n/format'

interface Appointment {
  id: string
  appointmentNo: string
  scheduledDate: string
  scheduledTime: string
  /** The instant it starts — what "has it started yet" is measured against. */
  startsAt: string
  duration: number
  tokenNumber: string | null
  visitor: {
    id: string
    name: string
    phone: string | null
    convertedPatientId: string | null
  } | null
  appointmentType: string
  status: string
  priority: string
  chiefComplaint: string | null
  notes: string | null
  checkedInAt: string | null
  checkedOutAt: string | null
  waitTime: number | null
  cancelledAt: string | null
  cancellationReason: string | null
  videoConsultationId: string | null
  createdAt: string
  updatedAt: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    address: string | null
    city: string | null
    medicalHistory: {
      allergies: string[]
      conditions: string[]
      currentMedications: string[]
      isPregnant: boolean
    } | null
  } | null
  doctor: {
    id: string
    firstName: string
    lastName: string
    specialization: string | null
    phone: string | null
  }
  /** The dental assistant at the chair, when there was one. */
  assistant: { id: string; firstName: string; lastName: string } | null
  treatments: Array<{
    id: string
    treatmentNo: string
    status: string
    procedure: {
      name: string
      code: string
    }
  }>
  /**
   * The bills raised for this visit, cancelled ones included. Absent for
   * somebody who may not read billing.
   */
  invoices?: Array<{
    id: string
    invoiceNo: string
    status: string
    totalAmount: string | number
    balanceAmount: string | number
  }>
  reminders: Array<{
    id: string
    reminderType: string
    status: string
    scheduledFor: string
    sentAt: string | null
  }>
}

export default function AppointmentDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [appointment, setAppointment] = useState<Appointment | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(appointment?.appointmentNo ?? null)
  const [loading, setLoading] = useState(true)
  // A fetch that failed is not the same as an appointment that is not there.
  const [failed, setFailed] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const { toast } = useToast()
  // Raising the bill is the desk's act (review 4.3); offered to those who may.
  const canBill = useCan('billing:write') === true
  // The assistant's name opens their staff record for those who may read it;
  // for everyone else it is just the name, not a link to a refusal.
  const canReadStaff = useCan('staff:read') === true
  // Recording what was done in the chair is a clinician's act.
  const canRecordTreatment = useCan('clinical:write') === true

  /**
   * The API's own reason, as a toast. These handlers used to log a failure to
   * the console and carry on, so a refused check-in or no-show looked like a
   * button that did nothing.
   */
  const refused = async (response: Response, action: string) => {
    const data = await response.json().catch(() => ({}))
    toast(toastError(action, data))
  }

  const fetchAppointment = async () => {
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/appointments/${id}`)
      if (response.status === 404) {
        setAppointment(null)
        return
      }
      if (!response.ok) throw new Error('Failed to fetch appointment')
      const data = await response.json()
      setAppointment(data)
    } catch (error) {
      console.error('Error fetching appointment:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAppointment()
  }, [id])

  const handleCheckIn = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/appointments/${id}/check-in`, {
        method: 'POST',
      })
      if (!response.ok) {
        await refused(response, 'check in')
        return
      }
      fetchAppointment()
    } catch (error) {
      toast(toastError('check in', error))
    } finally {
      setActionLoading(false)
    }
  }

  const handleCheckOut = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/appointments/${id}/check-out`, {
        method: 'POST',
      })
      if (!response.ok) {
        await refused(response, 'check out')
        return
      }
      // Reloaded as COMPLETED, the header offers Create invoice for the visit.
      fetchAppointment()
    } catch (error) {
      toast(toastError('check out', error))
    } finally {
      setActionLoading(false)
    }
  }

  /**
   * The patient did not come.
   *
   * Confirmed first, because it is not a neutral note: a no-show counts
   * against the patient's record and is what decides whether they get an extra
   * reminder next time. It is also the kind of thing clicked by accident on a
   * row somebody meant to check in.
   */
  const handleNoShow = async () => {
    if (!appointment) return
    if (!(await confirm(noShowConfirm(appointment.appointmentNo)))) return
    await handleStatusChange('NO_SHOW')
  }

  /** The same question, and the same optional reason, as the list's row menu asks. */
  const handleCancel = async () => {
    if (!appointment) return
    const { confirmed, reason } = await confirm(cancelAppointmentConfirm(appointment.appointmentNo))
    if (!confirmed) return
    await handleStatusChange('CANCELLED', reason)
  }

  const STATUS_ACTION: Record<string, string> = {
    CANCELLED: 'cancel the appointment',
    NO_SHOW: 'mark the appointment as a no-show',
    CONFIRMED: 'confirm the appointment',
    IN_PROGRESS: 'call the patient in',
  }

  const handleStatusChange = async (status: string, cancellationReason?: string) => {
    const action = STATUS_ACTION[status] ?? 'update the appointment'
    try {
      setActionLoading(true)
      const body: Record<string, unknown> = { status }
      if (status === 'CANCELLED' && cancellationReason) {
        body.cancellationReason = cancellationReason
      }

      const response = await fetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        await refused(response, action)
        return
      }
      if (status === 'CANCELLED') {
        const offered = waitlistOfferToast(await response.json().catch(() => null))
        if (offered) toast(offered)
      }
      fetchAppointment()
    } catch (error) {
      toast(toastError(action, error))
    } finally {
      setActionLoading(false)
    }
  }

  const getTypeBadge = (type: string) => {
    const config = appointmentTypeConfig[type] || {
      label: type,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted/50',
    }
    return (
      <Badge variant="outline" className={`${config.bgColor} ${config.color} border-0`}>
        {config.label}
      </Badge>
    )
  }

  const getPriorityBadge = (priority: string) => {
    const config = priorityConfig[priority] || {
      label: priority,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
    }
    return (
      <Badge variant="outline" className={`${config.bgColor} ${config.color} border-0`}>
        {config.label}
      </Badge>
    )
  }

  if (loading && !appointment) return <PageSkeleton variant="detail" />

  if (failed && !appointment) {
    return (
      <div className="space-y-6">
        <BackLink trail={trail} fallback="/appointments" fallbackLabel="Appointments" />
        <LoadFailed what="this appointment" onRetry={fetchAppointment} />
      </div>
    )
  }

  if (!appointment) {
    return (
      <div className="space-y-6">
        <BackLink trail={trail} fallback="/appointments" fallbackLabel="Appointments" />
        <EmptyState
          icon={AlertTriangle}
          title="Appointment not found"
          description="The appointment you're looking for doesn't exist, or has been removed."
          actionLabel="Back to appointments"
          actionHref="/appointments"
        />
      </div>
    )
  }

  // Billing a visit (review 4.3): after it is over, for a registered patient
  // only — a walk-in has no record to raise an invoice against — and while no
  // invoice for it still stands. A cancelled one does not count, so the visit
  // can be billed again.
  const liveInvoices = (appointment.invoices ?? []).filter((i) => i.status !== 'CANCELLED')
  const canBillVisit =
    canBill &&
    Boolean(appointment.patient) &&
    appointment.status === 'COMPLETED' &&
    appointment.invoices !== undefined &&
    liveInvoices.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={appointment.appointmentNo}
        badges={
          <StatusBadge
            kind="appointment"
            status={appointment.status}
            className="text-base px-3 py-1"
          />
        }
        description={`Created on ${displayDate(appointment.createdAt)}`}
        back={<BackLink trail={trail} fallback="/appointments" fallbackLabel="Appointments" />}
        actions={
          <>
            {['SCHEDULED', 'CONFIRMED'].includes(appointment.status) && (
              <Button onClick={handleCheckIn} disabled={actionLoading}>
                <LogIn className="h-4 w-4 mr-2" />
                Check in
              </Button>
            )}
            {/* Called in from the waiting room. This is when the patient's wait
              ends and is recorded; checking out straight from the waiting room
              leaves the wait unknown. */}
            {appointment.status === 'CHECKED_IN' && (
              <Button
                variant="outline"
                onClick={() => handleStatusChange('IN_PROGRESS')}
                disabled={actionLoading}
              >
                <Stethoscope className="h-4 w-4 mr-2" />
                Call in
              </Button>
            )}
            {['CHECKED_IN', 'IN_PROGRESS'].includes(appointment.status) && (
              <Button onClick={handleCheckOut} disabled={actionLoading}>
                <LogOut className="h-4 w-4 mr-2" />
                Check out
              </Button>
            )}
            {/* What was done at this visit, recorded against it (bug report 16
              Oct, finding 26). The link is what the visit's Treatments card,
              the invoice's "This visit" tag and the unbilled-treatments filter
              read. A walk-in has no patient record to hold a treatment yet. */}
            {canRecordTreatment &&
              appointment.patient &&
              ['IN_PROGRESS', 'COMPLETED'].includes(appointment.status) && (
                <Button
                  variant={appointment.status === 'COMPLETED' ? 'outline' : 'default'}
                  asChild
                >
                  <Link
                    href={trail.to(
                      `/treatments/new?appointmentId=${appointment.id}&patientId=${appointment.patient.id}`
                    )}
                  >
                    <ClipboardPlus className="h-4 w-4 mr-2" />
                    Record treatment
                  </Link>
                </Button>
              )}
            {canBillVisit && appointment.patient && (
              <Button asChild>
                <Link
                  href={trail.to(
                    newInvoiceHref({
                      patientId: appointment.patient.id,
                      appointmentId: appointment.id,
                    })
                  )}
                >
                  <Receipt className="h-4 w-4 mr-2" />
                  Create invoice
                </Link>
              </Button>
            )}
            {appointment.status === 'SCHEDULED' && (
              <Button
                variant="outline"
                onClick={() => handleStatusChange('CONFIRMED')}
                disabled={actionLoading}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Confirm
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={trail.to(`/appointments/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Link>
            </Button>
            {/*
            Marking somebody absent belongs here as much as cancelling does.
            It was only ever on the list screen, so a receptionist who had
            opened the appointment to deal with a patient who had not arrived
            had to navigate back to the list to say so — and the no-show rate
            this application uses to decide who gets an extra reminder is built
            from exactly this action.
          */}
            {/* Not before the appointment has started: nobody has failed to
              attend something that has not begun. */}
            {canMoveTo(appointment.status, 'NO_SHOW') &&
              appointment.status !== 'NO_SHOW' &&
              !noShowTooEarly(appointment.startsAt) && (
                <Button variant="outline" onClick={handleNoShow} disabled={actionLoading}>
                  <UserX className="h-4 w-4 mr-2" />
                  No-show
                </Button>
              )}
            {appointment.status !== 'CANCELLED' && canMoveTo(appointment.status, 'CANCELLED') && (
              <Button variant="destructive" onClick={handleCancel} disabled={actionLoading}>
                <Trash2 className="h-4 w-4 mr-2" />
                Cancel appointment
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Appointment Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Appointment details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-medium">{displayDate(appointment.scheduledDate)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Time</p>
                <p className="font-medium">{formatTime(appointment.scheduledTime)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="font-medium">{appointment.duration} minutes</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Token</p>
                <p className="font-medium tabular-nums">
                  {appointment.tokenNumber ? (
                    <>
                      {formatToken(appointment.tokenNumber)}{' '}
                      <span className="text-xs text-muted-foreground font-normal">
                        ({appointment.tokenNumber})
                      </span>
                    </>
                  ) : (
                    'Issued at check-in'
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Type</p>
                {getTypeBadge(appointment.appointmentType)}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Priority</p>
                {getPriorityBadge(appointment.priority)}
              </div>
            </div>

            {(appointment.checkedInAt || appointment.checkedOutAt) && (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  {appointment.checkedInAt && (
                    <div>
                      <p className="text-sm text-muted-foreground">Checked in</p>
                      <p className="font-medium">{displayTime(appointment.checkedInAt)}</p>
                    </div>
                  )}
                  {appointment.checkedOutAt && (
                    <div>
                      <p className="text-sm text-muted-foreground">Checked out</p>
                      <p className="font-medium">{displayTime(appointment.checkedOutAt)}</p>
                    </div>
                  )}
                  {appointment.waitTime !== null && appointment.waitTime > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Wait time</p>
                      <p className="font-medium">{appointment.waitTime} minutes</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {appointment.chiefComplaint && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground">Chief complaint</p>
                  <p className="font-medium">{appointment.chiefComplaint}</p>
                </div>
              </>
            )}

            {appointment.notes && (
              <div>
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="font-medium">{appointment.notes}</p>
              </div>
            )}

            {appointment.status === 'CANCELLED' && (
              <>
                <Separator />
                <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">
                    Cancelled on {displayDateTime(appointment.cancelledAt)}
                  </p>
                  {appointment.cancellationReason && (
                    <p className="text-sm text-red-600 mt-1 dark:text-red-400">
                      Reason: {appointment.cancellationReason}
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Who this appointment is for — a registered patient, or a walk-in the
            clinic has not registered. Both get a card; only one has a record
            behind it. */}
        {appointment.patient ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Patient information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold">{getPatientName(appointment.patient)}</h3>
                  <p className="text-muted-foreground">{appointment.patient.patientId}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{formatPhone(appointment.patient.phone)}</span>
                </div>
                {appointment.patient.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{appointment.patient.email}</span>
                  </div>
                )}
                {(appointment.patient.address || appointment.patient.city) && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {[appointment.patient.address, appointment.patient.city]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {appointment.patient.medicalHistory && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-2">Medical alerts</h4>
                    {/*
                    Named the alerts rather than four hardcoded badges. Those
                    badges could only ever show the four conditions somebody
                    picked in advance — a patient on warfarin got no badge at
                    all, and their allergy badge said "Allergies" without saying
                    to what.
                  */}
                    <div className="flex flex-wrap gap-2">
                      {medicalAlerts(appointment.patient.medicalHistory).map((alert, i) => (
                        <Badge
                          key={i}
                          variant={alert.tone === 'danger' ? 'destructive' : 'secondary'}
                        >
                          {alert.label}
                        </Badge>
                      ))}
                    </div>
                    {appointment.patient.medicalHistory.currentMedications.length > 0 && (
                      <p className="text-sm text-muted-foreground mt-2">
                        Current medications:{' '}
                        {appointment.patient.medicalHistory.currentMedications.join(', ')}
                      </p>
                    )}
                  </div>
                </>
              )}

              <div className="pt-2">
                <Button variant="outline" className="w-full" asChild>
                  <Link href={trail.to(`/patients/${appointment.patient.id}`)}>
                    View full patient profile
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Walk-in
              </CardTitle>
              <CardDescription>
                Not registered. Nothing clinical can be recorded against a walk-in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold">{appointment.visitor?.name ?? 'Unknown'}</h3>
                {appointment.visitor?.phone && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <Phone className="h-4 w-4" />
                    {formatPhone(appointment.visitor.phone)}
                  </p>
                )}
              </div>
              {appointment.visitor && (
                <Button variant="outline" className="w-full" asChild>
                  <Link href={trail.to(`/walk-ins/${appointment.visitor.id}`)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Register as a patient
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Doctor Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5" />
              Doctor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Stethoscope className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">
                  {canReadStaff ? (
                    <Link
                      href={trail.to(`/staff/${appointment.doctor.id}`)}
                      className="hover:underline"
                    >
                      {getDoctorName(appointment.doctor)}
                    </Link>
                  ) : (
                    getDoctorName(appointment.doctor)
                  )}
                </h3>
                {appointment.doctor.specialization && (
                  <p className="text-sm text-muted-foreground">
                    {appointment.doctor.specialization}
                  </p>
                )}
                {appointment.doctor.phone && (
                  <p className="text-sm text-muted-foreground">
                    {formatPhone(appointment.doctor.phone)}
                  </p>
                )}
                {appointment.assistant && (
                  <p className="text-sm text-muted-foreground">
                    Assisted by{' '}
                    {canReadStaff ? (
                      <Link
                        href={trail.to(`/staff/${appointment.assistant.id}`)}
                        className="font-medium text-foreground hover:underline"
                      >
                        {appointment.assistant.firstName} {appointment.assistant.lastName}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">
                        {appointment.assistant.firstName} {appointment.assistant.lastName}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Treatments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Treatments
            </CardTitle>
          </CardHeader>
          <CardContent>
            {appointment.treatments.length === 0 ? (
              <p className="text-muted-foreground">No treatments recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {/* The work done at this appointment, each opening its own
                    record. These were plain boxes: the treatment they named
                    had a page, and the only way to reach it was the treatments
                    list and a search. */}
                {appointment.treatments.map((treatment) => (
                  <Link
                    key={treatment.id}
                    href={trail.to(`/treatments/${treatment.id}`)}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <div>
                      <p className="font-medium">{treatment.procedure.name}</p>
                      <p className="text-sm text-muted-foreground">{treatment.treatmentNo}</p>
                    </div>
                    <StatusBadge kind="treatment" status={treatment.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Billing: the invoices raised for this visit. Only for those who
            may read billing — the route leaves them out otherwise. */}
        {appointment.invoices !== undefined && appointment.patient && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Billing
              </CardTitle>
            </CardHeader>
            <CardContent>
              {appointment.invoices.length === 0 ? (
                <p className="text-muted-foreground">No invoice raised for this visit.</p>
              ) : (
                <div className="space-y-3">
                  {appointment.invoices.map((invoice) => (
                    <Link
                      key={invoice.id}
                      href={trail.to(`/billing/invoices/${invoice.id}`)}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent transition-colors"
                    >
                      <div>
                        <p className="font-medium">{invoice.invoiceNo}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(Number(invoice.totalAmount))}
                          {invoice.status !== 'CANCELLED' && Number(invoice.balanceAmount) > 0
                            ? ` · ${formatCurrency(Number(invoice.balanceAmount))} due`
                            : ''}
                        </p>
                      </div>
                      <StatusBadge kind="invoice" status={invoice.status} />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {ConfirmDialogComponent}
    </div>
  )
}
