'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  User,
  Phone,
  Mail,
  FileText,
  CheckCircle,
  Pencil,
  Printer,
  Play,
  ClipboardCheck,
  Trash2,
} from 'lucide-react'
import { procedureCategoryConfig, calculatePlanProgress } from '@/lib/treatment-utils'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { describeTeethByQuadrant, parseTeeth } from '@/lib/teeth'
import { planIsFinished } from '@/lib/treatment-plan-status'
import { groupByPhase } from '@/lib/treatment-phases'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { usePrint } from '@/hooks/use-print'
import { PrintDocument } from '@/components/print/print-document'
import { PrintButton } from '@/components/print/print-button'
import { PlanEstimatePrint } from '@/components/print/templates/plan-estimate-print'

interface TreatmentPlanItem {
  id: string
  phase: number
  priority: number
  toothNumbers: string | null
  estimatedCost: string | number
  notes: string | null
  status: string
  /** The treatment carrying this step out, once one has been started from it. */
  treatment: { id: string; treatmentNo: string; status: string } | null
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
}

interface TreatmentPlan {
  id: string
  planNumber: string
  title: string
  notes: string | null
  status: string
  estimatedCost: string | number
  estimatedDuration: number | null
  startDate: string | null
  expectedEndDate: string | null
  completedDate: string | null
  consentGiven: boolean
  consentDate: string | null
  phaseNames: string[] | null
  createdAt: string
  updatedAt: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    dateOfBirth: string | null
    gender: string | null
  }
  items: TreatmentPlanItem[]
}

/** What each status change is called once it has happened. */
const STATUS_DONE: Record<string, string> = {
  PROPOSED: 'Treatment plan proposed',
  IN_PROGRESS: 'Treatment plan started',
  COMPLETED: 'Treatment plan completed',
  CANCELLED: 'Treatment plan cancelled',
}

export default function TreatmentPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [plan, setPlan] = useState<TreatmentPlan | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(plan?.planNumber ?? null)
  const [loading, setLoading] = useState(true)
  // Why there is no plan to show: the route said 404, or the fetch failed.
  const [loadState, setLoadState] = useState<'ok' | 'missing' | 'failed'>('ok')
  const [actionLoading, setActionLoading] = useState(false)
  const [consentDialogOpen, setConsentDialogOpen] = useState(false)
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  // Every move of the plan (propose, consent, start, complete, cancel), editing
  // it, and starting a step's treatment are `clinical:write`; the manager reads
  // the plan but does not write it (bug report 16 Oct, finding 6).
  const canWrite = useCan('clinical:write') === true
  // Prints the patient estimate, with each step's status for the clinic's file.
  const printing = usePrint({
    documentTitle: plan ? `Treatment plan ${plan.planNumber}` : 'Treatment plan',
  })

  /** PUT a change to the plan; throws with the route's message on a refusal. */
  const savePlan = async (change: Record<string, unknown>) => {
    await readJson(
      await fetch(`/api/treatment-plans/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
    )
  }

  const fetchPlan = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/treatment-plans/${id}`)
      if (response.status === 404) {
        setPlan(null)
        setLoadState('missing')
        return
      }
      setPlan(await readJson<TreatmentPlan>(response))
      setLoadState('ok')
    } catch (error) {
      console.error('Error fetching treatment plan:', error)
      // A refresh after an action that fails keeps the plan on screen.
      setLoadState('failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Loading is the effect's job: it fetches and stores what comes back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const planName = plan ? `plan ${plan.planNumber}` : 'the plan'

  const handleStatusChange = async (status: string) => {
    try {
      setActionLoading(true)
      await savePlan({ status })
      toast(toastSuccess(STATUS_DONE[status] ?? 'Treatment plan updated', plan?.planNumber))
      fetchPlan()
    } catch (error) {
      toast(toastError(`update ${planName}`, error))
    } finally {
      setActionLoading(false)
    }
  }

  const handleConsentGiven = async () => {
    try {
      setActionLoading(true)
      await savePlan({
        consentGiven: true,
        status: plan?.status === 'PROPOSED' ? 'ACCEPTED' : plan?.status,
      })
      setConsentDialogOpen(false)
      toast(toastSuccess('Consent recorded', plan?.planNumber))
      fetchPlan()
    } catch (error) {
      toast(toastError(`record consent for ${planName}`, error))
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelPlan = async () => {
    if (!plan) return
    const ok = await confirm({
      title: `Cancel treatment plan ${plan.planNumber}?`,
      description:
        'The plan is marked cancelled and no further steps are started from it. Treatments already carried out are kept.',
      confirmLabel: 'Cancel plan',
      cancelLabel: 'Keep plan',
    })
    if (!ok) return
    await handleStatusChange('CANCELLED')
  }

  /**
   * Where a step's Start goes: a new treatment for this patient and procedure,
   * carrying the plan item, its teeth and its quoted price, so the treatment
   * is linked to the step and moves it as it progresses (bug report 12 Oct,
   * finding 11).
   */
  const startHref = (item: TreatmentPlanItem) => {
    const query = new URLSearchParams({
      patientId: plan!.patient.id,
      procedureId: item.procedure.id,
      planItemId: item.id,
      cost: String(Number(item.estimatedCost)),
    })
    if (item.toothNumbers) query.set('teeth', item.toothNumbers)
    return trail.to(`/treatments/new?${query.toString()}`)
  }

  if (loading && !plan) {
    return <PageSkeleton variant="detail" />
  }

  if (!plan) {
    if (loadState === 'failed') {
      return <LoadFailed what="this treatment plan" onRetry={fetchPlan} />
    }
    return (
      <EmptyState
        icon={FileText}
        title="Treatment plan not found"
        description="It may have been deleted, or the link is wrong."
        actionLabel="Back to treatment plans"
        actionHref="/treatments/plans"
      />
    )
  }

  // Derived below the guards so the items are known to exist. A plan with one
  // phase yields one group and the headings stay off — see the section below.
  const phases = groupByPhase(plan.items, plan.phaseNames)

  const progress = calculatePlanProgress(plan.items)

  return (
    <div className="space-y-6">
      <PrintDocument printing={printing}>
        <PlanEstimatePrint plan={plan} showItemStatus />
      </PrintDocument>

      <PageHeader
        title={plan.planNumber}
        description={plan.title}
        back={
          <BackLink trail={trail} fallback="/treatments/plans" fallbackLabel="Treatment plans" />
        }
        badges={
          <>
            <StatusBadge kind="treatmentPlan" status={plan.status} />
            {plan.consentGiven && (
              <StatusBadge
                kind="active"
                status="ACTIVE"
                label={
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Consent given
                  </>
                }
              />
            )}
          </>
        }
        actions={
          <>
            {canWrite && plan.status === 'DRAFT' && (
              <Button onClick={() => handleStatusChange('PROPOSED')} disabled={actionLoading}>
                <FileText className="h-4 w-4 mr-2" />
                Propose to patient
              </Button>
            )}
            {canWrite && plan.status === 'PROPOSED' && !plan.consentGiven && (
              <Button onClick={() => setConsentDialogOpen(true)}>
                <ClipboardCheck className="h-4 w-4 mr-2" />
                Record consent…
              </Button>
            )}
            {canWrite && plan.status === 'ACCEPTED' && (
              <Button onClick={() => handleStatusChange('IN_PROGRESS')} disabled={actionLoading}>
                <Play className="h-4 w-4 mr-2" />
                Start treatment
              </Button>
            )}
            {/*
              Only once every step is done or dropped — the rule the route
              enforces. A plan finishes on its own when its last step's treatment
              is completed; this is for the plan whose last open step was
              cancelled instead.
            */}
            {canWrite && plan.status === 'IN_PROGRESS' && planIsFinished(plan.items) && (
              <Button onClick={() => handleStatusChange('COMPLETED')} disabled={actionLoading}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Mark plan complete
              </Button>
            )}
            {canWrite && !['COMPLETED', 'CANCELLED'].includes(plan.status) && (
              <>
                <Button variant="outline" asChild>
                  <Link href={trail.to(`/treatments/plans/${id}/edit`)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={handleCancelPlan}
                  disabled={actionLoading}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Cancel plan…
                </Button>
              </>
            )}
            <PrintButton printing={printing} label="Print plan" />
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Treatment progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {plan.items.filter((i) => i.status === 'COMPLETED').length} of{' '}
                    {plan.items.length} procedures completed
                  </span>
                  <span className="text-sm font-medium">{progress}%</span>
                </div>
                <Progress value={progress} className="h-3" />
              </div>
            </CardContent>
          </Card>

          {/* Procedures, in the phases the plan is agreed in */}
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Treatment procedures</CardTitle>
                <CardDescription>
                  {phases.length > 1
                    ? `${phases.length} phases — each one is a separate decision for the patient`
                    : 'Procedures in this plan'}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={trail.to(`/treatments/plans/${plan.id}/estimate`)}>
                  <Printer className="mr-2 h-4 w-4" />
                  Patient estimate
                </Link>
              </Button>
            </CardHeader>

            <CardContent className="space-y-8">
              {phases.map((phase) => (
                <section key={phase.number}>
                  {/*
                    The heading only appears once a plan actually has phases. A
                    single-phase plan with "Phase 1" written over it is an
                    interface explaining its own data model.
                  */}
                  {phases.length > 1 && (
                    <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
                      <h3 className="font-medium">
                        <span className="text-muted-foreground">Phase {phase.number} · </span>
                        {phase.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(phase.subtotal)}
                        {phase.completed > 0 &&
                          ` · ${phase.completed} of ${phase.items.length} done`}
                      </p>
                    </header>
                  )}

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Procedure</TableHead>
                        <TableHead>Teeth</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {phase.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.priority}</TableCell>
                          <TableCell>
                            <div className="font-medium">{item.procedure.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {item.procedure.code}
                            </div>
                            <Badge
                              variant="outline"
                              className={`mt-1 ${procedureCategoryConfig[item.procedure.category]?.bgColor} ${procedureCategoryConfig[item.procedure.category]?.color} border-0`}
                            >
                              {procedureCategoryConfig[item.procedure.category]?.label ??
                                item.procedure.category}
                            </Badge>
                            {item.notes && (
                              <p className="text-sm text-muted-foreground mt-1">{item.notes}</p>
                            )}
                          </TableCell>
                          <TableCell>
                            {describeTeethByQuadrant(parseTeeth(item.toothNumbers)) || BLANK}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.estimatedCost)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge kind="treatmentPlanItem" status={item.status} />
                          </TableCell>
                          <TableCell>
                            {item.treatment ? (
                              <Link
                                href={trail.to(`/treatments/${item.treatment.id}`)}
                                className="text-sm text-primary hover:underline"
                              >
                                {item.treatment.treatmentNo}
                              </Link>
                            ) : (
                              canWrite &&
                              ['PENDING', 'SCHEDULED'].includes(item.status) &&
                              ['ACCEPTED', 'IN_PROGRESS'].includes(plan.status) && (
                                <Button size="sm" variant="outline" asChild>
                                  <Link href={startHref(item)}>Start</Link>
                                </Button>
                              )
                            )}
                          </TableCell>
                        </TableRow>
                      ))}

                      {phases.length > 1 && (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className="text-right text-sm text-muted-foreground"
                          >
                            Phase {phase.number} subtotal
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(phase.subtotal)}
                          </TableCell>
                          <TableCell colSpan={2} className="text-sm text-muted-foreground">
                            {formatCurrency(phase.runningTotal)} agreed by the end of this phase
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </section>
              ))}

              <div className="flex items-baseline justify-between border-t pt-4">
                <span className="font-medium">Total estimated cost</span>
                <span className="text-lg font-bold tabular-nums">
                  {formatCurrency(plan.estimatedCost)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {plan.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{plan.notes}</p>
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
                    {plan.patient.firstName} {plan.patient.lastName}
                  </div>
                  <div className="text-sm text-muted-foreground">{plan.patient.patientId}</div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  {formatPhone(plan.patient.phone) || BLANK}
                </div>
                {plan.patient.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {plan.patient.email}
                  </div>
                )}
              </div>

              <Button variant="outline" className="w-full" asChild>
                <Link href={trail.to(`/patients/${plan.patient.id}`)}>View patient profile</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Plan Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Plan summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Total cost</div>
                  <div className="font-bold text-lg tabular-nums">
                    {formatCurrency(plan.estimatedCost)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Procedures</div>
                  <div className="font-bold text-lg">{plan.items.length}</div>
                </div>
              </div>

              {plan.estimatedDuration ? (
                <div>
                  <div className="text-sm text-muted-foreground">Estimated duration</div>
                  <div className="font-medium">{Math.round(plan.estimatedDuration / 60)} hours</div>
                </div>
              ) : null}

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{displayDate(plan.createdAt)}</span>
                </div>
                {plan.startDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Start date</span>
                    <span>{displayDate(plan.startDate)}</span>
                  </div>
                )}
                {plan.expectedEndDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected end</span>
                    <span>{displayDate(plan.expectedEndDate)}</span>
                  </div>
                )}
                {plan.completedDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Completed</span>
                    <span>{displayDate(plan.completedDate)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Consent: a statement to confirm, not a destructive step, so a plain dialog. */}
      <Dialog open={consentDialogOpen} onOpenChange={setConsentDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Record consent for {plan.planNumber}?</DialogTitle>
            <DialogDescription>
              Confirm that the patient has given consent to proceed with this treatment plan.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">By recording consent, you confirm that:</p>
            <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
              <li>The treatment plan has been explained to the patient</li>
              <li>All questions have been answered</li>
              <li>The patient understands the costs and procedures involved</li>
              <li>The patient has agreed to proceed</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentDialogOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              type="button"
              onClick={handleConsentGiven}
              busy={actionLoading}
              busyLabel="Recording…"
            >
              Record consent
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  )
}
