'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useCan } from '@/hooks/use-can'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  Calendar,
  Clock,
  Stethoscope,
  FileText,
  Play,
  CheckCircle,
  XCircle,
  ClipboardList,
  Edit,
  Printer,
  AlertCircle,
  Pill,
  Receipt,
  Lock,
  PenLine,
  History,
} from 'lucide-react'
import { VoiceInput } from '@/components/clinical/voice-input'
import {
  treatmentStatusConfig,
  procedureCategoryConfig,
  formatCurrency,
  formatDate,
  formatDateTime,
  parseToothNumbers,
  toothNames,
} from '@/lib/treatment-utils'
import { BackLink, useTrail } from '@/components/ui/trail'
import { groupTeeth } from '@/lib/teeth'
import { newInvoiceHref } from '@/lib/invoice-links'

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
  const router = useRouter()
  const [treatment, setTreatment] = useState<Treatment | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(treatment?.treatmentNo ?? null)
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false)
  const [signDialogOpen, setSignDialogOpen] = useState(false)
  const [addendumOpen, setAddendumOpen] = useState(false)
  const [addendumText, setAddendumText] = useState('')
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  // Only the treating dentist may sign (bug report 12 Oct, finding 12), so the
  // button is offered to them alone. The route enforces it either way.
  const { data: session } = useSession()
  const myStaffId = session?.user?.staffId
  // Prescribing is a dentist's act, the same capability as signing.
  const canPrescribe = useCan('clinical:sign') === true
  // Raising an invoice is the desk's act; the button is for those who may.
  const canBill = useCan('billing:write') === true
  const [actionLoading, setActionLoading] = useState(false)

  // Complete form state
  const [completeFormData, setCompleteFormData] = useState({
    procedureNotes: '',
    materialsUsed: '',
    complications: '',
    followUpRequired: false,
    followUpDate: '',
  })

  const fetchTreatment = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/treatments/${id}`)
      if (!response.ok) throw new Error('Failed to fetch treatment')
      const data = await response.json()
      setTreatment(data)

      // Pre-fill complete form with existing data
      setCompleteFormData({
        procedureNotes: data.procedureNotes || '',
        materialsUsed: data.materialsUsed || '',
        complications: data.complications || '',
        followUpRequired: data.followUpRequired || false,
        followUpDate: data.followUpDate ? data.followUpDate.split('T')[0] : '',
      })
    } catch (error) {
      console.error('Error fetching treatment:', error)
      toast({ variant: 'destructive', title: 'Could not load the treatment' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTreatment()
  }, [id])

  const handleStartTreatment = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/treatments/${id}/start`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to start treatment')
      fetchTreatment()
    } catch (error) {
      console.error('Error starting treatment:', error)
      toast({ variant: 'destructive', title: 'Could not start the treatment' })
    } finally {
      setActionLoading(false)
    }
  }

  const handleCompleteTreatment = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/treatments/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(completeFormData),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Failed to complete treatment')
      setCompleteDialogOpen(false)
      // A recall this procedure is the visit for has moved on with it; say
      // where to, so the desk does not press Mark as done a second time.
      const moved: { name: string; dueDate: string }[] = result.recallsMoved ?? []
      if (moved.length > 0) {
        toast({
          title: 'Treatment completed',
          description: moved
            .map((recall) => `${recall.name} recall now due ${formatDate(recall.dueDate)}`)
            .join('. '),
        })
      }
      fetchTreatment()
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not complete the treatment',
        description: error.message,
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleSignTreatment = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/treatments/${id}/sign`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to sign the treatment')
      setSignDialogOpen(false)
      fetchTreatment()
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not sign the treatment',
        description: error.message,
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleAddAddendum = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/treatments/${id}/addenda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: addendumText }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to add the addendum')
      setAddendumOpen(false)
      setAddendumText('')
      fetchTreatment()
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not add the addendum',
        description: error.message,
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelTreatment = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/treatments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      // The route's own reason: a billed treatment is refused with the
      // invoice to deal with first, and that is what the desk needs to read.
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Failed to cancel treatment')
      setCancelDialogOpen(false)
      fetchTreatment()
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not cancel the treatment',
        description: error.message,
      })
    } finally {
      setActionLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const config = treatmentStatusConfig[status] || {
      label: status,
      color: 'text-foreground',
      bgColor: 'bg-muted',
    }
    return (
      <Badge className={`${config.bgColor} ${config.color} border-0 text-sm`}>{config.label}</Badge>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (!treatment) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Treatment not found</p>
        <Button variant="outline" asChild>
          <Link href="/treatments">Back to Treatments</Link>
        </Button>
      </div>
    )
  }

  const teeth = treatment.toothNumbers ? parseToothNumbers(treatment.toothNumbers) : []
  // Work that has been done, or is under way, and that no live invoice
  // carries yet — the same test as the unbilled list on New Invoice.
  const billable =
    (treatment.status === 'COMPLETED' || treatment.status === 'IN_PROGRESS') && !treatment.billedOn

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <BackLink trail={trail} fallback="/treatments" fallbackLabel="Treatments" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="page-title">{treatment.treatmentNo}</h1>
              {getStatusBadge(treatment.status)}
            </div>
            <p className="text-muted-foreground">Created on {formatDate(treatment.createdAt)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {treatment.status === 'PLANNED' && (
            <Button onClick={handleStartTreatment} disabled={actionLoading}>
              <Play className="h-4 w-4 mr-2" />
              Start Treatment
            </Button>
          )}
          {treatment.status === 'IN_PROGRESS' && (
            <Button onClick={() => setCompleteDialogOpen(true)}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Complete Treatment
            </Button>
          )}
          {treatment.status === 'COMPLETED' &&
            !treatment.signedAt &&
            (!myStaffId || myStaffId === treatment.doctor.id) && (
              <Button onClick={() => setSignDialogOpen(true)}>
                <PenLine className="h-4 w-4 mr-2" />
                Sign Note
              </Button>
            )}
          {treatment.signedAt && (
            <Button variant="outline" onClick={() => setAddendumOpen(true)}>
              <FileText className="h-4 w-4 mr-2" />
              Add Addendum
            </Button>
          )}
          {!treatment.signedAt &&
            treatment.status !== 'COMPLETED' &&
            treatment.status !== 'CANCELLED' && (
              <>
                <Button variant="outline" asChild>
                  <Link href={`/treatments/${id}/edit`}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Link>
                </Button>
                {/* Disabled, not hidden, while an invoice bills it: the
                    banner below says why and which invoice to deal with. */}
                <Button
                  variant="outline"
                  className="text-red-600 dark:text-red-400"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={Boolean(treatment.billedOn)}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </>
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
                <Receipt className="h-4 w-4 mr-2" />
                Bill this treatment
              </Link>
            </Button>
          )}
          {/*
            The other half of the prescription/treatment link. Extraction then
            antibiotics is the commonest pair of acts in a dental day, and it
            meant leaving this screen, finding the patient again and retyping
            the tooth. The form reads the patient, the diagnosis and the teeth
            from this treatment.
          */}
          {/* Only a dentist prescribes, so only a dentist is offered it. */}
          {canPrescribe && (
            <Button variant="outline" asChild>
              <Link href={`/prescriptions/new?treatmentId=${treatment.id}`}>
                <ClipboardList className="h-4 w-4 mr-2" />
                Prescribe
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      {/* FR-007: whether this note is locked, and who put their name to it */}
      {treatment.signedAt && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            Signed by <strong>{treatment.signedBy?.name || 'a clinician'}</strong> on{' '}
            {formatDateTime(treatment.signedAt)}. This note is locked — additions go in an addendum.
          </span>
          {treatment.amendedAt && (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200"
            >
              Amended {formatDateTime(treatment.amendedAt)}
            </Badge>
          )}
        </div>
      )}

      {/* Billed: the invoice is what the patient was charged, so it changes
          first. Shown on an open treatment, where Cancel and Edit are on offer
          and would otherwise be refused without warning. */}
      {treatment.billedOn &&
        treatment.status !== 'COMPLETED' &&
        treatment.status !== 'CANCELLED' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-200">
            <Receipt className="h-4 w-4 shrink-0" />
            <span>
              Billed on{' '}
              <Link
                href={trail.to(`/billing/invoices/${treatment.billedOn.id}`)}
                className="font-medium underline"
              >
                {treatment.billedOn.invoiceNo}
              </Link>
              . Its cost is fixed and it cannot be cancelled until that invoice is cancelled or
              edited.
            </span>
          </div>
        )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Procedure Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope className="h-5 w-5" />
                Procedure Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-lg">{treatment.procedure.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Code: {treatment.procedure.code}
                  </div>
                </div>
                <Badge
                  className={`${procedureCategoryConfig[treatment.procedure.category]?.bgColor} ${procedureCategoryConfig[treatment.procedure.category]?.color} border-0`}
                >
                  {procedureCategoryConfig[treatment.procedure.category]?.label}
                </Badge>
              </div>

              {treatment.procedure.description && (
                <p className="text-sm text-muted-foreground">{treatment.procedure.description}</p>
              )}

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Treatment Cost</div>
                  <div className="font-medium text-lg">{formatCurrency(treatment.cost)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Base Price</div>
                  <div className="font-medium">{formatCurrency(treatment.procedure.basePrice)}</div>
                </div>
              </div>

              {treatment.startTime && (
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>Started: {formatDateTime(treatment.startTime)}</span>
                  </div>
                  {treatment.endTime && (
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <span>Completed: {formatDateTime(treatment.endTime)}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Teeth Affected */}
          {teeth.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Teeth Affected</CardTitle>
              </CardHeader>
              <CardContent>
                {/*
                  By quadrant. A flat row of chips reading "13 15 25 34 44"
                  makes the reader divide each number by ten to place it, and
                  the tooth's own name was cut down to its last two words —
                  "Central Incisor" — which drops the half of it that says
                  which of the four central incisors is meant.
                */}
                <div className="space-y-3">
                  {groupTeeth(teeth).map((group) => (
                    <div key={group.key}>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {group.teeth.map((tooth) => (
                          <div key={tooth} className="rounded-lg bg-muted px-3 py-2 text-sm">
                            <span className="font-medium">{tooth}</span>
                            <span className="ml-1 text-muted-foreground">
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

          {/* Clinical Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Clinical Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {treatment.chiefComplaint && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Chief Complaint</div>
                  <p className="mt-1">{treatment.chiefComplaint}</p>
                </div>
              )}

              {treatment.diagnosis && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Diagnosis</div>
                  <p className="mt-1">{treatment.diagnosis}</p>
                </div>
              )}

              {treatment.findings && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Clinical Findings</div>
                  <p className="mt-1">{treatment.findings}</p>
                </div>
              )}

              {treatment.procedureNotes && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Procedure Notes</div>
                  <p className="mt-1">{treatment.procedureNotes}</p>
                </div>
              )}

              {treatment.materialsUsed && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Materials Used</div>
                  <p className="mt-1">{treatment.materialsUsed}</p>
                </div>
              )}

              {treatment.complications && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground text-amber-600 dark:text-amber-400">
                    Complications
                  </div>
                  <p className="mt-1">{treatment.complications}</p>
                </div>
              )}

              {!treatment.chiefComplaint &&
                !treatment.diagnosis &&
                !treatment.findings &&
                !treatment.procedureNotes && (
                  <p className="text-muted-foreground text-center py-4">
                    No clinical notes recorded
                  </p>
                )}
            </CardContent>
          </Card>

          {/* Pre/Post Instructions */}
          {(treatment.procedure.preInstructions || treatment.procedure.postInstructions) && (
            <Card>
              <CardHeader>
                <CardTitle>Instructions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {treatment.procedure.preInstructions && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      Pre-procedure Instructions
                    </div>
                    <p className="mt-1">{treatment.procedure.preInstructions}</p>
                  </div>
                )}
                {treatment.procedure.postInstructions && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      Post-procedure Instructions
                    </div>
                    <p className="mt-1">{treatment.procedure.postInstructions}</p>
                  </div>
                )}
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
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Since this note was signed
                </CardTitle>
                <CardDescription>
                  Everything added or corrected after the signature, oldest first
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {treatment.amendments.map((amendment) => (
                  <div key={amendment.id} className="rounded-lg border p-4">
                    <div className="mb-2 flex items-center gap-2">
                      {amendment.kind === 'CORRECTION' ? (
                        <Badge variant="destructive">Correction</Badge>
                      ) : (
                        <Badge variant="secondary">Addendum</Badge>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{amendment.body}</p>
                    {amendment.changes && (
                      <div className="mt-2 space-y-1">
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
                    <p className="text-muted-foreground mt-2 text-xs">
                      {amendment.author.name} · {formatDateTime(amendment.createdAt)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Patient Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Patient
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="font-medium">
                    {treatment.patient.firstName} {treatment.patient.lastName}
                  </div>
                  <div className="text-sm text-muted-foreground">{treatment.patient.patientId}</div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  {treatment.patient.phone}
                </div>
                {treatment.patient.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {treatment.patient.email}
                  </div>
                )}
                {treatment.patient.bloodGroup && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Blood Group:</span>
                    <Badge variant="outline">{treatment.patient.bloodGroup}</Badge>
                  </div>
                )}
              </div>

              <Button variant="outline" className="w-full" asChild>
                <Link href={trail.to(`/patients/${treatment.patient.id}`)}>
                  View Patient Profile
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Doctor Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope className="h-5 w-5" />
                Doctor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="font-medium">
                Dr. {treatment.doctor.firstName} {treatment.doctor.lastName}
              </div>
              {treatment.doctor.specialization && (
                <div className="text-sm text-muted-foreground">
                  {treatment.doctor.specialization}
                </div>
              )}
              {treatment.doctor.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  {treatment.doctor.phone}
                </div>
              )}
            </CardContent>
          </Card>

          {/* The plan this treatment is a step of */}
          {treatment.planItem && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Treatment Plan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="font-medium">{treatment.planItem.treatmentPlan.planNumber}</div>
                <div className="text-sm text-muted-foreground">
                  {treatment.planItem.treatmentPlan.title}
                </div>
                <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                  <Link href={trail.to(`/treatments/plans/${treatment.planItem.treatmentPlan.id}`)}>
                    View Plan
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Appointment Info */}
          {treatment.appointment && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Appointment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="font-medium">{treatment.appointment.appointmentNo}</div>
                <div className="text-sm text-muted-foreground">
                  {formatDate(treatment.appointment.scheduledDate)} at{' '}
                  {treatment.appointment.scheduledTime}
                </div>
                <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                  <Link href={trail.to(`/appointments/${treatment.appointment.id}`)}>
                    View Appointment
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Follow-up */}
          {treatment.followUpRequired && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-5 w-5" />
                  Follow-up Required
                </CardTitle>
              </CardHeader>
              <CardContent>
                {treatment.followUpDate ? (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {formatDate(treatment.followUpDate)}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Date not scheduled</p>
                )}
                {/* Booking the follow-up is the whole point of the card, and
                    this button did nothing at all. The date, when one was set,
                    is what the booking screen should open on. */}
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link
                    href={trail.to(
                      `/appointments/new?patientId=${treatment.patient.id}` +
                        (treatment.followUpDate
                          ? `&date=${String(treatment.followUpDate).slice(0, 10)}`
                          : '')
                    )}
                    className="block mt-4"
                  >
                    Schedule Follow-up
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Prescriptions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Pill className="h-5 w-5" />
                Prescriptions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Prescriptions are written for the patient rather than for one treatment.
              </p>
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link
                  href={trail.to(`/prescriptions?patientId=${treatment.patient.id}`)}
                  className="block mt-4"
                >
                  Prescriptions for {treatment.patient.firstName}
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Invoices */}
          {treatment.invoiceItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  Billing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* This was a count and a button that did nothing. The invoice
                    each line belongs to is already on the response. */}
                {treatment.invoiceItems.map((item) =>
                  item.invoice ? (
                    <Link
                      key={item.id}
                      href={trail.to(`/billing/invoices/${item.invoice.id}`)}
                      className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-accent transition-colors"
                    >
                      <span className="font-medium">{item.invoice.invoiceNo}</span>
                      <Badge variant="outline">{item.invoice.status}</Badge>
                    </Link>
                  ) : null
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Complete Treatment Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Complete Treatment</DialogTitle>
            <DialogDescription>Add final notes and complete this treatment.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="procedureNotes">Procedure Notes</Label>
                <VoiceInput
                  onTranscript={(text) =>
                    setCompleteFormData((prev) => ({
                      ...prev,
                      procedureNotes: prev.procedureNotes ? prev.procedureNotes + ' ' + text : text,
                    }))
                  }
                />
              </div>
              <Textarea
                id="procedureNotes"
                value={completeFormData.procedureNotes}
                onChange={(e) =>
                  setCompleteFormData({
                    ...completeFormData,
                    procedureNotes: e.target.value,
                  })
                }
                placeholder="Final procedure notes... (use mic for voice dictation)"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="materialsUsed">Materials Used</Label>
              <Textarea
                id="materialsUsed"
                value={completeFormData.materialsUsed}
                onChange={(e) =>
                  setCompleteFormData({
                    ...completeFormData,
                    materialsUsed: e.target.value,
                  })
                }
                placeholder="List materials used..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="complications">Complications (if any)</Label>
              <Textarea
                id="complications"
                value={completeFormData.complications}
                onChange={(e) =>
                  setCompleteFormData({
                    ...completeFormData,
                    complications: e.target.value,
                  })
                }
                placeholder="Document any complications..."
                rows={2}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="followUpRequired"
                checked={completeFormData.followUpRequired}
                onCheckedChange={(checked) =>
                  setCompleteFormData({
                    ...completeFormData,
                    followUpRequired: checked as boolean,
                  })
                }
              />
              <Label htmlFor="followUpRequired">Follow-up required</Label>
            </div>

            {completeFormData.followUpRequired && (
              <div className="space-y-2">
                <Label htmlFor="followUpDate">Follow-up Date</Label>
                <Input
                  id="followUpDate"
                  type="date"
                  value={completeFormData.followUpDate}
                  onChange={(e) =>
                    setCompleteFormData({
                      ...completeFormData,
                      followUpDate: e.target.value,
                    })
                  }
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCompleteTreatment} disabled={actionLoading}>
              {actionLoading ? 'Completing...' : 'Complete Treatment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign Note Dialog — deliberately spells out that this is irreversible */}
      <Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign this clinical note</DialogTitle>
            <DialogDescription>
              Signing attests that you are the treating provider for this treatment. The note is
              then locked: it cannot be deleted, and anything further goes in an addendum. A
              correction afterwards needs a reason and is recorded. There is no way to unsign.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSignTreatment} disabled={actionLoading}>
              <PenLine className="h-4 w-4 mr-2" />
              Sign and lock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Addendum Dialog */}
      <Dialog open={addendumOpen} onOpenChange={setAddendumOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an addendum</DialogTitle>
            <DialogDescription>
              Appended to the signed note, under your name. It cannot be edited or removed once
              saved.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={6}
            value={addendumText}
            onChange={(e) => setAddendumText(e.target.value)}
            placeholder="What you want to add to this note…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddendumOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddAddendum}
              disabled={actionLoading || addendumText.trim().length < 3}
            >
              Save addendum
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Treatment Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Treatment</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this treatment? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Keep Treatment
            </Button>
            <Button variant="destructive" onClick={handleCancelTreatment} disabled={actionLoading}>
              {actionLoading ? 'Cancelling...' : 'Cancel Treatment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
