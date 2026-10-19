'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { IconTooltip } from '@/components/ui/icon-action'
import { useListParams } from '@/hooks/use-list-params'
import { useToast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { useCan } from '@/hooks/use-can'
import { newInvoiceHref } from '@/lib/invoice-links'
import { useTrail } from '@/components/ui/trail'
import { formatToken } from '@/lib/tokens'
import { formatPhone } from '@/lib/utils'
import { formatTime } from '@/lib/appointment-utils'
import { toastError, toastSuccess } from '@/lib/toast-utils'
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  LogIn,
  Receipt,
  RefreshCw,
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
 * The colour each lane of the board carries: a dot beside its name, its count,
 * and the tile behind each token, so a glance across the room tells waiting
 * from in the chair without reading a heading.
 */
const TONES = {
  slate: {
    dot: 'bg-slate-400',
    count: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
    token: 'bg-slate-500/10 text-slate-700 dark:text-slate-200',
  },
  amber: {
    dot: 'bg-amber-500',
    count: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    token: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  },
  blue: {
    dot: 'bg-blue-500',
    count: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    token: 'bg-blue-500/15 text-blue-800 dark:text-blue-200',
  },
  green: {
    dot: 'bg-emerald-500',
    count: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    token: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  },
  red: {
    dot: 'bg-red-500',
    count: 'bg-red-500/15 text-red-700 dark:text-red-300',
    token: 'bg-red-500/10 text-red-800 dark:text-red-200',
  },
} as const

type Tone = keyof typeof TONES

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
            className="truncate font-semibold hover:underline"
          >
            {subjectOf(a)}
          </Link>
        ) : (
          <span className="truncate font-semibold">{subjectOf(a)}</span>
        )}
        {!a.patient && (
          <Badge variant="outline" className="shrink-0 text-xs">
            Walk-in
          </Badge>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {formatTime(a.scheduledTime)}
        {phoneOf(a) ? ` · ${formatPhone(phoneOf(a))}` : ''}
        {a.doctor ? ` · Dr. ${a.doctor.firstName} ${a.doctor.lastName}` : ''}
      </p>
      {a.chiefComplaint && (
        <p className="mt-0.5 truncate text-xs italic text-muted-foreground">{a.chiefComplaint}</p>
      )}
    </div>
  )
}

/** One lane of the board: its name and count, then a card per person in it. */
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
  tone: Tone
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
  const colours = TONES[tone]
  return (
    <section className="flex flex-col rounded-2xl border bg-muted/40 p-3" aria-label={title}>
      <header className="px-2 pb-3 pt-1">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colours.dot}`} aria-hidden />
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <span
            className={`ml-auto rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${colours.count}`}
          >
            {rows.length}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="flex-1 space-y-3">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
            {searching ? 'Nothing here matches.' : 'Nobody.'}
          </p>
        ) : (
          rows.map((a) => {
            const showAction = action && (!action.when || action.when(a))
            return (
              <article
                key={a.id}
                className="rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  {/* The number, larger than the name. It is what gets called
                      across the waiting room and read off a slip. */}
                  <div
                    className={`flex h-14 min-w-14 shrink-0 items-center justify-center rounded-xl px-2 text-2xl font-bold leading-none tabular-nums ${colours.token}`}
                  >
                    {formatToken(a.tokenNumber)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <Person appointment={a} to={to} />
                    {a.waitMinutes != null && a.waitMinutes > 0 && (
                      <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {a.waitMinutes}m wait
                      </span>
                    )}
                  </div>

                  <IconTooltip label="Open appointment">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="-mr-1 -mt-1 h-8 w-8 shrink-0"
                      aria-label={`Open appointment ${a.appointmentNo}`}
                      asChild
                    >
                      <Link href={to(`/appointments/${a.id}`)}>
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </IconTooltip>
                </div>

                {showAction && (
                  <Button
                    size="sm"
                    className="mt-3 w-full"
                    disabled={busyId === a.id}
                    onClick={() => action.run(a)}
                  >
                    {busyId === a.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      action.icon
                    )}
                    {action.label}
                  </Button>
                )}
              </article>
            )
          })
        )}
      </div>
    </section>
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
  // The dentist and the search, in the address bar like every other list. The
  // search filters the columns already on screen, at once, as it always did.
  const list = useListParams({ defaults: { doctor: 'all' } })
  const doctorFilter = list.filters.doctor
  const search = list.search
  const [loading, setLoading] = useState(true)
  // Only the first load says so on the page; a failed refresh keeps what is
  // on screen and says so in a toast.
  const [failed, setFailed] = useState(false)
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
      setFailed(false)
    } catch (err) {
      setFailed(true)
      toast(toastError('load the queue', err))
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
        toast(
          toastSuccess(
            `Token ${formatToken(data.tokenNumber)}`,
            `${subjectOf(appointment)} is in the queue.`
          )
        )
      }

      // Finished, and on their way to the desk: the bill is next. Check-out
      // only closes the visit, so the desk is asked here rather than left to
      // remember. A walk-in has no record to bill.
      if (action === 'complete' && appointment.patient && canBill) {
        const href = billHref(appointment)
        toast({
          ...toastSuccess(
            'Checked out',
            `${subjectOf(appointment)} can be billed for this visit now.`
          ),
          action: (
            <ToastAction altText="Create invoice" onClick={() => router.push(href)}>
              Create invoice
            </ToastAction>
          ),
        })
      }

      await load()
    } catch (err) {
      const verb =
        action === 'check-in'
          ? 'check in'
          : action === 'start'
            ? 'call in'
            : action === 'complete'
              ? 'check out'
              : 'mark as a no-show'
      toast(toastError(`${verb} ${subjectOf(appointment)}`, err))
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

  const doctorOptions = doctors.map((d) => ({
    value: d.id,
    label: `Dr. ${d.firstName} ${d.lastName}`,
  }))

  const header = (
    <PageHeader
      title="Today’s queue"
      description="Who is waiting, in the order they arrived. Refreshes on its own."
      actions={
        <>
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button asChild>
            <Link href={trail.to('/appointments/new?walkIn=1')}>
              <UserPlus className="h-4 w-4" />
              New walk-in
            </Link>
          </Button>
        </>
      }
    />
  )

  if (loading) return <PageSkeleton variant="dashboard" />

  const nothingLoaded = Object.values(queue).every((rows) => rows.length === 0)
  if (failed && nothingLoaded) {
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed what="the queue" onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Waiting', value: stats.waiting, icon: Clock },
          { label: 'In the chair', value: stats.inProgress, icon: LogIn },
          { label: 'Finished today', value: stats.completed, icon: CheckCircle2 },
          // A wait runs from check-in to being called in. The first figure is
          // the waiting room as it stands; the second, those already seen.
          {
            label: 'Average wait so far',
            value: `${stats.avgWaitTime}m`,
            note: `Seen today waited ${stats.avgSeenWaitTime}m`,
            icon: Clock,
          },
        ].map((card) => (
          <div
            key={card.label}
            className="flex items-start justify-between gap-3 rounded-2xl border bg-card p-5 shadow-sm"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{card.value}</p>
              {'note' in card && card.note && (
                <p className="mt-0.5 text-xs text-muted-foreground">{card.note}</p>
              )}
            </div>
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
              <card.icon className="h-5 w-5" />
            </span>
          </div>
        ))}
      </div>

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search the queue"
            placeholder="Search by name, number or token…"
          />
        }
        filters={
          <FilterSelect
            label="Dentist"
            plural="dentists"
            value={doctorFilter}
            onValueChange={(doctor) => list.setFilter('doctor', doctor)}
            options={doctorOptions}
            className="w-full sm:w-[220px]"
          />
        }
        active={{
          noun: 'patients',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: search.trim(), onClear: () => list.setSearch('') },
            {
              label: 'Dentist',
              value: filterValueLabel(doctorOptions, doctorFilter),
              onClear: () => list.setFilter('doctor', 'all'),
            },
          ],
        }}
      >
        {/* Said beside the controls so nobody presses Refresh out of doubt. */}
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground md:ml-auto">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live · updates every 30 seconds
        </span>
      </ListToolbar>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Column
          title="Expected"
          description="Booked for today and not yet arrived"
          rows={queue.upcoming.filter(matches)}
          busyId={busyId}
          searching={Boolean(search.trim())}
          to={trail.to}
          tone="slate"
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
          tone="amber"
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
          tone="blue"
          action={{
            label: 'Finish',
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            run: (a) => act(a, 'complete'),
          }}
        />
      </div>

      {(queue.completed.length > 0 || queue.noShow.length > 0) && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Column
            title="Finished"
            description="Seen and checked out"
            rows={queue.completed.filter(matches)}
            busyId={busyId}
            searching={Boolean(search.trim())}
            to={trail.to}
            tone="green"
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
            tone="red"
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
