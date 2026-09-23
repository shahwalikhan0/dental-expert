'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { formatCurrency, formatDate } from '@/lib/i18n/format'
import { ArrowLeft, FlaskConical, Phone, User } from 'lucide-react'
import { BackLink, useTrail } from '@/components/ui/trail'

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
  history: HistoryEntry[]
}

/** The order a case actually moves through, so the picker reads as a journey. */
const STATUSES = [
  'CREATED',
  'SENT_TO_LAB',
  'IN_PROGRESS',
  'QUALITY_CHECK',
  'READY',
  'DELIVERED',
  'FITTED',
  'REMAKE_REQUIRED',
  'CANCELLED',
] as const

const STATUS_STYLE: Record<string, string> = {
  CREATED: 'bg-muted text-foreground',
  SENT_TO_LAB: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  IN_PROGRESS: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  QUALITY_CHECK: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  READY: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  DELIVERED: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  FITTED: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  REMAKE_REQUIRED: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
}

function label(value: string | null) {
  if (!value) return '—'
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ')
}

export default function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { toast } = useToast()
  const [order, setOrder] = useState<LabOrder | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(order?.orderNumber ?? null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchOrder = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/lab-orders/${id}`)
      const data = await response.json()
      if (data.success) {
        setOrder(data.data)
        setStatus(data.data.status)
      }
    } catch (err) {
      console.error('Error loading lab case:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchOrder()
  }, [fetchOrder])

  const moveTo = async () => {
    if (!order || status === order.status) return
    setSaving(true)
    try {
      const response = await fetch(`/api/lab-orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes: note || undefined }),
      })
      const data = await response.json()

      if (!response.ok) {
        toast({ variant: 'destructive', title: 'Could not update', description: data.error })
        return
      }

      toast({ title: 'Case updated', description: `Now ${label(status).toLowerCase()}.` })
      setNote('')
      await fetchOrder()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Lab case not found</h1>
        <Button variant="outline" asChild>
          <Link href="/lab">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Lab
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{order.orderNumber}</h1>
            <Badge className={`border-0 ${STATUS_STYLE[order.status] ?? ''}`}>
              {label(order.status)}
            </Badge>
            {order.priority === 'URGENT' && (
              <Badge className="bg-red-100 text-red-800 border-0 dark:bg-red-950/40 dark:text-red-300">
                Urgent
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {label(order.workType)} · {order.vendorName}
          </p>
        </div>
        <BackLink trail={trail} fallback="/lab" fallbackLabel="Lab Orders" />
      </div>

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
                ['Work', label(order.workType)],
                ['Teeth', order.toothNumbers],
                ['Shade', order.shadeGuide],
                ['Description', order.description],
                ['Special instructions', order.specialInstructions],
                ['Notes', order.notes],
                ['Quality check', label(order.qualityCheck)],
                ['Quality notes', order.qualityNotes],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-muted-foreground text-xs">{k}</p>
                  <p>{v || '—'}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Move the case on</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="sm:w-64" aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {label(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={moveTo} disabled={saving || status === order.status}>
                  {saving ? 'Saving…' : 'Update status'}
                </Button>
              </div>
              <Textarea
                id="status-note"
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
                        {formatDate(entry.createdAt)}
                      </span>
                      <span>
                        {entry.statusFrom ? `${label(entry.statusFrom)} → ` : ''}
                        <span className="font-medium">{label(entry.statusTo)}</span>
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
                {order.patientPhone}
              </p>
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
                  {order.vendorPhone}
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
                ['Ordered', order.orderDate && formatDate(order.orderDate)],
                ['Expected', order.expectedDate && formatDate(order.expectedDate)],
                ['Sent', order.sentDate && formatDate(order.sentDate)],
                ['Received', order.receivedDate && formatDate(order.receivedDate)],
                ['Delivered', order.deliveredDate && formatDate(order.deliveredDate)],
                ['Estimate', formatCurrency(order.estimatedCost)],
                ['Actual', order.actualCost ? formatCurrency(order.actualCost) : null],
                ['Raised by', order.createdByName],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{k}</span>
                  <span>{v || '—'}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
