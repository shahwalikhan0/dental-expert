'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
  User,
  Phone,
  Mail,
  FileText,
  CheckCircle,
  Check,
  Pencil,
  Printer,
  Play,
  ClipboardCheck,
  ClipboardList,
  ListOrdered,
  Receipt,
  Calendar,
  Clock,
  ChevronRight,
  Trash2,
} from 'lucide-react'
import { procedureCategoryConfig, calculatePlanProgress } from '@/lib/treatment-utils'
import { useTrail } from '@/components/ui/trail'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
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
  const router = useRouter()
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

  const completedCount = plan.items.filter((i) => i.status === 'COMPLETED').length
  // What the work done so far is worth at the quoted prices, beside what is left.
  const completedValue = plan.items
    .filter((i) => i.status === 'COMPLETED')
    .reduce((sum, item) => sum + Number(item.estimatedCost), 0)
  const remainingValue = plan.items
    .filter((i) => i.status !== 'COMPLETED' && i.status !== 'CANCELLED')
    .reduce((sum, item) => sum + Number(item.estimatedCost), 0)
  const patientName = `${plan.patient.firstName} ${plan.patient.lastName}`
  const open = !['COMPLETED', 'CANCELLED'].includes(plan.status)

  return (
    <div className="space-y-6">
      <PrintDocument printing={printing}>
        <PlanEstimatePrint plan={plan} showItemStatus />
      </PrintDocument>

      {/*
        The plan as a record card: its number over its title, whose it is, what
        it costs, then the one move it is waiting for as the primary button.
        Editing and cancelling are rarer and sit behind "More".
      */}
      <ProfileHeader
        eyebrow={plan.planNumber}
        name={plan.title}
        avatarIcon={ClipboardList}
        badges={
          <>
            <StatusBadge kind="treatmentPlan" status={plan.status} />
            {plan.consentGiven && (
              <StatusBadge
                kind="active"
                status="ACTIVE"
                label={
                  <>
                    <CheckCircle className="h-3 w-3" />
                    Consent given
                  </>
                }
              />
            )}
          </>
        }
        facts={[
          { icon: User, label: patientName },
          {
            icon: ListOrdered,
            label: `${plan.items.length} procedure${plan.items.length === 1 ? '' : 's'}`,
          },
          { icon: Receipt, label: formatCurrency(plan.estimatedCost) },
          { icon: Calendar, label: displayDate(plan.createdAt) },
        ]}
        menu={
          canWrite && open
            ? [
                {
                  label: 'Edit plan',
                  icon: Pencil,
                  onSelect: () => router.push(trail.to(`/treatments/plans/${id}/edit`)),
                },
                {
                  label: 'Cancel plan…',
                  icon: Trash2,
                  onSelect: handleCancelPlan,
                  destructive: true,
                  disabled: actionLoading,
                },
              ]
            : []
        }
        actions={
          <>
            <PrintButton printing={printing} label="Print plan" />
            <Button variant="outline" asChild>
              <Link href={trail.to(`/treatments/plans/${plan.id}/estimate`)}>
                <Printer className="h-4 w-4" />
                Patient estimate
              </Link>
            </Button>
            {canWrite && plan.status === 'DRAFT' && (
              <Button onClick={() => handleStatusChange('PROPOSED')} disabled={actionLoading}>
                <FileText className="h-4 w-4" />
                Propose to patient
              </Button>
            )}
            {canWrite && plan.status === 'PROPOSED' && !plan.consentGiven && (
              <Button onClick={() => setConsentDialogOpen(true)}>
                <ClipboardCheck className="h-4 w-4" />
                Record consent…
              </Button>
            )}
            {canWrite && plan.status === 'ACCEPTED' && (
              <Button onClick={() => handleStatusChange('IN_PROGRESS')} disabled={actionLoading}>
                <Play className="h-4 w-4" />
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
                <CheckCircle className="h-4 w-4" />
                Mark plan complete
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Progress and what the plan costs, done and still to do */}
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
              <CardDescription>
                {completedCount} of {plan.items.length} procedures completed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3">
                <Progress value={progress} className="h-2.5 flex-1" />
                <span className="text-sm font-semibold tabular-nums">{progress}%</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-muted p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Total estimate
                  </p>
                  <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">
                    {formatCurrency(plan.estimatedCost)}
                  </p>
                </div>
                <div className="rounded-xl bg-muted p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Completed
                  </p>
                  <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(completedValue)}
                  </p>
                </div>
                <div className="rounded-xl bg-muted p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Remaining
                  </p>
                  <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">
                    {formatCurrency(remainingValue)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Procedures, in the phases the plan is agreed in */}
          <Card>
            <CardHeader>
              <CardTitle>Treatment steps</CardTitle>
              <CardDescription>
                {phases.length > 1
                  ? `${phases.length} phases — each one is a separate decision for the patient`
                  : 'Procedures in this plan, in the order they are done'}
              </CardDescription>
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
                    <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
                      <h3 className="font-semibold">
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

                  {/* A stepper: each step's number on a line that runs down the plan. */}
                  <ol className="relative space-y-3">
                    {phase.items.map((item, index) => {
                      const category = procedureCategoryConfig[item.procedure.category]
                      const done = item.status === 'COMPLETED'
                      const dropped = item.status === 'CANCELLED'
                      const last = index === phase.items.length - 1
                      return (
                        <li key={item.id} className="relative flex gap-4">
                          {!last && (
                            <span
                              aria-hidden="true"
                              className="absolute left-4 top-9 -bottom-3 w-px bg-border"
                            />
                          )}
                          <span
                            className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              done
                                ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                                : item.status === 'IN_PROGRESS'
                                  ? 'bg-primary text-primary-foreground'
                                  : dropped
                                    ? 'bg-muted text-muted-foreground'
                                    : 'border-2 border-border bg-card text-foreground'
                            }`}
                          >
                            {done ? <Check className="h-4 w-4" /> : item.priority}
                          </span>
                          <div
                            className={`min-w-0 flex-1 rounded-xl border border-border px-4 py-3 ${dropped ? 'opacity-60' : ''}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">{item.procedure.name}</span>
                                  <Badge
                                    variant="outline"
                                    className={`${category?.bgColor} ${category?.color} border-0`}
                                  >
                                    {category?.label ?? item.procedure.category}
                                  </Badge>
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {item.procedure.code} · Teeth:{' '}
                                  {describeTeethByQuadrant(parseTeeth(item.toothNumbers)) || BLANK}
                                </p>
                              </div>
                              <span className="text-sm font-semibold tabular-nums">
                                {formatCurrency(item.estimatedCost)}
                              </span>
                            </div>
                            {item.notes && (
                              <p className="mt-2 text-sm text-muted-foreground">{item.notes}</p>
                            )}
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                              <StatusBadge kind="treatmentPlanItem" status={item.status} />
                              {item.treatment ? (
                                <Link
                                  href={trail.to(`/treatments/${item.treatment.id}`)}
                                  className="text-sm font-medium text-primary hover:underline"
                                >
                                  {item.treatment.treatmentNo}
                                </Link>
                              ) : (
                                canWrite &&
                                ['PENDING', 'SCHEDULED'].includes(item.status) &&
                                ['ACCEPTED', 'IN_PROGRESS'].includes(plan.status) && (
                                  <Button size="sm" variant="outline" asChild>
                                    <Link href={startHref(item)}>
                                      <Play className="h-3.5 w-3.5" />
                                      Start
                                    </Link>
                                  </Button>
                                )
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ol>

                  {phases.length > 1 && (
                    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-muted/60 px-4 py-2.5 text-sm">
                      <span className="text-muted-foreground">
                        Phase {phase.number} subtotal{' '}
                        <span className="font-semibold text-foreground tabular-nums">
                          {formatCurrency(phase.subtotal)}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        {formatCurrency(phase.runningTotal)} agreed by the end of this phase
                      </span>
                    </div>
                  )}
                </section>
              ))}

              <div className="flex items-baseline justify-between border-t border-border pt-4">
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
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{plan.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Patient Info */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Link
                href={trail.to(`/patients/${plan.patient.id}`)}
                className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {`${plan.patient.firstName.charAt(0)}${plan.patient.lastName.charAt(0)}`.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{patientName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {plan.patient.patientId}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Phone" icon={Phone}>
                  {formatPhone(plan.patient.phone)}
                </InfoItem>
                {plan.patient.email && (
                  <InfoItem label="Email" icon={Mail}>
                    {plan.patient.email}
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          {/* Plan Summary */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Plan details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Consent">
                  {plan.consentGiven
                    ? plan.consentDate
                      ? `Given ${displayDate(plan.consentDate)}`
                      : 'Given'
                    : 'Not yet recorded'}
                </InfoItem>
                {plan.estimatedDuration ? (
                  <InfoItem label="Estimated duration" icon={Clock}>
                    {Math.round(plan.estimatedDuration / 60)} hours
                  </InfoItem>
                ) : null}
                <InfoItem label="Created">{displayDate(plan.createdAt)}</InfoItem>
                {plan.startDate && (
                  <InfoItem label="Start date">{displayDate(plan.startDate)}</InfoItem>
                )}
                {plan.expectedEndDate && (
                  <InfoItem label="Expected end">{displayDate(plan.expectedEndDate)}</InfoItem>
                )}
                {plan.completedDate && (
                  <InfoItem label="Completed">{displayDate(plan.completedDate)}</InfoItem>
                )}
              </InfoGrid>
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
