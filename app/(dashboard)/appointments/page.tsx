'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  SortableHeader,
  useSort,
  type SortControl,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { useListParams } from '@/hooks/use-list-params'
import { useToast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { useCan } from '@/hooks/use-can'
import { newInvoiceHref } from '@/lib/invoice-links'
import { canMoveTo, noShowTooEarly } from '@/lib/appointment-status'
import {
  Calendar,
  Plus,
  Clock,
  User,
  Phone,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  LogIn,
  LogOut,
  Pencil,
  Trash2,
  CalendarDays,
  CalendarRange,
  Globe,
  ChevronLeft,
  ChevronRight,
  List,
} from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { DateRangeFilter, dateRangeLabel } from '@/components/ui/date-range-filter'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusBadge } from '@/components/ui/status-badge'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { statusLabel, statusOptions } from '@/lib/status'
import { toastError, toastSuccess } from '@/lib/toast-utils'
import { displayDate, isoDay } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { appointmentTypeConfig, formatTime, getDoctorName } from '@/lib/appointment-utils'
import { ALL_DAY } from '@/lib/working-hours'
import { subjectName } from '@/lib/visitors'
import { formatToken } from '@/lib/tokens'
import { ExportMenu } from '@/components/ui/export-menu'
import {
  AppointmentBook,
  type BookAppointment,
  type BookDoctor,
} from '@/components/appointments/appointment-book'
import { WeekView, type WeekAppointment } from '@/components/appointments/week-view'
import {
  cancelAppointmentConfirm,
  noShowConfirm,
} from '@/components/appointments/appointment-confirms'
import { waitlistOfferToast } from '@/components/appointments/waitlist-offers'

/** Today as YYYY-MM-DD, from the browser's own clock, until the server says. */
function browserDay(): string {
  return isoDay(new Date())
}

/** The Sunday the week containing `day` runs from — the week the API expects. */
function weekStartOf(day: string): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - date.getUTCDay())
  return date.toISOString().slice(0, 10)
}

function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + by)
  return isoDay(date)
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
/** The day the book draws for a clinic that has not set its opening hours. */
/**
 * The book's fallback when the clinic's hours cannot be read: the whole day.
 *
 * It was 09:00–21:00, which quietly hid any appointment outside those hours
 * from a clinic whose settings had not loaded.
 */
const DEFAULT_BOOK_HOURS = { open: ALL_DAY.open, close: ALL_DAY.close }

/** Sentence-case names for the appointment types, for the filter and the badge. */
const TYPE_OPTIONS = [
  { value: 'CONSULTATION', label: 'Consultation' },
  { value: 'PROCEDURE', label: 'Procedure' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'CHECK_UP', label: 'Check-up' },
]

const STATUS_OPTIONS = statusOptions('appointment')

type ViewMode = 'list' | 'calendar' | 'week'

const VIEW_OPTIONS = [
  { value: 'list', label: 'List', icon: List },
  { value: 'calendar', label: 'Day', icon: CalendarDays },
  { value: 'week', label: 'Week', icon: CalendarRange },
] as const

interface Appointment {
  id: string
  appointmentNo: string
  scheduledDate: string
  scheduledTime: string
  /** The instant it starts — what "has it started yet" is measured against. */
  startsAt: string
  duration: number
  tokenNumber: string | null
  appointmentType: string
  status: string
  priority: string
  chiefComplaint: string | null
  checkedInAt: string | null
  checkedOutAt: string | null
  waitTime: number | null
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
  } | null
  visitor: { id: string; name: string; phone: string | null } | null
  doctor: {
    id: string
    firstName: string
    lastName: string
    specialization: string | null
  }
  assistant: { id: string; firstName: string; lastName: string } | null
}

export default function AppointmentsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Appointments')
  const router = useRouter()
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  // Raising the bill after check-out is the desk's act (review 4.3).
  const canBill = useCan('billing:write') === true
  const searchParams = useSearchParams()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)
  // The clinic's calendar day, from the server, for the date presets.
  const [clinicToday, setClinicToday] = useState<string | undefined>(undefined)

  /**
   * Search, filters and page, kept in the address bar beside `view` and `day`,
   * so opening an appointment and coming back keeps the list as it was.
   * `needsReview` is the online-bookings banner's filter.
   */
  const list = useListParams({
    defaults: { status: 'all', type: 'all', from: '', to: '', needsReview: false },
  })
  const range = { from: list.filters.from, to: list.filters.to }
  const needsReview = list.filters.needsReview
  const baseSort = useSort()
  // A new order is a new question: back to page 1, as any filter change is.
  const sort: SortControl = {
    ...baseSort,
    toggle: (column) => {
      baseSort.toggle(column)
      list.setPage(1)
    },
  }
  const query = (() => {
    const params = list.apiParams({ rename: { from: 'dateFrom', to: 'dateTo' } })
    params.set('view', 'list')
    if (baseSort.column) {
      params.set('sort', baseSort.column)
      params.set('direction', baseSort.direction)
    }
    return params.toString()
  })()

  const [pendingReview, setPendingReview] = useState(0)
  // The view lives in the URL, so a book somebody is looking at can be sent to
  // a colleague and survives a refresh. It used to be state nothing read, which
  // is why the Calendar button highlighted itself and changed nothing.
  const requestedView = searchParams.get('view')
  const viewMode: ViewMode =
    requestedView === 'calendar' ? 'calendar' : requestedView === 'week' ? 'week' : 'list'
  const todayDay = clinicToday ?? browserDay()
  const bookDay = searchParams.get('day') || todayDay
  const [book, setBook] = useState<{
    appointments: BookAppointment[]
    day: string
    slotMinutes?: number
  } | null>(null)
  /**
   * The week the book is showing, as its Sunday.
   *
   * The API has supported `view=week` since before the day book was written and
   * nothing ever asked it for one, so the only way to find next Tuesday's gap
   * was to page forward a day at a time.
   */
  const [week, setWeek] = useState<WeekAppointment[] | null>(null)
  const [bookDoctors, setBookDoctors] = useState<BookDoctor[]>([])
  const [bookHours, setBookHours] = useState(DEFAULT_BOOK_HOURS)

  const setViewMode = (mode: ViewMode) => {
    const next = new URLSearchParams(searchParams.toString())
    if (mode === 'list') next.delete('view')
    else next.set('view', mode)
    router.replace(`/appointments?${next.toString()}`, { scroll: false })
  }

  /**
   * Move the book to a day, staying in whichever view is open.
   *
   * This forced `view=calendar` on every call, so the week view's own arrows
   * paged a week and then dropped the person into the day book — the one place
   * the week they had just asked for was no longer on screen. Only a caller
   * that means to change the view now passes `mode`.
   */
  const setBookDay = (day: string, mode?: 'calendar' | 'week') => {
    const next = new URLSearchParams(searchParams.toString())
    if (mode) next.set('view', mode)
    next.set('day', day)
    router.replace(`/appointments?${next.toString()}`, { scroll: false })
  }

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchAppointments = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/appointments?${query}`)
      if (!response.ok) throw new Error('Failed to fetch appointments')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setAppointments(data.appointments)
      setTotal(data.pagination?.total ?? 0)
      setPendingReview(data.pendingReview ?? 0)
      if (data.today) setClinicToday(data.today)
    } catch (error) {
      console.error('Error fetching appointments:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchAppointments()
    // The query string is the whole question; `fetchAppointments` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  /**
   * A week, read in one request.
   *
   * `view=week` on the appointments route returns the whole week unpaged, which
   * is what a week view needs: a column showing four of a day's nine bookings
   * would say a day was free when it is not.
   */
  useEffect(() => {
    if (viewMode !== 'week') return

    let cancelled = false
    setWeek(null)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/appointments?view=week&date=${weekStartOf(bookDay)}&limit=500`
        )
        const data = await res.json()
        if (!cancelled) setWeek(data.appointments ?? [])
      } catch {
        if (!cancelled) setWeek([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [viewMode, bookDay])

  // The book reads a whole day at once rather than a page of rows — a calendar
  // showing twenty of the day's thirty appointments is not a calendar.
  useEffect(() => {
    if (viewMode !== 'calendar') return

    let cancelled = false
    setBook(null)
    ;(async () => {
      try {
        const [dayRes, doctorsRes, settingsRes] = await Promise.all([
          fetch(`/api/appointments/today?date=${bookDay}`),
          fetch('/api/staff/doctors'),
          // The print settings carry the clinic's hours and are open to every
          // role; the clinic route needs `settings:read`, which most of the
          // people reading the book do not hold.
          fetch('/api/settings/print').catch(() => null),
        ])

        if (cancelled) return

        const dayData = await dayRes.json()
        setBook({
          appointments: dayData.appointments ?? [],
          day: dayData.day ?? bookDay,
          slotMinutes: dayData.slotMinutes,
        })

        const doctorsData = await doctorsRes.json().catch(() => ({}))
        setBookDoctors(doctorsData.doctors ?? [])

        // Opening hours frame the grid. A clinic that has not set them gets the
        // default day rather than an empty page.
        const settings = settingsRes?.ok ? await settingsRes.json().catch(() => null) : null
        const hours = settings?.clinic?.workingHours
        const parsed = typeof hours === 'string' ? JSON.parse(hours) : hours
        const weekday = WEEKDAYS[new Date(`${bookDay}T12:00:00`).getDay()]
        const today = parsed?.[weekday]
        // Set either way, so a day without hours does not keep the last day's.
        setBookHours(
          today?.open && today?.close
            ? { open: today.open, close: today.close }
            : DEFAULT_BOOK_HOURS
        )
      } catch {
        if (!cancelled) setBook({ appointments: [], day: bookDay })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [viewMode, bookDay])

  /**
   * Check in, check out or change status, with the API's reason as a toast
   * when it refuses. These used to log the failure to the console, so a
   * refused action looked like a menu item that did nothing.
   */
  const act = async (
    request: Promise<Response>,
    action: string,
    done?: (data: unknown) => void
  ) => {
    try {
      const response = await request
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast(toastError(action, data))
        return
      }
      if (done) done(await response.json().catch(() => null))
      fetchAppointments()
    } catch (error) {
      toast(toastError(action, error))
    }
  }

  const handleCheckIn = (appointment: Appointment) =>
    act(
      fetch(`/api/appointments/${appointment.id}/check-in`, { method: 'POST' }),
      `check in ${appointment.appointmentNo}`
    )

  /**
   * Check out, then offer the bill (review 4.3). Check-out only closes the
   * visit; the invoice is a separate act, and the moment the patient is
   * leaving is when the desk should be asked. A walk-in has no record to bill.
   */
  const handleCheckOut = (appointment: Appointment) =>
    act(
      fetch(`/api/appointments/${appointment.id}/check-out`, { method: 'POST' }),
      `check out ${appointment.appointmentNo}`,
      () => {
        if (!appointment.patient || !canBill) return
        const href = trail.to(
          newInvoiceHref({ patientId: appointment.patient.id, appointmentId: appointment.id })
        )
        toast({
          ...toastSuccess(
            'Checked out',
            `${subjectName(appointment)} can be billed for this visit now.`
          ),
          action: (
            <ToastAction altText="Create invoice" onClick={() => router.push(href)}>
              Create invoice
            </ToastAction>
          ),
        })
      }
    )

  const putStatus = (
    appointment: Appointment,
    body: Record<string, unknown>,
    action: string,
    done?: (data: unknown) => void
  ) =>
    act(
      fetch(`/api/appointments/${appointment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      action,
      done
    )

  const handleConfirm = (appointment: Appointment) =>
    putStatus(
      appointment,
      { status: 'CONFIRMED' },
      `confirm appointment ${appointment.appointmentNo}`
    )

  /** The same question, and the same reason, as the appointment page asks. */
  const handleCancel = async (appointment: Appointment) => {
    const { confirmed, reason } = await confirm(cancelAppointmentConfirm(appointment.appointmentNo))
    if (!confirmed) return
    await putStatus(
      appointment,
      { status: 'CANCELLED', ...(reason ? { cancellationReason: reason } : {}) },
      `cancel appointment ${appointment.appointmentNo}`,
      (data) => {
        const offered = waitlistOfferToast(data)
        if (offered) toast(offered)
      }
    )
  }

  const handleNoShow = async (appointment: Appointment) => {
    if (!(await confirm(noShowConfirm(appointment.appointmentNo)))) return
    await putStatus(
      appointment,
      { status: 'NO_SHOW' },
      `mark appointment ${appointment.appointmentNo} as a no-show`
    )
  }

  const getTypeBadge = (type: string) => {
    const config = appointmentTypeConfig[type] || {
      color: 'text-muted-foreground',
      bgColor: 'bg-muted/50',
    }
    return (
      <Badge variant="outline" className={`${config.bgColor} ${config.color} border-0`}>
        {filterValueLabel(TYPE_OPTIONS, type) ?? type}
      </Badge>
    )
  }

  const bookSpinner = (
    <div className="space-y-3 p-6" role="status" aria-label="Loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <PageHeader
          title="Appointments"
          description="Manage and schedule patient appointments"
          actions={
            <>
              <ExportMenu
                filename="appointments"
                getData={() =>
                  appointments.map((a) => ({
                    'Appointment No': a.appointmentNo,
                    Patient: subjectName(a),
                    'Patient Phone': a.patient?.phone ?? a.visitor?.phone ?? '',
                    Registered: a.patient ? 'Yes' : 'Walk-in',
                    Doctor: getDoctorName(a.doctor),
                    Specialization: a.doctor.specialization || '',
                    Date: displayDate(a.scheduledDate),
                    Time: formatTime(a.scheduledTime),
                    'Duration (min)': a.duration,
                    Token: a.tokenNumber || '',
                    Type: a.appointmentType,
                    Status: a.status,
                    Priority: a.priority,
                    'Chief Complaint': a.chiefComplaint || '',
                  }))
                }
              />
              {/* Who is free when, across dentists and assistants */}
              <Button variant="outline" asChild>
                <Link href={trail.to('/appointments/schedule')}>
                  <CalendarRange className="h-4 w-4" />
                  Clinician schedule
                </Link>
              </Button>
              <Button asChild>
                <Link href="/appointments/new">
                  <Plus className="h-4 w-4" />
                  New appointment
                </Link>
              </Button>
            </>
          }
        />

        {/*
          What came in overnight.

          The public booking page tells the patient "the clinic will telephone
          you to confirm". Until now nothing in the application said which
          appointments those were — an online booking and a desk booking were
          both SCHEDULED and looked identical — so the call depended on somebody
          happening to notice. This is the list that makes the promise keepable.
        */}
        {pendingReview > 0 && !needsReview && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600/10">
              <Globe className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1">
              <span className="font-semibold">
                {pendingReview} online booking{pendingReview === 1 ? '' : 's'}
              </span>{' '}
              {pendingReview === 1 ? 'is' : 'are'} waiting to be called. The patient was told the
              clinic would telephone to confirm.
            </p>
            <Button size="sm" variant="outline" onClick={() => list.setFilter('needsReview', true)}>
              Show them
            </Button>
          </div>
        )}

        {needsReview && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600/10">
              <Globe className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1">
              Showing online bookings nobody has dealt with yet. Confirming, moving or cancelling
              one takes it off this list.
            </p>
            <Button size="sm" variant="ghost" onClick={() => list.setFilter('needsReview', false)}>
              Show all appointments
            </Button>
          </div>
        )}

        <ListToolbar
          search={
            <SearchInput
              value={list.search}
              onChange={list.setSearch}
              aria-label="Search appointments"
              placeholder="Search by patient name, phone or appointment number…"
            />
          }
          filters={
            <>
              <FilterSelect
                label="Status"
                plural="statuses"
                value={list.filters.status}
                onValueChange={(status) => list.setFilter('status', status)}
                options={STATUS_OPTIONS}
              />
              <FilterSelect
                label="Type"
                plural="types"
                value={list.filters.type}
                onValueChange={(type) => list.setFilter('type', type)}
                options={TYPE_OPTIONS}
              />
            </>
          }
          date={
            <DateRangeFilter
              label="Scheduled"
              value={range}
              today={clinicToday}
              onChange={(next) => list.setFilters(next)}
            />
          }
          active={{
            noun: 'appointments',
            onClearAll: list.clear,
            filters: [
              { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
              {
                label: 'Status',
                value:
                  list.filters.status === 'all'
                    ? null
                    : statusLabel('appointment', list.filters.status),
                onClear: () => list.setFilter('status', 'all'),
              },
              {
                label: 'Type',
                value: filterValueLabel(TYPE_OPTIONS, list.filters.type),
                onClear: () => list.setFilter('type', 'all'),
              },
              {
                label: 'Scheduled',
                value: dateRangeLabel(range, clinicToday),
                onClear: () => list.setFilters({ from: '', to: '' }),
              },
              {
                label: 'Only',
                value: needsReview ? 'Online bookings to call' : null,
                onClear: () => list.setFilter('needsReview', false),
              },
            ],
          }}
        >
          {/* List, day book or week — how the same appointments are laid out,
              so it sits with the controls over them rather than in the header. */}
          <SegmentedControl
            aria-label="View"
            size="md"
            value={viewMode}
            onChange={setViewMode}
            options={VIEW_OPTIONS}
            className="md:ml-auto"
          />
        </ListToolbar>

        {viewMode === 'week' ? (
          <Card>
            <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">
                  Week of {displayDate(weekStartOf(bookDay))}
                </CardTitle>
                <CardDescription>
                  Click a day to open it in the book. An empty column is a day with room on it.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <IconTooltip label="Previous week">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous week"
                    onClick={() => setBookDay(shiftDay(bookDay, -7))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </IconTooltip>
                <Button variant="outline" size="sm" onClick={() => setBookDay(todayDay)}>
                  This week
                </Button>
                <IconTooltip label="Next week">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Next week"
                    onClick={() => setBookDay(shiftDay(bookDay, 7))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </IconTooltip>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {week === null ? (
                bookSpinner
              ) : (
                <WeekView
                  weekStart={weekStartOf(bookDay)}
                  today={todayDay}
                  appointments={week}
                  href={(a) => trail.to(`/appointments/${a.id}`)}
                  onPickDay={(day) => setBookDay(day, 'calendar')}
                />
              )}
            </CardContent>
          </Card>
        ) : viewMode === 'calendar' ? (
          <Card>
            <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">{displayDate(bookDay)}</CardTitle>
                <CardDescription>
                  Click an empty slot to book it. Colours follow the appointment&rsquo;s status.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <IconTooltip label="Previous day">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous day"
                    onClick={() => setBookDay(shiftDay(bookDay, -1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </IconTooltip>
                <Button variant="outline" size="sm" onClick={() => setBookDay(todayDay)}>
                  Today
                </Button>
                <IconTooltip label="Next day">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Next day"
                    onClick={() => setBookDay(shiftDay(bookDay, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </IconTooltip>
                <Input
                  type="date"
                  value={bookDay}
                  onChange={(e) => e.target.value && setBookDay(e.target.value)}
                  className="w-[160px]"
                  aria-label="Jump to a date"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {book === null ? (
                bookSpinner
              ) : (
                <AppointmentBook
                  day={displayDate(bookDay)}
                  appointments={book.appointments}
                  doctors={bookDoctors}
                  openFrom={bookHours.open}
                  closeAt={bookHours.close}
                  slotMinutes={book.slotMinutes}
                  href={(a) => trail.to(`/appointments/${a.id}`)}
                  onPick={(doctorId, time) =>
                    router.push(
                      trail.to(
                        `/appointments/new?date=${bookDay}&time=${time}` +
                          (doctorId !== 'unassigned' ? `&doctorId=${doctorId}` : '')
                      )
                    )
                  }
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="appointmentNo" sort={sort}>
                      Appointment
                    </SortableHeader>
                    <SortableHeader column="patient" sort={sort}>
                      Patient
                    </SortableHeader>
                    <SortableHeader column="doctor" sort={sort}>
                      Doctor
                    </SortableHeader>
                    <SortableHeader column="startsAt" sort={sort}>
                      Date and time
                    </SortableHeader>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <GridActionsHead />
                  </TableRow>
                </TableHeader>
                <GridBody
                  columns={7}
                  loading={loading}
                  failed={failed}
                  onRetry={fetchAppointments}
                  empty={appointments.length === 0}
                  emptyIcon={Calendar}
                  emptyTitle="No appointments found"
                  emptyDescription={
                    list.isFiltered
                      ? 'Nothing is booked under these filters. Widen the date range, or clear the filters.'
                      : 'No appointment has been booked yet.'
                  }
                  emptyActionLabel={list.isFiltered ? 'Clear the filters' : 'New appointment'}
                  emptyActionHref={list.isFiltered ? undefined : '/appointments/new'}
                  onEmptyAction={list.isFiltered ? list.clear : undefined}
                >
                  {appointments.map((appointment) => (
                    <ClickableRow
                      key={appointment.id}
                      href={trail.to(`/appointments/${appointment.id}`)}
                      label={`Open appointment ${appointment.appointmentNo}`}
                    >
                      <TableCell>
                        <div className="font-medium">{appointment.appointmentNo}</div>
                        {appointment.tokenNumber && (
                          <div className="text-sm text-muted-foreground tabular-nums">
                            Token {formatToken(appointment.tokenNumber)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{subjectName(appointment)}</span>
                              {!appointment.patient && (
                                <Badge variant="outline" className="text-xs">
                                  Walk-in
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              {formatPhone(
                                appointment.patient?.phone ?? appointment.visitor?.phone
                              ) || '—'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{getDoctorName(appointment.doctor)}</div>
                        {appointment.doctor.specialization && (
                          <div className="text-sm text-muted-foreground">
                            {appointment.doctor.specialization}
                          </div>
                        )}
                        {appointment.assistant && (
                          <div className="text-sm text-muted-foreground">
                            Assisted by {appointment.assistant.firstName}{' '}
                            {appointment.assistant.lastName}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">
                              {displayDate(appointment.scheduledDate)}
                            </div>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {formatTime(appointment.scheduledTime)}
                              <span className="text-xs">({appointment.duration} min)</span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getTypeBadge(appointment.appointmentType)}</TableCell>
                      <TableCell>
                        <StatusBadge kind="appointment" status={appointment.status} />
                      </TableCell>
                      <GridActionsCell>
                        <DropdownMenu>
                          <IconTooltip label="More actions">
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="More actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                          </IconTooltip>
                          <DropdownMenuContent align="end">
                            {/* No "View details": the row itself opens the appointment. */}
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(trail.to(`/appointments/${appointment.id}/edit`))
                              }
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            {['SCHEDULED', 'CONFIRMED'].includes(appointment.status) && (
                              <DropdownMenuItem onClick={() => handleCheckIn(appointment)}>
                                <LogIn className="h-4 w-4 mr-2" />
                                Check in
                              </DropdownMenuItem>
                            )}
                            {['CHECKED_IN', 'IN_PROGRESS'].includes(appointment.status) && (
                              <DropdownMenuItem onClick={() => handleCheckOut(appointment)}>
                                <LogOut className="h-4 w-4 mr-2" />
                                Check out
                              </DropdownMenuItem>
                            )}
                            {appointment.status === 'SCHEDULED' && (
                              <DropdownMenuItem onClick={() => handleConfirm(appointment)}>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Confirm
                              </DropdownMenuItem>
                            )}
                            {/* Only what the appointment can still become — see
                                lib/appointment-status.ts. A no-show waits until
                                the appointment has started. */}
                            {appointment.status !== 'CANCELLED' &&
                              canMoveTo(appointment.status, 'CANCELLED') && (
                                <>
                                  <DropdownMenuSeparator />
                                  {appointment.status !== 'NO_SHOW' &&
                                    canMoveTo(appointment.status, 'NO_SHOW') &&
                                    !noShowTooEarly(appointment.startsAt) && (
                                      <DropdownMenuItem
                                        onClick={() => handleNoShow(appointment)}
                                        className="text-destructive"
                                      >
                                        <XCircle className="h-4 w-4 mr-2" />
                                        Mark no-show…
                                      </DropdownMenuItem>
                                    )}
                                  <DropdownMenuItem
                                    onClick={() => handleCancel(appointment)}
                                    className="text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Cancel appointment…
                                  </DropdownMenuItem>
                                </>
                              )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </GridActionsCell>
                    </ClickableRow>
                  ))}
                </GridBody>
              </Table>

              <GridPagination
                page={list.page}
                pageSize={list.pageSize}
                total={total}
                noun="appointments"
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
              />
            </CardContent>
          </Card>
        )}
      </div>
      {ConfirmDialogComponent}
    </TooltipProvider>
  )
}
