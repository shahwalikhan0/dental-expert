'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { medicalAlerts } from '@/lib/medical-history'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  Calendar,
  Clock,
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
  ChevronRight,
  Ticket,
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

  const person = appointment.patient
    ? getPatientName(appointment.patient)
    : (appointment.visitor?.name ?? 'Walk-in')
  const initials =
    person
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase() || '?'
  const ended = ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'].includes(appointment.status)
  const canNoShow =
    canMoveTo(appointment.status, 'NO_SHOW') &&
    appointment.status !== 'NO_SHOW' &&
    !noShowTooEarly(appointment.startsAt)
  const canCancel = appointment.status !== 'CANCELLED' && canMoveTo(appointment.status, 'CANCELLED')

  return (
    <div className="space-y-6">
      {/*
        Who is coming, when, and to whom, then the one step the visit is
        waiting for as the primary button: confirm, check in, call in, check
        out, record, bill. Editing, no-show and cancelling are rarer, and the
        last two are not undone, so they sit behind "More".
      */}
      <ProfileHeader
        eyebrow={appointment.appointmentNo}
        name={person}
        initials={initials}
        badges={
          <>
            <StatusBadge kind="appointment" status={appointment.status} />
            {getTypeBadge(appointment.appointmentType)}
            {appointment.priority !== 'NORMAL' && getPriorityBadge(appointment.priority)}
          </>
        }
        facts={[
          { icon: Calendar, label: displayDate(appointment.scheduledDate) },
          {
            icon: Clock,
            label: `${formatTime(appointment.scheduledTime)} · ${appointment.duration} min`,
          },
          { icon: Stethoscope, label: getDoctorName(appointment.doctor) },
          ...(appointment.tokenNumber
            ? [{ icon: Ticket, label: `Token ${formatToken(appointment.tokenNumber)}` }]
            : []),
        ]}
        menu={[
          {
            label: 'Edit appointment',
            icon: Pencil,
            onSelect: () => router.push(trail.to(`/appointments/${id}/edit`)),
          },
          /*
            Marking somebody absent belongs here as much as cancelling does.
            It was only ever on the list screen, so a receptionist who had
            opened the appointment to deal with a patient who had not arrived
            had to navigate back to the list to say so — and the no-show rate
            this application uses to decide who gets an extra reminder is built
            from exactly this action. Not before the appointment has started:
            nobody has failed to attend something that has not begun.
          */
          ...(canNoShow
            ? [
                {
                  label: 'Mark as no-show',
                  icon: UserX,
                  onSelect: handleNoShow,
                  disabled: actionLoading,
                },
              ]
            : []),
          ...(canCancel
            ? [
                {
                  label: 'Cancel appointment',
                  icon: Trash2,
                  onSelect: handleCancel,
                  destructive: true,
                  disabled: actionLoading,
                },
              ]
            : []),
        ]}
        actions={
          <>
            {appointment.status === 'SCHEDULED' && (
              <Button
                variant="outline"
                onClick={() => handleStatusChange('CONFIRMED')}
                disabled={actionLoading}
              >
                <CheckCircle className="h-4 w-4" />
                Confirm
              </Button>
            )}
            {['SCHEDULED', 'CONFIRMED'].includes(appointment.status) && (
              <Button onClick={handleCheckIn} disabled={actionLoading}>
                <LogIn className="h-4 w-4" />
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
                <Stethoscope className="h-4 w-4" />
                Call in
              </Button>
            )}
            {/* What was done at this visit, recorded against it (bug report 16
              Oct, finding 26). The link is what the visit's Treatments card,
              the invoice's "This visit" tag and the unbilled-treatments filter
              read. A walk-in has no patient record to hold a treatment yet. */}
            {canRecordTreatment &&
              appointment.patient &&
              ['IN_PROGRESS', 'COMPLETED'].includes(appointment.status) && (
                <Button variant="outline" asChild>
                  <Link
                    href={trail.to(
                      `/treatments/new?appointmentId=${appointment.id}&patientId=${appointment.patient.id}`
                    )}
                  >
                    <ClipboardPlus className="h-4 w-4" />
                    Record treatment
                  </Link>
                </Button>
              )}
            {['CHECKED_IN', 'IN_PROGRESS'].includes(appointment.status) && (
              <Button onClick={handleCheckOut} disabled={actionLoading}>
                <LogOut className="h-4 w-4" />
                Check out
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
                  <Receipt className="h-4 w-4" />
                  Create invoice
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Where the visit has got to, the way a ride or a delivery shows
              its progress; or, for one that did not happen, why. */}
          {ended ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600/10">
                {appointment.status === 'NO_SHOW' ? (
                  <UserX className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="font-semibold">
                  {appointment.status === 'NO_SHOW'
                    ? 'The patient did not attend'
                    : appointment.status === 'RESCHEDULED'
                      ? 'Rescheduled'
                      : `Cancelled${appointment.cancelledAt ? ` on ${displayDateTime(appointment.cancelledAt)}` : ''}`}
                </p>
                {appointment.cancellationReason && (
                  <p className="mt-0.5">Reason: {appointment.cancellationReason}</p>
                )}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="p-6">
                <VisitProgress appointment={appointment} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Visit details</CardTitle>
              <CardDescription>Booked on {displayDate(appointment.createdAt)}</CardDescription>
            </CardHeader>
            <CardContent>
              <InfoGrid className="lg:grid-cols-3">
                <InfoItem label="Date">{displayDate(appointment.scheduledDate)}</InfoItem>
                <InfoItem label="Time">{formatTime(appointment.scheduledTime)}</InfoItem>
                <InfoItem label="Duration">{appointment.duration} minutes</InfoItem>
                <InfoItem label="Type">{getTypeBadge(appointment.appointmentType)}</InfoItem>
                <InfoItem label="Priority">{getPriorityBadge(appointment.priority)}</InfoItem>
                <InfoItem label="Token">
                  {appointment.tokenNumber ? (
                    <span className="tabular-nums">
                      {formatToken(appointment.tokenNumber)}{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({appointment.tokenNumber})
                      </span>
                    </span>
                  ) : (
                    <span className="font-normal text-muted-foreground">Issued at check-in</span>
                  )}
                </InfoItem>
                {appointment.chiefComplaint && (
                  <InfoItem label="Chief complaint" className="sm:col-span-2 lg:col-span-3">
                    <span className="whitespace-pre-wrap font-normal">
                      {appointment.chiefComplaint}
                    </span>
                  </InfoItem>
                )}
                {appointment.notes && (
                  <InfoItem label="Notes" className="sm:col-span-2 lg:col-span-3">
                    <span className="whitespace-pre-wrap font-normal">{appointment.notes}</span>
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Treatments</CardTitle>
              <CardDescription>What was done at this visit</CardDescription>
            </CardHeader>
            <CardContent>
              {appointment.treatments.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                  No treatments recorded yet.
                </p>
              ) : (
                // The work done at this appointment, each opening its own
                // record. These were plain boxes: the treatment they named had
                // a page, and the only way to reach it was the treatments list
                // and a search.
                <LinkList>
                  {appointment.treatments.map((treatment) => (
                    <LinkRow
                      key={treatment.id}
                      href={trail.to(`/treatments/${treatment.id}`)}
                      icon={FileText}
                      title={treatment.procedure.name}
                      subtitle={treatment.treatmentNo}
                      trailing={<StatusBadge kind="treatment" status={treatment.status} />}
                    />
                  ))}
                </LinkList>
              )}
            </CardContent>
          </Card>

          {/* Billing: the invoices raised for this visit. Only for those who
              may read billing — the route leaves them out otherwise. */}
          {appointment.invoices !== undefined && appointment.patient && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Billing</CardTitle>
              </CardHeader>
              <CardContent>
                {appointment.invoices.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                    No invoice raised for this visit.
                  </p>
                ) : (
                  <LinkList>
                    {appointment.invoices.map((invoice) => (
                      <LinkRow
                        key={invoice.id}
                        href={trail.to(`/billing/invoices/${invoice.id}`)}
                        icon={Receipt}
                        title={invoice.invoiceNo}
                        subtitle={
                          formatCurrency(Number(invoice.totalAmount)) +
                          (invoice.status !== 'CANCELLED' && Number(invoice.balanceAmount) > 0
                            ? ` · ${formatCurrency(Number(invoice.balanceAmount))} due`
                            : '')
                        }
                        trailing={<StatusBadge kind="invoice" status={invoice.status} />}
                      />
                    ))}
                  </LinkList>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Who this appointment is for — a registered patient, or a walk-in
              the clinic has not registered. Both get a card; only one has a
              record behind it. */}
          {appointment.patient ? (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Patient</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <Link
                  href={trail.to(`/patients/${appointment.patient.id}`)}
                  className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{person}</span>
                    <span className="block text-xs text-muted-foreground">
                      {appointment.patient.patientId}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <InfoGrid className="sm:grid-cols-1">
                  <InfoItem label="Phone" icon={Phone}>
                    {formatPhone(appointment.patient.phone)}
                  </InfoItem>
                  {appointment.patient.email && (
                    <InfoItem label="Email" icon={Mail}>
                      {appointment.patient.email}
                    </InfoItem>
                  )}
                  {(appointment.patient.address || appointment.patient.city) && (
                    <InfoItem label="Address" icon={MapPin}>
                      {[appointment.patient.address, appointment.patient.city]
                        .filter(Boolean)
                        .join(', ')}
                    </InfoItem>
                  )}
                </InfoGrid>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Walk-in</CardTitle>
                <CardDescription>
                  Not registered. Nothing clinical can be recorded against a walk-in.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <InfoGrid className="sm:grid-cols-1">
                  <InfoItem label="Name">{appointment.visitor?.name ?? 'Unknown'}</InfoItem>
                  {appointment.visitor?.phone && (
                    <InfoItem label="Phone" icon={Phone}>
                      {formatPhone(appointment.visitor.phone)}
                    </InfoItem>
                  )}
                </InfoGrid>
                {appointment.visitor && (
                  <Button className="w-full" asChild>
                    <Link href={trail.to(`/walk-ins/${appointment.visitor.id}`)}>
                      <UserPlus className="h-4 w-4" />
                      Register as a patient
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {appointment.patient?.medicalHistory && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Medical alerts</CardTitle>
              </CardHeader>
              <CardContent>
                {/*
                  Named the alerts rather than four hardcoded badges. Those
                  badges could only ever show the four conditions somebody
                  picked in advance — a patient on warfarin got no badge at all.
                */}
                {(() => {
                  const alerts = medicalAlerts(appointment.patient.medicalHistory)
                  const meds = appointment.patient.medicalHistory.currentMedications
                  if (alerts.length === 0 && meds.length === 0) {
                    return <p className="text-sm text-muted-foreground">Nothing recorded.</p>
                  }
                  return (
                    <div className="space-y-3">
                      {alerts.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {alerts.map((alert, i) => (
                            <Badge key={i} variant={alert.tone === 'danger' ? 'danger' : 'warning'}>
                              {alert.label}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {meds.length > 0 && (
                        <InfoItem label="Current medications">{meds.join(', ')}</InfoItem>
                      )}
                    </div>
                  )
                })()}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Care team</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Dentist">
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
                  {appointment.doctor.specialization && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {appointment.doctor.specialization}
                    </span>
                  )}
                </InfoItem>
                {appointment.doctor.phone && (
                  <InfoItem label="Dentist's phone" icon={Phone}>
                    {formatPhone(appointment.doctor.phone)}
                  </InfoItem>
                )}
                {appointment.assistant && (
                  <InfoItem label="Assistant">
                    {canReadStaff ? (
                      <Link
                        href={trail.to(`/staff/${appointment.assistant.id}`)}
                        className="hover:underline"
                      >
                        {appointment.assistant.firstName} {appointment.assistant.lastName}
                      </Link>
                    ) : (
                      `${appointment.assistant.firstName} ${appointment.assistant.lastName}`
                    )}
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>
        </div>
      </div>

      {ConfirmDialogComponent}
    </div>
  )
}

const VISIT_STEPS = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED']

/**
 * The visit as a row of steps, booked to checked out, with the time each was
 * reached where the record keeps one — where it has got to at a glance, as a
 * ride or a parcel shows its progress, instead of a status word to decode.
 */
function VisitProgress({ appointment }: { appointment: Appointment }) {
  const reached = VISIT_STEPS.indexOf(appointment.status)
  const steps = [
    { label: 'Booked', detail: displayDate(appointment.createdAt) },
    { label: 'Confirmed', detail: null },
    {
      label: 'Checked in',
      detail: appointment.checkedInAt ? displayTime(appointment.checkedInAt) : null,
    },
    {
      label: 'In the chair',
      detail:
        appointment.waitTime !== null && appointment.waitTime > 0
          ? `after ${appointment.waitTime} min wait`
          : null,
    },
    {
      label: 'Checked out',
      detail: appointment.checkedOutAt ? displayTime(appointment.checkedOutAt) : null,
    },
  ]
  return (
    <ol className="flex items-start" aria-label="Visit progress">
      {steps.map((step, index) => {
        const done = index <= reached
        const next = index === reached + 1
        return (
          <li key={step.label} className="relative flex flex-1 flex-col items-center text-center">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={`absolute top-[13px] h-0.5 rounded-full ${done ? 'bg-primary' : 'bg-border'}`}
                // From the edge of the previous circle to the edge of this one.
                style={{ left: 'calc(-50% + 18px)', right: 'calc(50% + 18px)' }}
              />
            )}
            <span
              className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : next
                    ? 'border-primary bg-card text-primary ring-4 ring-primary/15'
                    : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {done ? <CheckCircle className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={`mt-2 text-xs font-semibold sm:text-sm ${done || next ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {step.label}
              <span className="sr-only">{done ? ' (done)' : next ? ' (next)' : ''}</span>
            </span>
            {done && step.detail && (
              <span className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
                {step.detail}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
