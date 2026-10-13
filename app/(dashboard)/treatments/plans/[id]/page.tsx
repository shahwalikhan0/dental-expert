'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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
  ArrowLeft,
  User,
  Phone,
  Mail,
  Calendar,
  FileText,
  CheckCircle,
  XCircle,
  Edit,
  Printer,
  AlertCircle,
  Play,
  ClipboardCheck,
} from 'lucide-react'
import {
  treatmentPlanStatusConfig,
  treatmentPlanItemStatusConfig,
  procedureCategoryConfig,
  formatCurrency,
  formatDate,
  calculatePlanProgress,
} from '@/lib/treatment-utils'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { parseTeeth } from '@/lib/teeth'
import { planIsFinished } from '@/lib/treatment-plan-status'
import { formatToothNumbers } from '@/lib/treatment-utils'
import { groupByPhase } from '@/lib/treatment-phases'

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

export default function TreatmentPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [plan, setPlan] = useState<TreatmentPlan | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(plan?.planNumber ?? null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [consentDialogOpen, setConsentDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const { toast } = useToast()

  /** The route's own words, as a toast, rather than a line in the console. */
  const refused = (title: string, error: unknown) =>
    toast({
      variant: 'destructive',
      title,
      description: error instanceof Error ? error.message : undefined,
    })

  /** PUT a change to the plan; throws with the route's message on a refusal. */
  const savePlan = async (change: Record<string, unknown>, fallback: string) => {
    const response = await fetch(`/api/treatment-plans/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || fallback)
    }
  }

  const fetchPlan = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/treatment-plans/${id}`)
      if (!response.ok) throw new Error('Failed to fetch treatment plan')
      const data = await response.json()
      setPlan(data)
    } catch (error) {
      console.error('Error fetching treatment plan:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlan()
  }, [id])

  const handleStatusChange = async (status: string) => {
    try {
      setActionLoading(true)
      await savePlan({ status }, 'Failed to update status')
      fetchPlan()
    } catch (error) {
      refused('Could not update the plan', error)
    } finally {
      setActionLoading(false)
    }
  }

  const handleConsentGiven = async () => {
    try {
      setActionLoading(true)
      await savePlan(
        {
          consentGiven: true,
          status: plan?.status === 'PROPOSED' ? 'ACCEPTED' : plan?.status,
        },
        'Failed to record consent'
      )
      setConsentDialogOpen(false)
      fetchPlan()
    } catch (error) {
      refused('Could not record consent', error)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelPlan = async () => {
    try {
      setActionLoading(true)
      await savePlan({ status: 'CANCELLED' }, 'Failed to cancel plan')
      setCancelDialogOpen(false)
      fetchPlan()
    } catch (error) {
      refused('Could not cancel the plan', error)
    } finally {
      setActionLoading(false)
    }
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
    return `/treatments/new?${query.toString()}`
  }

  const getStatusBadge = (status: string) => {
    const config = treatmentPlanStatusConfig[status] || {
      label: status,
      color: 'text-foreground',
      bgColor: 'bg-muted',
    }
    return (
      <Badge className={`${config.bgColor} ${config.color} border-0 text-sm`}>{config.label}</Badge>
    )
  }

  const getItemStatusBadge = (status: string) => {
    const config = treatmentPlanItemStatusConfig[status] || {
      label: status,
      color: 'text-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
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

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Treatment plan not found</p>
        <Button variant="outline" asChild>
          <Link href="/treatments/plans">Back to Treatment Plans</Link>
        </Button>
      </div>
    )
  }

  // Derived below the guards so the items are known to exist. A plan with one
  // phase yields one group and the headings stay off — see the section below.
  const phases = groupByPhase(plan.items, plan.phaseNames)

  const progress = calculatePlanProgress(plan.items)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <BackLink trail={trail} fallback="/treatments/plans" fallbackLabel="Treatment Plans" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="page-title">{plan.planNumber}</h1>
              {getStatusBadge(plan.status)}
              {plan.consentGiven && (
                <Badge
                  variant="outline"
                  className="bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300"
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Consent Given
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">{plan.title}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {plan.status === 'DRAFT' && (
            <Button onClick={() => handleStatusChange('PROPOSED')} disabled={actionLoading}>
              <FileText className="h-4 w-4 mr-2" />
              Propose to Patient
            </Button>
          )}
          {plan.status === 'PROPOSED' && !plan.consentGiven && (
            <Button onClick={() => setConsentDialogOpen(true)}>
              <ClipboardCheck className="h-4 w-4 mr-2" />
              Record Consent
            </Button>
          )}
          {plan.status === 'ACCEPTED' && (
            <Button onClick={() => handleStatusChange('IN_PROGRESS')} disabled={actionLoading}>
              <Play className="h-4 w-4 mr-2" />
              Start Treatment
            </Button>
          )}
          {/*
            Only once every step is done or dropped — the rule the route
            enforces. A plan finishes on its own when its last step's treatment
            is completed; this is for the plan whose last open step was
            cancelled instead.
          */}
          {plan.status === 'IN_PROGRESS' && planIsFinished(plan.items) && (
            <Button onClick={() => handleStatusChange('COMPLETED')} disabled={actionLoading}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark Plan Complete
            </Button>
          )}
          {!['COMPLETED', 'CANCELLED'].includes(plan.status) && (
            <>
              <Button variant="outline" asChild>
                <Link href={`/treatments/plans/${id}/edit`}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Link>
              </Button>
              <Button
                variant="outline"
                className="text-red-600 dark:text-red-400"
                onClick={() => setCancelDialogOpen(true)}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Cancel Plan
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Treatment Progress</CardTitle>
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
                              {procedureCategoryConfig[item.procedure.category]?.label}
                            </Badge>
                            {item.notes && (
                              <p className="text-sm text-muted-foreground mt-1">{item.notes}</p>
                            )}
                          </TableCell>
                          <TableCell>{formatToothNumbers(parseTeeth(item.toothNumbers))}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.estimatedCost)}
                          </TableCell>
                          <TableCell>{getItemStatusBadge(item.status)}</TableCell>
                          <TableCell>
                            {item.treatment ? (
                              <Link
                                href={trail.to(`/treatments/${item.treatment.id}`)}
                                className="text-sm text-primary hover:underline"
                              >
                                {item.treatment.treatmentNo}
                              </Link>
                            ) : (
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
                  {plan.patient.phone}
                </div>
                {plan.patient.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {plan.patient.email}
                  </div>
                )}
              </div>

              <Button variant="outline" className="w-full" asChild>
                <Link href={`/patients/${plan.patient.id}`}>View Patient Profile</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Plan Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Plan Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Total Cost</div>
                  <div className="font-bold text-lg">{formatCurrency(plan.estimatedCost)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Procedures</div>
                  <div className="font-bold text-lg">{plan.items.length}</div>
                </div>
              </div>

              {plan.estimatedDuration && (
                <div>
                  <div className="text-sm text-muted-foreground">Est. Duration</div>
                  <div className="font-medium">{Math.round(plan.estimatedDuration / 60)} hours</div>
                </div>
              )}

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatDate(plan.createdAt)}</span>
                </div>
                {plan.startDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Start Date</span>
                    <span>{formatDate(plan.startDate)}</span>
                  </div>
                )}
                {plan.expectedEndDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected End</span>
                    <span>{formatDate(plan.expectedEndDate)}</span>
                  </div>
                )}
                {plan.completedDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Completed</span>
                    <span>{formatDate(plan.completedDate)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Consent Dialog */}
      <Dialog open={consentDialogOpen} onOpenChange={setConsentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Patient Consent</DialogTitle>
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
            <Button onClick={handleConsentGiven} disabled={actionLoading}>
              {actionLoading ? 'Recording...' : 'Confirm Consent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Treatment Plan</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this treatment plan? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Keep Plan
            </Button>
            <Button variant="destructive" onClick={handleCancelPlan} disabled={actionLoading}>
              {actionLoading ? 'Cancelling...' : 'Cancel Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
