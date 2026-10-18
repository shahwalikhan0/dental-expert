'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { SubmitButton } from '@/components/ui/submit-button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { FlaskConical, Phone, User } from 'lucide-react'
import { BackLink, useTrail } from '@/components/ui/trail'
import { describeTeethByQuadrant, parseTeeth } from '@/lib/teeth'
import { nextStatuses, workTypeLabel } from '@/lib/lab-orders'
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={order.orderNumber}
        back={<BackLink trail={trail} fallback="/lab" fallbackLabel="Lab orders" />}
        badges={
          <>
            <StatusBadge kind="labOrder" status={order.status} />
            {order.priority === 'URGENT' && <Badge variant="danger">Urgent</Badge>}
          </>
        }
        description={`${workTypeLabel(order.workType)} · ${order.vendorName}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                The case
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
              {[
                ['Work', workTypeLabel(order.workType)],
                [
                  'Teeth',
                  order.toothNumbers
                    ? describeTeethByQuadrant(parseTeeth(order.toothNumbers))
                    : null,
                ],
                ['Shade', order.shadeGuide],
                ['Description', order.description],
                ['Special instructions', order.specialInstructions],
                ['Notes', order.notes],
                ['Quality check', qualityLabel(order.qualityCheck)],
                ['Quality notes', order.qualityNotes],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-muted-foreground text-xs">{k}</p>
                  <p>{v || BLANK}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {canWrite && moves.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Move the case on</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
                {/* Every move is written to the audit log, which is where the
                    trail below comes from — LabOrderHistory recorded exactly
                    this and nothing else. */}
                <p className="text-xs text-muted-foreground">
                  Each change is recorded against this case with who made it and when.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trail</CardTitle>
            </CardHeader>
            <CardContent>
              {order.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing recorded since the case was raised.
                </p>
              ) : (
                <ol className="space-y-3">
                  {order.history.map((entry) => (
                    <li key={entry.id} className="flex gap-3 text-sm">
                      <span className="text-muted-foreground whitespace-nowrap">
                        {displayDateTime(entry.createdAt)}
                      </span>
                      <span>
                        {entry.statusFrom ? `${labOrderStatus(entry.statusFrom)} → ` : ''}
                        <span className="font-medium">{labOrderStatus(entry.statusTo)}</span>
                        {entry.changedByName && (
                          <span className="text-muted-foreground"> by {entry.changedByName}</span>
                        )}
                        {entry.notes && (
                          <span className="block text-muted-foreground">{entry.notes}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Patient
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {/* A crown is made for a person. Reading the case and not being
                  able to reach their record meant going back to the patient
                  list and searching for a name already on the screen. */}
              <Link
                href={trail.to(`/patients/${order.patientId}`)}
                className="font-medium hover:underline"
              >
                {order.patientName}
              </Link>
              <p className="text-muted-foreground">{order.patientCode}</p>
              <p className="flex items-center gap-2">
                <Phone className="h-3 w-3 text-muted-foreground" />
                {formatPhone(order.patientPhone) || BLANK}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Treatment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {order.treatment ? (
                <>
                  <Link
                    href={trail.to(`/treatments/${order.treatment.id}`)}
                    className="font-medium hover:underline"
                  >
                    {order.treatment.treatmentNo}
                  </Link>
                  {order.treatment.procedureName && <p>{order.treatment.procedureName}</p>}
                  {order.treatment.toothNumbers && (
                    <p className="text-muted-foreground">
                      {describeTeethByQuadrant(parseTeeth(order.treatment.toothNumbers))}
                    </p>
                  )}
                  <p className="text-muted-foreground">{displayDate(order.treatment.createdAt)}</p>
                  {/* Read-only (review 4.4). A lab case has no charge of its
                      own; the patient pays for it through the treatment, so
                      whether that is billed is whether this work is. */}
                  {order.treatment.invoice !== undefined && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-muted-foreground">Billing:</span>
                      {order.treatment.invoice ? (
                        <>
                          <Link
                            href={trail.to(`/billing/invoices/${order.treatment.invoice.id}`)}
                            className="font-medium hover:underline"
                          >
                            {order.treatment.invoice.invoiceNo}
                          </Link>
                          <StatusBadge kind="invoice" status={order.treatment.invoice.status} />
                        </>
                      ) : (
                        <span>Treatment not yet billed</span>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Not linked to a treatment.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Laboratory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium">{order.vendorName}</p>
              {order.vendorPhone && (
                <p className="flex items-center gap-2">
                  <Phone className="h-3 w-3 text-muted-foreground" />
                  {formatPhone(order.vendorPhone)}
                </p>
              )}
              {order.avgTurnaroundDays != null && (
                <p className="text-muted-foreground">
                  Usually {order.avgTurnaroundDays} days turnaround
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dates and cost</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {[
                ['Ordered', order.orderDate && displayDate(order.orderDate)],
                ['Expected', order.expectedDate && displayDate(order.expectedDate)],
                ['Sent', order.sentDate && displayDate(order.sentDate)],
                ['Received', order.receivedDate && displayDate(order.receivedDate)],
                ['Delivered', order.deliveredDate && displayDate(order.deliveredDate)],
                ['Estimate', formatCurrency(order.estimatedCost)],
                ['Actual', order.actualCost ? formatCurrency(order.actualCost) : null],
                ['Raised by', order.createdByName],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{k}</span>
                  <span>{v || BLANK}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
      {ConfirmDialogComponent}
    </div>
  )
}
