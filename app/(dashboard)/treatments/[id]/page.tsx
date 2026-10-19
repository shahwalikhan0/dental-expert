'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useCan } from '@/hooks/use-can'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { LoadFailed } from '@/components/ui/load-failed'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import {
  User,
  Phone,
  Mail,
  Calendar,
  Clock,
  Stethoscope,
  FileText,
  Play,
  CheckCircle,
  Trash2,
  ClipboardList,
  Pencil,
  AlertCircle,
  Pill,
  Receipt,
  Lock,
  PenLine,
  ChevronRight,
} from 'lucide-react'
import { procedureCategoryConfig, parseToothNumbers, toothNames } from '@/lib/treatment-utils'
import { formatCurrency } from '@/lib/i18n/format'
import { displayDate, displayDateTime } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { useTrail } from '@/components/ui/trail'
import { groupTeeth } from '@/lib/teeth'
import { newInvoiceHref } from '@/lib/invoice-links'
import {
  CompleteTreatmentDialog,
  completionNotesOf,
} from '@/components/treatments/complete-treatment-dialog'
import { usePrint } from '@/hooks/use-print'
import { PrintDocument } from '@/components/print/print-document'
import { PrintButton } from '@/components/print/print-button'
import { TreatmentPrint } from '@/components/print/templates/treatment-print'

interface Treatment {
  id: string
  treatmentNo: string
  chiefComplaint: string | null
  diagnosis: string | null
  findings: string | null
  procedureNotes: string | null
  materialsUsed: string | null
  complications: string | null
  toothNumbers: string | null
  status: string
  cost: string | number
  startTime: string | null
  endTime: string | null
  followUpRequired: boolean
  followUpDate: string | null
  createdAt: string
  updatedAt: string
  signedAt: string | null
  amendedAt: string | null
  signedBy: { id: string; name: string } | null
  amendments?: {
    id: string
    kind: 'ADDENDUM' | 'CORRECTION'
    body: string
    changes: Record<string, { from: unknown; to: unknown }> | null
    createdAt: string
    author: { name: string }
  }[]
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    dateOfBirth: string | null
    gender: string | null
    bloodGroup: string | null
  }
  doctor: {
    id: string
    firstName: string
    lastName: string
    specialization: string | null
    phone: string | null
  }
  procedure: {
    id: string
    code: string
    name: string
    category: string
    description: string | null
    defaultDuration: number
    basePrice: string | number
    preInstructions: string | null
    postInstructions: string | null
  }
  appointment: {
    id: string
    appointmentNo: string
    scheduledDate: string
    scheduledTime: string
    status: string
  } | null
  /**
   * There is no Treatment–Prescription relation and the route never returned
   * one, so this page read `treatment.prescriptions.length` on `undefined` and
   * threw on every load. Prescriptions belong to the patient; the card below
   * links to theirs.
   */
  invoiceItems: Array<{
    id: string
    invoice: { id: string; invoiceNo: string; status: string; totalAmount: string | number } | null
  }>
  /**
   * The invoice that still bills this treatment — any not cancelled — or
   * null. While it stands, the cost is fixed and the treatment cannot be
   * cancelled; the route refuses both.
   */
  billedOn: { id: string; invoiceNo: string; status: string } | null
  /** The plan step this treatment carries out, when it was started from one. */
  planItem: {
    id: string
    status: string
    treatmentPlan: { id: string; planNumber: string; title: string }
  } | null
}

export default function TreatmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [treatment, setTreatment] = useState<Treatment | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(treatment?.treatmentNo ?? null)
  const [loading, setLoading] = useState(true)
  // Could not be loaded, which is not the same as not existing.
  const [failed, setFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const { toast } = useToast()
  const router = useRouter()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false)
  const [addendumOpen, setAddendumOpen] = useState(false)
  const [addendumText, setAddendumText] = useState('')
  // Only the treating dentist may sign (bug report 12 Oct, finding 12), so the
  // button is offered to them alone. The route enforces it either way.
  const { data: session } = useSession()
  const myStaffId = session?.user?.staffId
  // Prescribing is a dentist's act, the same capability as signing.
  const canPrescribe = useCan('clinical:sign') === true
  // Signing a note and adding to a signed one are the same act (`clinical:sign`).
  const canSign = canPrescribe
  // Starting, completing, editing and cancelling are `clinical:write`; the
  // manager reads the record but does not write it (bug report 16 Oct, 6).
  const canWrite = useCan('clinical:write') === true
  // Raising an invoice is the desk's act; the button is for those who may.
  const canBill = useCan('billing:write') === true
  const [actionLoading, setActionLoading] = useState(false)
  const printing = usePrint({
    documentTitle: treatment ? `Treatment ${treatment.treatmentNo}` : 'Treatment',
  })

  const fetchTreatment = async () => {
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/treatments/${id}`)
      if (response.status === 404) {
        setNotFound(true)
        return
      }
      if (!response.ok) throw new Error('Failed to fetch treatment')
      const data = await response.json()
      setTreatment(data)
    } catch (error) {
      console.error('Error fetching treatment:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTreatment()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleStartTreatment = async () => {
    if (!treatment) return
    try {
      setActionLoading(true)
      await readJson(await fetch(`/api/treatments/${id}/start`, { method: 'POST' }))
      fetchTreatment()
    } catch (error) {
      toast(toastError(`start treatment ${treatment.treatmentNo}`, error))
    } finally {
      setActionLoading(false)
    }
  }

  // Signing destroys nothing, but it cannot be undone: the standard confirm,
  // in the default tone, spelling out what it locks.
  const handleSignTreatment = async () => {
    if (!treatment) return
    const ok = await confirm({
      title: `Sign the note for treatment ${treatment.treatmentNo}?`,
      description:
        'Signing attests that you are the treating provider for this treatment. The note is then locked: it cannot be deleted, and anything further goes in an addendum. A correction afterwards needs a reason and is recorded. There is no way to unsign.',
      confirmLabel: 'Sign and lock',
      tone: 'default',
    })
    if (!ok) return
    try {
      setActionLoading(true)
      await readJson(await fetch(`/api/treatments/${id}/sign`, { method: 'POST' }))
      toast(toastSuccess(`Treatment ${treatment.treatmentNo} signed`))
      fetchTreatment()
    } catch (error) {
      toast(toastError(`sign treatment ${treatment.treatmentNo}`, error))
    } finally {
      setActionLoading(false)
    }
  }

  const handleAddAddendum = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!treatment) return
    try {
      setActionLoading(true)
      await readJson(
        await fetch(`/api/treatments/${id}/addenda`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: addendumText }),
        })
      )
      setAddendumOpen(false)
      setAddendumText('')
      toast(toastSuccess('Addendum added'))
      fetchTreatment()
    } catch (error) {
      toast(toastError(`add the addendum to ${treatment.treatmentNo}`, error))
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelTreatment = async () => {
    if (!treatment) return
    // No reason is asked for: a treatment has nowhere to keep one (there is no
    // cancellation reason on Treatment, unlike Appointment and TreatmentPlan),
    // and a reason typed only to be thrown away would be a lie to the user.
    const ok = await confirm({
      title: `Cancel treatment ${treatment.treatmentNo}?`,
      description:
        'It will be marked cancelled and cannot be reopened. A plan step it was carrying out is handed back to be started again.',
      confirmLabel: 'Cancel treatment',
      cancelLabel: 'Keep treatment',
    })
    if (!ok) return
    try {
      setActionLoading(true)
      // The route's own reason: a billed treatment is refused with the
      // invoice to deal with first, and that is what the desk needs to read.
      await readJson(
        await fetch(`/api/treatments/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'CANCELLED' }),
        })
      )
      toast(toastSuccess(`Treatment ${treatment.treatmentNo} cancelled`))
      fetchTreatment()
    } catch (error) {
      toast(toastError(`cancel treatment ${treatment.treatmentNo}`, error))
    } finally {
      setActionLoading(false)
    }
  }

  // The first load only: a reload after an action keeps the page on screen.
  if (loading && !treatment) {
    return <PageSkeleton variant="detail" />
  }

  if (notFound) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Treatment not found"
        description="It may have been deleted, or the link is wrong."
        actionLabel="Back to treatments"
        actionHref="/treatments"
      />
    )
  }

  if (failed && !treatment) {
    return <LoadFailed what="this treatment" onRetry={fetchTreatment} />
  }

  if (!treatment) return null

  const teeth = treatment.toothNumbers ? parseToothNumbers(treatment.toothNumbers) : []
  // Work that has been done, or is under way, and that no live invoice
  // carries yet — the same test as the unbilled list on New Invoice.
  const billable =
    (treatment.status === 'COMPLETED' || treatment.status === 'IN_PROGRESS') && !treatment.billedOn

  const category = procedureCategoryConfig[treatment.procedure.category]
  const patientName = `${treatment.patient.firstName} ${treatment.patient.lastName}`
  const doctorName = `Dr. ${treatment.doctor.firstName} ${treatment.doctor.lastName}`
  const editable =
    canWrite &&
    !treatment.signedAt &&
    treatment.status !== 'COMPLETED' &&
    treatment.status !== 'CANCELLED'
  const hasNotes = Boolean(
    treatment.chiefComplaint ||
    treatment.diagnosis ||
    treatment.findings ||
    treatment.procedureNotes ||
    treatment.materialsUsed ||
    treatment.complications
  )
  const invoices = treatment.invoiceItems.filter((item) => item.invoice)

  return (
    <div className="space-y-6">
      {/* What goes on paper: a template, not this page. */}
      <PrintDocument printing={printing}>
        <TreatmentPrint treatment={treatment} />
      </PrintDocument>

      {/*
        The treatment as a record card: what was done, to whom, by whom, then
        the one step it is waiting for as the primary button. Editing and
        cancelling are rarer and sit behind "More"; cancelling stays visible
        but disabled while an invoice bills it, and the banner below says why.
      */}
      <ProfileHeader
        eyebrow={treatment.treatmentNo}
        name={treatment.procedure.name}
        avatarIcon={Stethoscope}
        badges={
          <>
            <StatusBadge kind="treatment" status={treatment.status} />
            {category && (
              <Badge variant="outline" className={`${category.bgColor} ${category.color} border-0`}>
                {category.label}
              </Badge>
            )}
          </>
        }
        facts={[
          { icon: User, label: patientName },
          { icon: Stethoscope, label: doctorName },
          { icon: Calendar, label: displayDate(treatment.createdAt) },
          { icon: Receipt, label: formatCurrency(treatment.cost) },
        ]}
        menu={
          editable
            ? [
                {
                  label: 'Edit treatment',
                  icon: Pencil,
                  onSelect: () => router.push(trail.to(`/treatments/${id}/edit`)),
                },
                {
                  label: 'Cancel treatment',
                  icon: Trash2,
                  onSelect: handleCancelTreatment,
                  destructive: true,
                  disabled: Boolean(treatment.billedOn) || actionLoading,
                },
              ]
            : []
        }
        actions={
          <>
            <PrintButton printing={printing} />
            {/*
              The other half of the prescription/treatment link. Extraction then
              antibiotics is the commonest pair of acts in a dental day, and it
              meant leaving this screen, finding the patient again and retyping
              the tooth. The form reads the patient, the diagnosis and the teeth
              from this treatment. Only those who can prescribe
              (`clinical:sign`) are offered it.
            */}
            {canPrescribe && (
              <Button variant="outline" asChild>
                <Link href={trail.to(`/prescriptions/new?treatmentId=${treatment.id}`)}>
                  <ClipboardList className="h-4 w-4" />
                  Prescribe
                </Link>
              </Button>
            )}
            {/* "Bill this" (review 4.1). New Invoice opens on this patient with
                this treatment ticked; the rest of their unbilled work is there
                to add. */}
            {canBill && billable && (
              <Button variant="outline" asChild>
                <Link
                  href={trail.to(
                    newInvoiceHref({
                      patientId: treatment.patient.id,
                      treatmentIds: [treatment.id],
                    })
                  )}
                >
                  <Receipt className="h-4 w-4" />
                  Bill
                </Link>
              </Button>
            )}
            {canSign && treatment.signedAt && (
              <Button variant="outline" onClick={() => setAddendumOpen(true)}>
                <FileText className="h-4 w-4" />
                Add addendum
              </Button>
            )}
            {canWrite && treatment.status === 'PLANNED' && (
              <SubmitButton
                type="button"
                onClick={handleStartTreatment}
                busy={actionLoading}
                busyLabel="Starting…"
                icon={Play}
              >
                Start treatment
              </SubmitButton>
            )}
            {canWrite && treatment.status === 'IN_PROGRESS' && (
              <Button onClick={() => setCompleteDialogOpen(true)}>
                <CheckCircle className="h-4 w-4" />
                Complete treatment…
              </Button>
            )}
            {canSign &&
              treatment.status === 'COMPLETED' &&
              !treatment.signedAt &&
              (!myStaffId || myStaffId === treatment.doctor.id) && (
                <Button onClick={handleSignTreatment} disabled={actionLoading}>
                  <PenLine className="h-4 w-4" />
                  Sign note
                </Button>
              )}
          </>
        }
      />

      {/* FR-007: whether this note is locked, and who put their name to it */}
      {treatment.signedAt && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600/10">
            <Lock className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            Signed by <strong>{treatment.signedBy?.name || 'a clinician'}</strong> on{' '}
            {displayDateTime(treatment.signedAt)}. This note is locked — additions go in an
            addendum.
          </span>
          {treatment.amendedAt && (
            <Badge variant="warning">Amended {displayDateTime(treatment.amendedAt)}</Badge>
          )}
        </div>
      )}

      {/* Billed: the invoice is what the patient was charged, so it changes
          first. Shown on an open treatment, where Cancel and Edit are on offer
          and would otherwise be refused without warning. */}
      {treatment.billedOn &&
        treatment.status !== 'COMPLETED' &&
        treatment.status !== 'CANCELLED' && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-200">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600/10">
              <Receipt className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              Billed on{' '}
              <Link
                href={trail.to(`/billing/invoices/${treatment.billedOn.id}`)}
                className="font-semibold underline underline-offset-2"
              >
                {treatment.billedOn.invoiceNo}
              </Link>
              . Its cost is fixed and it cannot be cancelled until that invoice is cancelled or
              edited.
            </span>
          </div>
        )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Procedure</CardTitle>
              {treatment.procedure.description && (
                <CardDescription>{treatment.procedure.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <InfoGrid className="lg:grid-cols-3">
                <InfoItem label="Procedure">{treatment.procedure.name}</InfoItem>
                <InfoItem label="Code">{treatment.procedure.code}</InfoItem>
                <InfoItem label="Category">{category?.label}</InfoItem>
                <InfoItem label="Treatment cost">
                  <span className="text-base font-semibold">{formatCurrency(treatment.cost)}</span>
                </InfoItem>
                <InfoItem label="Base price">
                  {formatCurrency(treatment.procedure.basePrice)}
                </InfoItem>
                <InfoItem label="Usual duration">
                  {treatment.procedure.defaultDuration
                    ? `${treatment.procedure.defaultDuration} min`
                    : null}
                </InfoItem>
                <InfoItem label="Started" icon={Clock}>
                  {treatment.startTime ? displayDateTime(treatment.startTime) : null}
                </InfoItem>
                <InfoItem label="Completed" icon={CheckCircle}>
                  {treatment.endTime ? displayDateTime(treatment.endTime) : null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          {teeth.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Teeth affected</CardTitle>
              </CardHeader>
              <CardContent>
                {/*
                  By quadrant. A flat row of chips reading "13 15 25 34 44"
                  makes the reader divide each number by ten to place it, and
                  the tooth's own name was cut down to its last two words —
                  "Central Incisor" — which drops the half of it that says
                  which of the four central incisors is meant.
                */}
                <div className="grid gap-4 sm:grid-cols-2">
                  {groupTeeth(teeth).map((group) => (
                    <div key={group.key}>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {group.teeth.map((tooth) => (
                          <div
                            key={tooth}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 py-1 pl-1 pr-3 text-sm"
                          >
                            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">
                              {tooth}
                            </span>
                            <span className="text-muted-foreground">
                              {/* Every name starts with its quadrant; the heading already said it. */}
                              {toothNames[tooth]?.split(' ').slice(2).join(' ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Clinical notes</CardTitle>
            </CardHeader>
            <CardContent>
              {hasNotes ? (
                <InfoGrid className="sm:grid-cols-1">
                  {treatment.chiefComplaint && (
                    <InfoItem label="Chief complaint">
                      <span className="whitespace-pre-wrap font-normal">
                        {treatment.chiefComplaint}
                      </span>
                    </InfoItem>
                  )}
                  {treatment.diagnosis && (
                    <InfoItem label="Diagnosis">
                      <span className="whitespace-pre-wrap font-normal">{treatment.diagnosis}</span>
                    </InfoItem>
                  )}
                  {treatment.findings && (
                    <InfoItem label="Clinical findings">
                      <span className="whitespace-pre-wrap font-normal">{treatment.findings}</span>
                    </InfoItem>
                  )}
                  {treatment.procedureNotes && (
                    <InfoItem label="Procedure notes">
                      <span className="whitespace-pre-wrap font-normal">
                        {treatment.procedureNotes}
                      </span>
                    </InfoItem>
                  )}
                  {treatment.materialsUsed && (
                    <InfoItem label="Materials used">
                      <span className="whitespace-pre-wrap font-normal">
                        {treatment.materialsUsed}
                      </span>
                    </InfoItem>
                  )}
                  {treatment.complications && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/30">
                      <InfoItem label="Complications" icon={AlertCircle}>
                        <span className="whitespace-pre-wrap font-normal text-amber-900 dark:text-amber-200">
                          {treatment.complications}
                        </span>
                      </InfoItem>
                    </div>
                  )}
                </InfoGrid>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No clinical notes recorded.
                </p>
              )}
            </CardContent>
          </Card>

          {(treatment.procedure.preInstructions || treatment.procedure.postInstructions) && (
            <Card>
              <CardHeader>
                <CardTitle>Instructions</CardTitle>
                <CardDescription>From the procedure catalogue</CardDescription>
              </CardHeader>
              <CardContent>
                <InfoGrid>
                  {treatment.procedure.preInstructions && (
                    <InfoItem label="Before the procedure">
                      <span className="whitespace-pre-wrap font-normal">
                        {treatment.procedure.preInstructions}
                      </span>
                    </InfoItem>
                  )}
                  {treatment.procedure.postInstructions && (
                    <InfoItem label="After the procedure">
                      <span className="whitespace-pre-wrap font-normal">
                        {treatment.procedure.postInstructions}
                      </span>
                    </InfoItem>
                  )}
                </InfoGrid>
              </CardContent>
            </Card>
          )}

          {/*
            FR-007's "later amendments", additions and corrections in one list.
            They were two cards, which meant reading a signed note in date order
            required looking at two places and merging them by eye — and the two
            interleave constantly, because a correction is usually followed by an
            addendum explaining it.
          */}
          {treatment.amendments && treatment.amendments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Since this note was signed</CardTitle>
                <CardDescription>
                  Everything added or corrected after the signature, oldest first
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="relative space-y-5 border-l border-border pl-6">
                  {treatment.amendments.map((amendment) => (
                    <li key={amendment.id} className="relative">
                      <span
                        aria-hidden="true"
                        className={`absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card ${amendment.kind === 'CORRECTION' ? 'bg-destructive' : 'bg-primary'}`}
                      />
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        {amendment.kind === 'CORRECTION' ? (
                          <Badge variant="danger">Correction</Badge>
                        ) : (
                          <Badge variant="secondary">Addendum</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {amendment.author.name} · {displayDateTime(amendment.createdAt)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{amendment.body}</p>
                      {amendment.changes && (
                        <div className="mt-2 space-y-1 rounded-xl bg-muted/60 px-3 py-2">
                          {Object.entries(amendment.changes).map(([field, change]) => (
                            <div key={field} className="text-sm">
                              <span className="text-muted-foreground">{field}: </span>
                              <span className="text-red-700 line-through dark:text-red-300">
                                {String(change.from ?? '—')}
                              </span>
                              <span className="text-muted-foreground"> → </span>
                              <span className="text-emerald-700 dark:text-emerald-300">
                                {String(change.to ?? '—')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Follow-up first on this side: it is the one thing here still to do. */}
          {treatment.followUpRequired && (
            <Card className="border-amber-200 dark:border-amber-800/60">
              <CardHeader className="pb-4">
                <CardTitle className="text-amber-700 dark:text-amber-400">
                  Follow-up required
                </CardTitle>
                <CardDescription>
                  {treatment.followUpDate
                    ? `Due ${displayDate(treatment.followUpDate)}`
                    : 'No date set yet.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Booking the follow-up is the whole point of the card. The
                    date, when one was set, is what the booking screen should
                    open on. */}
                <Button className="w-full" asChild>
                  <Link
                    href={trail.to(
                      `/appointments/new?patientId=${treatment.patient.id}` +
                        (treatment.followUpDate
                          ? `&date=${String(treatment.followUpDate).slice(0, 10)}`
                          : '')
                    )}
                  >
                    <Calendar className="h-4 w-4" />
                    Schedule follow-up
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Link
                href={trail.to(`/patients/${treatment.patient.id}`)}
                className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {`${treatment.patient.firstName.charAt(0)}${treatment.patient.lastName.charAt(0)}`.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{patientName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {treatment.patient.patientId}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Phone" icon={Phone}>
                  {formatPhone(treatment.patient.phone)}
                </InfoItem>
                {treatment.patient.email && (
                  <InfoItem label="Email" icon={Mail}>
                    {treatment.patient.email}
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Dentist</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Name">{doctorName}</InfoItem>
                {treatment.doctor.specialization && (
                  <InfoItem label="Specialisation">{treatment.doctor.specialization}</InfoItem>
                )}
                {treatment.doctor.phone && (
                  <InfoItem label="Phone" icon={Phone}>
                    {formatPhone(treatment.doctor.phone)}
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          {/* Everything this treatment links to, one row each. Prescriptions
              belong to the patient rather than to one treatment, so that row
              opens theirs. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Related</CardTitle>
            </CardHeader>
            <CardContent>
              <LinkList>
                {treatment.planItem && (
                  <LinkRow
                    href={trail.to(`/treatments/plans/${treatment.planItem.treatmentPlan.id}`)}
                    icon={FileText}
                    title={treatment.planItem.treatmentPlan.title}
                    subtitle={`Treatment plan · ${treatment.planItem.treatmentPlan.planNumber}`}
                  />
                )}
                {treatment.appointment && (
                  <LinkRow
                    href={trail.to(`/appointments/${treatment.appointment.id}`)}
                    icon={Calendar}
                    title={treatment.appointment.appointmentNo}
                    subtitle={`${displayDate(treatment.appointment.scheduledDate)} at ${treatment.appointment.scheduledTime}`}
                  />
                )}
                {invoices.map((item) =>
                  item.invoice ? (
                    <LinkRow
                      key={item.id}
                      href={trail.to(`/billing/invoices/${item.invoice.id}`)}
                      icon={Receipt}
                      title={item.invoice.invoiceNo}
                      subtitle="Invoice"
                      trailing={<StatusBadge kind="invoice" status={item.invoice.status} />}
                    />
                  ) : null
                )}
                <LinkRow
                  href={trail.to(`/prescriptions?patientId=${treatment.patient.id}`)}
                  icon={Pill}
                  title="Prescriptions"
                  subtitle={`All of ${treatment.patient.firstName}'s prescriptions`}
                />
              </LinkList>
            </CardContent>
          </Card>
        </div>
      </div>

      <CompleteTreatmentDialog
        treatment={completeDialogOpen ? treatment : null}
        initial={completionNotesOf(treatment)}
        onClose={() => setCompleteDialogOpen(false)}
        onCompleted={fetchTreatment}
      />

      {/* Addendum */}
      <Dialog open={addendumOpen} onOpenChange={setAddendumOpen}>
        <DialogContent size="md">
          <form onSubmit={handleAddAddendum} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add an addendum to {treatment.treatmentNo}</DialogTitle>
              <DialogDescription>
                Appended to the signed note, under your name. It cannot be edited or removed once
                saved.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Addendum" required hint="At least 3 characters.">
              {(control) => (
                <Textarea
                  {...control}
                  rows={6}
                  value={addendumText}
                  onChange={(e) => setAddendumText(e.target.value)}
                  placeholder="What you want to add to this note…"
                />
              )}
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddendumOpen(false)}>
                Cancel
              </Button>
              <SubmitButton
                busy={actionLoading}
                busyLabel="Saving…"
                disabled={addendumText.trim().length < 3}
              >
                Save addendum
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  )
}
