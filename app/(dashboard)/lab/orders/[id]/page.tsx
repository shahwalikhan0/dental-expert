'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { SubmitButton } from '@/components/ui/submit-button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate, displayDateTime } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { statusLabel } from '@/lib/status'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import {
  Building2,
  CalendarDays,
  CheckCircle,
  ChevronRight,
  FlaskConical,
  Pencil,
  Phone,
  Receipt,
  RotateCcw,
  Stethoscope,
  User,
  Wallet,
  XCircle,
} from 'lucide-react'
import { BackLink, useTrail } from '@/components/ui/trail'
import { describeTeethByQuadrant, parseTeeth } from '@/lib/teeth'
import { STATUS_PATH, isLabOrderEditable, nextStatuses, workTypeLabel } from '@/lib/lab-orders'
import type { LabOrderStatus } from '@prisma/client'

interface HistoryEntry {
  id: string
  createdAt: string
  statusFrom: string | null
  statusTo: string | null
  notes: string | null
  changedByName: string | null
}

interface LabOrder {
  id: string
  orderNumber: string
  workType: string
  description: string | null
  toothNumbers: string | null
  shadeGuide: string | null
  status: string
  priority: string
  orderDate: string
  expectedDate: string | null
  sentDate: string | null
  receivedDate: string | null
  deliveredDate: string | null
  estimatedCost: string
  actualCost: string | null
  qualityCheck: string | null
  qualityNotes: string | null
  notes: string | null
  specialInstructions: string | null
  vendorName: string
  vendorPhone: string | null
  avgTurnaroundDays: number | null
  /** The patient's record id, for the link to it. */
  patientId: string
  patientCode: string
  patientName: string
  patientPhone: string
  createdByName: string | null
  /** The treatment the work is for, when one was chosen (finding 60). */
  treatment: {
    id: string
    treatmentNo: string
    procedureName: string | null
    toothNumbers: string | null
    status: string
    createdAt: string
    /**
     * The invoice that still bills the treatment — and with it this work —
     * or null if none does. Absent for somebody who may not read billing.
     */
    invoice?: { id: string; invoiceNo: string; status: string } | null
  } | null
  history: HistoryEntry[]
}

/** A lab order status as the badge names it, or a dash. */
const labOrderStatus = (value: string | null) => (value ? statusLabel('labOrder', value) : BLANK)

/** The quality check on arrival, as its badge names it, or a dash. */
const qualityLabel = (value: string | null) => (value ? statusLabel('qualityCheck', value) : BLANK)

export default function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { toast } = useToast()
  const router = useRouter()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [order, setOrder] = useState<LabOrder | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(order?.orderNumber ?? null)
  const [loading, setLoading] = useState(true)
  // The first load failed, or the record is not there — two different screens.
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'missing'>('ok')
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  // Moving the case on is `lab:write` (PATCH …/status); the front desk and the
  // manager can follow the case but the move could only come back 403.
  const canWrite = useCan('lab:write') === true

  /**
   * Load the case. `quiet` refreshes it in place after a status move, without
   * putting the page back on its skeleton.
   */
  const fetchOrder = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const response = await fetch(`/api/lab-orders/${id}`)
        if (response.status === 404) {
          setOrder(null)
          setLoadState('missing')
          return
        }
        const data = await readJson<{ success?: boolean; data: LabOrder }>(response)
        if (data.success) {
          setOrder(data.data)
          setStatus(data.data.status)
          setLoadState('ok')
        }
      } catch (err) {
        console.error('Error loading lab order:', err)
        if (quiet) toast(toastError('refresh the lab order', err))
        else setLoadState('failed')
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [id, toast]
  )

  useEffect(() => {
    // Loading is shown while the fetch is out; that render is the point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrder()
  }, [fetchOrder])

  const moveTo = async () => {
    if (!order || status === order.status) return

    // Cancelling is the end of the road (lib/lab-orders.ts): ask first.
    if (
      status === 'CANCELLED' &&
      !(await confirm({
        title: `Cancel lab order ${order.orderNumber}?`,
        description:
          'The case is marked cancelled and cannot be moved on again. Its details and trail are kept.',
        confirmLabel: 'Cancel lab order',
        cancelLabel: 'Keep lab order',
      }))
    )
      return

    setSaving(true)
    try {
      // The refusal names the moves that are allowed, or the plan that is
      // needed (findings 26 and 45) — shown as the API wrote it.
      await readJson(
        await fetch(`/api/lab-orders/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, notes: note || undefined }),
        })
      )

      toast(
        toastSuccess(
          status === 'CANCELLED' ? 'Lab order cancelled' : 'Lab order updated',
          `${order.orderNumber} is now ${labOrderStatus(status).toLowerCase()}.`
        )
      )
      setNote('')
      await fetchOrder(true)
    } catch (err) {
      toast(toastError(`update lab order ${order.orderNumber}`, err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSkeleton variant="detail" />

  if (loadState === 'failed')
    return <LoadFailed what="this lab order" onRetry={() => fetchOrder()} />

  if (!order) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Lab order not found"
          back={<BackLink trail={trail} fallback="/lab" fallbackLabel="Lab orders" />}
        />
        <EmptyState
          icon={FlaskConical}
          title="Lab order not found"
          description="It may have been removed, or the link is wrong."
          actionLabel="Back to lab orders"
          actionHref="/lab"
        />
      </div>
    )
  }

  const moves = nextStatuses(order.status as LabOrderStatus)
  const patientInitials = order.patientName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()

  return (
    <div className="space-y-6">
      {/*
        The case as a record card: what is being made, for whom and by which
        laboratory. Moving it on is a choice of next step with a note, so it
        lives in its own card below rather than as a header button.
      */}
      <ProfileHeader
        eyebrow={order.orderNumber}
        name={workTypeLabel(order.workType)}
        avatarIcon={FlaskConical}
        badges={
          <>
            <StatusBadge kind="labOrder" status={order.status} />
            {order.priority === 'URGENT' && <Badge variant="danger">Urgent</Badge>}
          </>
        }
        facts={[
          { icon: User, label: order.patientName },
          { icon: Building2, label: order.vendorName },
          ...(order.expectedDate
            ? [{ icon: CalendarDays, label: `Expected ${displayDate(order.expectedDate)}` }]
            : []),
          { icon: Wallet, label: formatCurrency(order.actualCost ?? order.estimatedCost) },
        ]}
        menu={
          canWrite && isLabOrderEditable(order.status)
            ? [
                {
                  label: 'Edit order',
                  icon: Pencil,
                  onSelect: () => router.push(trail.to(`/lab/orders/${order.id}/edit`)),
                },
              ]
            : []
        }
      />

      {/* Where the case has got to; or, off the path, why. */}
      {order.status === 'CANCELLED' || order.status === 'REMAKE_REQUIRED' ? (
        <div
          className={`flex items-start gap-3 rounded-2xl border px-5 py-4 text-sm ${
            order.status === 'CANCELLED'
              ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200'
              : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200'
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              order.status === 'CANCELLED' ? 'bg-red-600/10' : 'bg-amber-600/10'
            }`}
          >
            {order.status === 'CANCELLED' ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              {order.status === 'CANCELLED' ? 'This case was cancelled' : 'A remake is needed'}
            </p>
            <p className="mt-0.5">
              {order.status === 'CANCELLED'
                ? 'Its details and trail are kept; it cannot be moved on again.'
                : 'The work came back wrong or did not fit. Send it to the laboratory again, or cancel it.'}
            </p>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6">
            <CaseProgress order={order} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {canWrite && moves.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Move the case on</CardTitle>
                {/* Every move is written to the audit log, which is where the
                    trail below comes from — LabOrderHistory recorded exactly
                    this and nothing else. */}
                <CardDescription>
                  Each change is recorded against this case with who made it and when.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  {/* Only the moves the case can make from here: forward one
                      stage, or the rework steps (finding 45). Offering every
                      status was how a case went from Created to Fitted. */}
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="sm:w-64" aria-label="Next status">
                      <SelectValue placeholder="Choose the next step" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={order.status} disabled>
                        {labOrderStatus(order.status)} (now)
                      </SelectItem>
                      {moves.map((s) => (
                        <SelectItem key={s} value={s}>
                          {labOrderStatus(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <SubmitButton
                    type="button"
                    onClick={moveTo}
                    busy={saving}
                    disabled={status === order.status}
                  >
                    Update status
                  </SubmitButton>
                </div>
                <Textarea
                  id="status-note"
                  aria-label="Note on this change"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="What happened? (optional)"
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>The case</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Work">{workTypeLabel(order.workType)}</InfoItem>
                <InfoItem label="Shade">{order.shadeGuide}</InfoItem>
                <InfoItem label="Teeth" className="sm:col-span-2">
                  {order.toothNumbers
                    ? describeTeethByQuadrant(parseTeeth(order.toothNumbers))
                    : null}
                </InfoItem>
                <InfoItem label="Description" className="sm:col-span-2">
                  {order.description ? (
                    <span className="whitespace-pre-wrap font-normal">{order.description}</span>
                  ) : null}
                </InfoItem>
                <InfoItem label="Special instructions" className="sm:col-span-2">
                  {order.specialInstructions ? (
                    <span className="whitespace-pre-wrap font-normal">
                      {order.specialInstructions}
                    </span>
                  ) : null}
                </InfoItem>
                <InfoItem label="Notes" className="sm:col-span-2">
                  {order.notes ? (
                    <span className="whitespace-pre-wrap font-normal">{order.notes}</span>
                  ) : null}
                </InfoItem>
                <InfoItem label="Quality check">
                  {order.qualityCheck ? qualityLabel(order.qualityCheck) : null}
                </InfoItem>
                <InfoItem label="Quality notes">
                  {order.qualityNotes ? (
                    <span className="whitespace-pre-wrap font-normal">{order.qualityNotes}</span>
                  ) : null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trail</CardTitle>
            </CardHeader>
            <CardContent>
              {order.history.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                  Nothing recorded since the case was raised.
                </p>
              ) : (
                <ol className="relative space-y-5 border-l border-border pl-6">
                  {order.history.map((entry) => (
                    <li key={entry.id} className="relative text-sm">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-primary"
                      />
                      <p>
                        {entry.statusFrom ? `${labOrderStatus(entry.statusFrom)} → ` : ''}
                        <span className="font-semibold">{labOrderStatus(entry.statusTo)}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {displayDateTime(entry.createdAt)}
                        {entry.changedByName && ` · ${entry.changedByName}`}
                      </p>
                      {entry.notes && (
                        <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-muted/60 px-3 py-2">
                          {entry.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* A crown is made for a person. Reading the case and not being
                  able to reach their record meant going back to the patient
                  list and searching for a name already on the screen. */}
              <Link
                href={trail.to(`/patients/${order.patientId}`)}
                className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {patientInitials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{order.patientName}</span>
                  <span className="block text-xs text-muted-foreground">{order.patientCode}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Phone" icon={Phone}>
                  {formatPhone(order.patientPhone) || null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Treatment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.treatment ? (
                <>
                  <LinkList>
                    <LinkRow
                      href={trail.to(`/treatments/${order.treatment.id}`)}
                      icon={Stethoscope}
                      title={order.treatment.procedureName ?? order.treatment.treatmentNo}
                      subtitle={[
                        order.treatment.procedureName ? order.treatment.treatmentNo : null,
                        order.treatment.toothNumbers
                          ? describeTeethByQuadrant(parseTeeth(order.treatment.toothNumbers))
                          : null,
                        displayDate(order.treatment.createdAt),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                    {/* Read-only (review 4.4). A lab case has no charge of its
                        own; the patient pays for it through the treatment, so
                        whether that is billed is whether this work is. */}
                    {order.treatment.invoice && (
                      <LinkRow
                        href={trail.to(`/billing/invoices/${order.treatment.invoice.id}`)}
                        icon={Receipt}
                        title={order.treatment.invoice.invoiceNo}
                        subtitle="Invoice for the treatment"
                        trailing={
                          <StatusBadge kind="invoice" status={order.treatment.invoice.status} />
                        }
                      />
                    )}
                  </LinkList>
                  {order.treatment.invoice === null && (
                    <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                      Treatment not yet billed
                    </p>
                  )}
                </>
              ) : (
                <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                  Not linked to a treatment.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Laboratory</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Name">{order.vendorName}</InfoItem>
                {order.vendorPhone && (
                  <InfoItem label="Phone" icon={Phone}>
                    {formatPhone(order.vendorPhone)}
                  </InfoItem>
                )}
                {order.avgTurnaroundDays != null && (
                  <InfoItem label="Usual turnaround">{order.avgTurnaroundDays} days</InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Dates and cost</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Ordered">
                  {order.orderDate ? displayDate(order.orderDate) : null}
                </InfoItem>
                <InfoItem label="Expected">
                  {order.expectedDate ? displayDate(order.expectedDate) : null}
                </InfoItem>
                <InfoItem label="Sent">
                  {order.sentDate ? displayDate(order.sentDate) : null}
                </InfoItem>
                <InfoItem label="Received">
                  {order.receivedDate ? displayDate(order.receivedDate) : null}
                </InfoItem>
                <InfoItem label="Delivered">
                  {order.deliveredDate ? displayDate(order.deliveredDate) : null}
                </InfoItem>
                <InfoItem label="Raised by">{order.createdByName}</InfoItem>
                <InfoItem label="Estimate">{formatCurrency(order.estimatedCost)}</InfoItem>
                <InfoItem label="Actual">
                  {order.actualCost ? formatCurrency(order.actualCost) : null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>
        </div>
      </div>
      {ConfirmDialogComponent}
    </div>
  )
}

/** Short names for the stages, so seven fit across a phone. */
const STEP_LABELS: Record<string, string> = {
  CREATED: 'Created',
  SENT_TO_LAB: 'Sent',
  IN_PROGRESS: 'In the lab',
  QUALITY_CHECK: 'Checked',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  FITTED: 'Fitted',
}

/**
 * The case as a row of steps, raised to fitted, with the date each milestone
 * was stamped where the record keeps one — the same stepper as a visit's on
 * its appointment page, so where the work has got to reads at a glance.
 */
function CaseProgress({ order }: { order: LabOrder }) {
  const reached = STATUS_PATH.indexOf(order.status as LabOrderStatus)
  const dates: Partial<Record<string, string | null>> = {
    CREATED: order.orderDate,
    SENT_TO_LAB: order.sentDate,
    READY: order.receivedDate,
    DELIVERED: order.deliveredDate,
  }
  return (
    <ol className="flex items-start" aria-label="Case progress">
      {STATUS_PATH.map((stage, index) => {
        const done = index <= reached
        const next = index === reached + 1
        const date = dates[stage]
        return (
          <li key={stage} className="relative flex flex-1 flex-col items-center text-center">
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
              className={`mt-2 text-[11px] font-semibold sm:text-sm ${done || next ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {STEP_LABELS[stage]}
              <span className="sr-only">{done ? ' (done)' : next ? ' (next)' : ''}</span>
            </span>
            {done && date && (
              <span className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                {displayDate(date)}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
