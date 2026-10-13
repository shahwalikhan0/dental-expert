'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { useCan } from '@/hooks/use-can'
import { newInvoiceHref } from '@/lib/invoice-links'
import { useTrail } from '@/components/ui/trail'
import { formatToken } from '@/lib/tokens'
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  LogIn,
  Receipt,
  RefreshCw,
  Search,
  UserPlus,
  UserX,
} from 'lucide-react'

/**
 * The waiting room.
 *
 * This screen existed and nothing in the application linked to it — no sidebar
 * entry, no button, no link from anywhere. It was reachable only by typing the
 * URL, which for the screen a receptionist works all day is the same as not
 * existing.
 *
 * Rebuilt around the token. Arrival order is the order people are called, so
 * the waiting column is sorted by the number they were given at the door rather
 * than by when they were booked — a queue sorted by booking calls the person
 * who has been sitting there longest second.
 *
 * Walk-ins appear here beside registered patients, marked as such, because the
 * front desk does not sort the waiting room into two kinds of person.
 */

interface Appointment {
  id: string
  appointmentNo: string
  tokenNumber: string | null
  scheduledTime: string
  status: string
  /**
   * Minutes waited: so far, for somebody still in the waiting room; check-in
   * to call-in, for somebody already seen. Worked out by /api/appointments/today.
   */
  waitMinutes: number | null
  duration: number
  appointmentType: string
  chiefComplaint: string | null
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string | null
  } | null
  visitor: { id: string; name: string; phone: string | null } | null
  doctor: { id: string; firstName: string; lastName: string } | null
  /** A bill for this visit still stands (any invoice not cancelled). */
  invoiced?: boolean
}

interface Queue {
  waiting: Appointment[]
  inProgress: Appointment[]
  upcoming: Appointment[]
  completed: Appointment[]
  noShow: Appointment[]
  cancelled: Appointment[]
}

const EMPTY: Queue = {
  waiting: [],
  inProgress: [],
  upcoming: [],
  completed: [],
  noShow: [],
  cancelled: [],
}

const EMPTY_STATS = {
  waiting: 0,
  inProgress: 0,
  completed: 0,
  avgWaitTime: 0,
  avgSeenWaitTime: 0,
}

const subjectOf = (a: Appointment) =>
  a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : (a.visitor?.name ?? 'Unknown')

const phoneOf = (a: Appointment) => a.patient?.phone ?? a.visitor?.phone ?? null

/**
 * Declared at module scope, not inside the page.
 *
 * A component created during render is a new component type on every render, so
 * React unmounts and remounts it — any state inside resets, and the focus a
 * receptionist had in the search box goes with it.
 */
function Person({
  appointment: a,
  to,
}: {
  appointment: Appointment
  to: (href: string) => string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {a.patient ? (
          <Link
            href={to(`/patients/${a.patient.id}`)}
            className="font-medium truncate hover:underline"
          >
            {subjectOf(a)}
          </Link>
        ) : (
          <span className="font-medium truncate">{subjectOf(a)}</span>
        )}
        {!a.patient && (
          <Badge variant="outline" className="shrink-0 text-xs">
            Walk-in
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground truncate">
        {a.scheduledTime}
        {phoneOf(a) ? ` · ${phoneOf(a)}` : ''}
        {a.doctor ? ` · Dr. ${a.doctor.firstName} ${a.doctor.lastName}` : ''}
      </p>
      {a.chiefComplaint && (
        <p className="text-xs text-muted-foreground truncate italic">{a.chiefComplaint}</p>
      )}
    </div>
  )
}

function Column({
  title,
  description,
  rows,
  tone,
  action,
  busyId,
  searching,
  to,
}: {
  title: string
  description: string
  rows: Appointment[]
  tone: string
  action?: {
    label: string
    icon: React.ReactNode
    run: (a: Appointment) => void
    /** Rows the action applies to; all of them when absent. */
    when?: (a: Appointment) => boolean
  }
  busyId: string | null
  searching: boolean
  to: (href: string) => string
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge className={tone}>{rows.length}</Badge>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {searching ? 'Nothing here matches.' : 'Nobody.'}
          </p>
        ) : (
          rows.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/40 transition-colors"
            >
              {/* The number, as large as the name. It is what gets called
                  across the waiting room and read off a slip. */}
              <div className="shrink-0 text-center">
                <div className="text-lg font-bold leading-none tabular-nums">
                  {formatToken(a.tokenNumber)}
                </div>
                {a.waitMinutes != null && a.waitMinutes > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1">{a.waitMinutes}m</div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <Person appointment={a} to={to} />
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {action && (!action.when || action.when(a)) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === a.id}
                    onClick={() => action.run(a)}
                  >
                    {busyId === a.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      action.icon
                    )}
                    <span className="ml-1.5">{action.label}</span>
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="Open appointment"
                  asChild
                >
                  <Link href={to(`/appointments/${a.id}`)}>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export default function QueuePage() {
  const { toast } = useToast()
  const router = useRouter()
  const trail = useTrail('Queue')
  // Raising the bill for a finished visit is the desk's act (review 4.3).
  const canBill = useCan('billing:write') === true

  const [queue, setQueue] = useState<Queue>(EMPTY)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [doctors, setDoctors] = useState<{ id: string; firstName: string; lastName: string }[]>([])
  const [doctorFilter, setDoctorFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (doctorFilter !== 'all') params.set('doctorId', doctorFilter)

      const res = await fetch(`/api/appointments/today?${params}`)
      if (!res.ok) throw new Error('The queue could not be loaded')
      const data = await res.json()
      setQueue(data.queue ?? EMPTY)
      setStats(data.stats ?? EMPTY_STATS)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load the queue',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [doctorFilter, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    fetch('/api/staff/doctors')
      .then((res) => res.json())
      .then((data) => setDoctors(data.doctors ?? []))
      .catch(() => setDoctors([]))
  }, [])

  // A waiting room changes without this screen doing anything — somebody checks
  // in at the other desk, a dentist finishes. Thirty seconds is short enough
  // that the list is not stale and long enough not to fight the person using it.
  useEffect(() => {
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])

  const billHref = (a: Appointment) =>
    trail.to(newInvoiceHref({ patientId: a.patient?.id, appointmentId: a.id }))

  const act = async (
    appointment: Appointment,
    action: 'check-in' | 'start' | 'complete' | 'no-show'
  ) => {
    setBusyId(appointment.id)
    try {
      const request =
        action === 'check-in'
          ? fetch(`/api/appointments/${appointment.id}/check-in`, { method: 'POST' })
          : action === 'complete'
            ? fetch(`/api/appointments/${appointment.id}/check-out`, { method: 'POST' })
            : fetch(`/api/appointments/${appointment.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: action === 'start' ? 'IN_PROGRESS' : 'NO_SHOW' }),
              })

      const res = await request
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'That did not work')

      // The token is the point of checking somebody in, so it is what the
      // confirmation says. A receptionist reads it out; they should not have to
      // go looking for it.
      if (action === 'check-in') {
        toast({
          title: `Token ${formatToken(data.tokenNumber)}`,
          description: `${subjectOf(appointment)} is in the queue.`,
        })
      }

      // Finished, and on their way to the desk: the bill is next. Check-out
      // only closes the visit, so the desk is asked here rather than left to
      // remember. A walk-in has no record to bill.
      if (action === 'complete' && appointment.patient && canBill) {
        const href = billHref(appointment)
        toast({
          title: 'Checked out',
          description: `${subjectOf(appointment)} can be billed for this visit now.`,
          action: (
            <ToastAction altText="Create invoice" onClick={() => router.push(href)}>
              Create invoice
            </ToastAction>
          ),
        })
      }

      await load()
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'That did not work',
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  const matches = (a: Appointment) => {
    if (!search.trim()) return true
    const needle = search.trim().toLowerCase()
    return (
      subjectOf(a).toLowerCase().includes(needle) ||
      (phoneOf(a) ?? '').includes(needle) ||
      (a.tokenNumber ?? '').includes(needle) ||
      a.appointmentNo.toLowerCase().includes(needle)
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Today&rsquo;s queue</h1>
          <p className="text-muted-foreground">
            Who is waiting, in the order they arrived. Refreshes on its own.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button asChild>
            <Link href={trail.to('/appointments/new?walkIn=1')}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add a walk-in
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Waiting', value: stats.waiting, icon: Clock },
          { label: 'In the chair', value: stats.inProgress, icon: LogIn },
          { label: 'Finished today', value: stats.completed, icon: CheckCircle2 },
          // A wait runs from check-in to being called in. The first figure is
          // the waiting room as it stands; the second, those already seen.
          {
            label: 'Waiting so far, on average',
            value: `${stats.avgWaitTime}m`,
            note: `Seen today waited ${stats.avgSeenWaitTime}m`,
            icon: Clock,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="flex items-center gap-3 py-4">
              <card.icon className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-xl font-bold">{card.value}</p>
                {'note' in card && card.note && (
                  <p className="text-xs text-muted-foreground">{card.note}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a name, number or token…"
            className="pl-9"
            aria-label="Search the queue"
          />
        </div>
        <Select value={doctorFilter} onValueChange={setDoctorFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Filter by dentist">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All dentists</SelectItem>
            {doctors.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                Dr. {d.firstName} {d.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Column
          title="Expected"
          description="Booked for today and not yet arrived"
          rows={queue.upcoming.filter(matches)}
          busyId={busyId}
          searching={Boolean(search.trim())}
          to={trail.to}
          tone="bg-slate-500/15 text-slate-700 dark:text-slate-300"
          action={{
            label: 'Check in',
            icon: <LogIn className="h-3.5 w-3.5" />,
            run: (a) => act(a, 'check-in'),
          }}
        />
        <Column
          title="Waiting"
          description="Arrived, in token order"
          rows={queue.waiting.filter(matches)}
          busyId={busyId}
          searching={Boolean(search.trim())}
          to={trail.to}
          tone="bg-amber-500/15 text-amber-700 dark:text-amber-300"
          action={{
            label: 'Call in',
            icon: <ArrowRight className="h-3.5 w-3.5" />,
            run: (a) => act(a, 'start'),
          }}
        />
        <Column
          title="In the chair"
          description="Being seen now"
          rows={queue.inProgress.filter(matches)}
          busyId={busyId}
          searching={Boolean(search.trim())}
          to={trail.to}
          tone="bg-blue-500/15 text-blue-700 dark:text-blue-300"
          action={{
            label: 'Finish',
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            run: (a) => act(a, 'complete'),
          }}
        />
      </div>

      {(queue.completed.length > 0 || queue.noShow.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Column
            title="Finished"
            description="Seen and checked out"
            rows={queue.completed.filter(matches)}
            busyId={busyId}
            searching={Boolean(search.trim())}
            to={trail.to}
            tone="bg-green-500/15 text-green-700 dark:text-green-300"
            // A finished visit with no bill yet is the one the desk has
            // forgotten; it keeps its button until an invoice is raised.
            action={
              canBill
                ? {
                    label: 'Create invoice',
                    icon: <Receipt className="h-3.5 w-3.5" />,
                    run: (a) => router.push(billHref(a)),
                    when: (a) => Boolean(a.patient) && a.invoiced === false,
                  }
                : undefined
            }
          />
          <Column
            title="Did not attend"
            description="Booked, never arrived"
            rows={queue.noShow.filter(matches)}
            busyId={busyId}
            searching={Boolean(search.trim())}
            to={trail.to}
            tone="bg-red-500/15 text-red-700 dark:text-red-300"
          />
        </div>
      )}

      {queue.upcoming.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Marking somebody as a no-show is on their appointment.{' '}
          <UserX className="inline h-3 w-3" /> Nobody is marked automatically.
        </p>
      )}
    </div>
  )
}
