'use client'

import { useState, useEffect, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  SortableHeader,
  useSort,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { canMoveTo, noShowTooEarly } from '@/lib/appointment-status'
import {
  Calendar,
  Plus,
  Search,
  Filter,
  Clock,
  User,
  Phone,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  LogIn,
  LogOut,
  Eye,
  Edit,
  CalendarDays,
  CalendarRange,
  Globe,
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
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
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'
import {
  appointmentStatusConfig,
  appointmentTypeConfig,
  formatTime,
  formatDate,
  getDoctorName,
} from '@/lib/appointment-utils'
import { subjectName } from '@/lib/visitors'
import { formatToken } from '@/lib/tokens'
import { ExportMenu } from '@/components/ui/export-menu'
import {
  AppointmentBook,
  type BookAppointment,
  type BookDoctor,
} from '@/components/appointments/appointment-book'
import { WeekView, type WeekAppointment } from '@/components/appointments/week-view'

/** The clinic's today, as YYYY-MM-DD, from the browser's own clock. */
function todayInClinic(): string {
  return new Date().toLocaleDateString('en-CA')
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
  return date.toLocaleDateString('en-CA')
}

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
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function AppointmentsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Appointments')
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const sort = useSort()
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  // Online bookings the desk has not yet dealt with — see the banner below.
  const [needsReview, setNeedsReview] = useState(false)
  const [pendingReview, setPendingReview] = useState(0)
  // The view lives in the URL, so a book somebody is looking at can be sent to
  // a colleague and survives a refresh. It used to be state nothing read, which
  // is why the Calendar button highlighted itself and changed nothing.
  const requestedView = searchParams.get('view')
  const viewMode = (
    requestedView === 'calendar' ? 'calendar' : requestedView === 'week' ? 'week' : 'list'
  ) as 'list' | 'calendar' | 'week'
  const bookDay = searchParams.get('day') || todayInClinic()
  const [book, setBook] = useState<{ appointments: BookAppointment[]; day: string } | null>(null)
  /**
   * The week the book is showing, as its Sunday.
   *
   * The API has supported `view=week` since before the day book was written and
   * nothing ever asked it for one, so the only way to find next Tuesday's gap
   * was to page forward a day at a time.
   */
  const [week, setWeek] = useState<WeekAppointment[] | null>(null)
  const [bookDoctors, setBookDoctors] = useState<BookDoctor[]>([])
  const [bookHours, setBookHours] = useState({ open: '09:00', close: '21:00' })

  const setViewMode = (mode: 'list' | 'calendar' | 'week') => {
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
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        view: 'list',
      })

      if (sort.column) {
        params.append('sort', sort.column)
        params.append('direction', sort.direction)
      }
      if (debouncedSearch) params.append('search', debouncedSearch)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (typeFilter && typeFilter !== 'all') params.append('type', typeFilter)
      if (dateFilter) params.append('date', dateFilter)
      if (needsReview) params.append('needsReview', 'true')

      const response = await fetch(`/api/appointments?${params}`)
      if (!response.ok) throw new Error('Failed to fetch appointments')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setAppointments(data.appointments)
      setPagination(data.pagination)
      setPendingReview(data.pendingReview ?? 0)
    } catch (error) {
      console.error('Error fetching appointments:', error)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  /**
   * Back to the first page whenever what we are filtering by changes.
   *
   * Without this, searching from page three asked the server for page three of
   * the results for that search — which is usually empty, so the screen said
   * there was nothing to find while the row sat in the list behind it.
   */
  useEffect(() => {
    // The cascading render this causes is the point, and it is bounded: one
    // extra pass, only when a filter changes while the list is off page one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPagination((p) => (p.page === 1 ? p : { ...p, page: 1 }))
  }, [
    debouncedSearch,
    statusFilter,
    typeFilter,
    dateFilter,
    needsReview,
    sort.column,
    sort.direction,
  ])

  useEffect(() => {
    fetchAppointments()
  }, [
    pagination.page,
    pagination.limit,
    debouncedSearch,
    statusFilter,
    typeFilter,
    dateFilter,
    needsReview,
    sort.column,
    sort.direction,
  ])

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
          fetch('/api/settings/clinic').catch(() => null),
        ])

        if (cancelled) return

        const dayData = await dayRes.json()
        setBook({ appointments: dayData.appointments ?? [], day: dayData.day ?? bookDay })

        const doctorsData = await doctorsRes.json().catch(() => ({}))
        setBookDoctors(doctorsData.doctors ?? [])

        // Opening hours frame the grid. A clinic that has not set them gets the
        // default day rather than an empty page.
        const settings = settingsRes?.ok ? await settingsRes.json().catch(() => null) : null
        const hours = settings?.clinic?.workingHours ?? settings?.workingHours
        const parsed = typeof hours === 'string' ? JSON.parse(hours) : hours
        const weekday = new Date(`${bookDay}T12:00:00`)
          .toLocaleDateString('en-US', { weekday: 'long' })
          .toLowerCase()
        const today = parsed?.[weekday]
        if (today?.open && today?.close) setBookHours({ open: today.open, close: today.close })
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
  const act = async (request: Promise<Response>, failure: string) => {
    try {
      const response = await request
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast({ variant: 'destructive', title: failure, description: data.error })
        return
      }
      fetchAppointments()
    } catch {
      toast({ variant: 'destructive', title: failure })
    }
  }

  const handleCheckIn = (id: string) =>
    act(fetch(`/api/appointments/${id}/check-in`, { method: 'POST' }), 'Could not check in')

  const handleCheckOut = (id: string) =>
    act(fetch(`/api/appointments/${id}/check-out`, { method: 'POST' }), 'Could not check out')

  const handleStatusChange = (id: string, status: string) =>
    act(
      fetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
      'Could not update the appointment'
    )

  const getStatusBadge = (status: string) => {
    const config = appointmentStatusConfig[status] || {
      label: status,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
  }

  const getTypeBadge = (type: string) => {
    const config = appointmentTypeConfig[type] || {
      label: type,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted/50',
    }
    return (
      <Badge variant="outline" className={`${config.bgColor} ${config.color} border-0`}>
        {config.label}
      </Badge>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="page-title">Appointments</h1>
            <p className="text-muted-foreground">Manage and schedule patient appointments</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4 mr-2" />
              List
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('calendar')}
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Day
            </Button>
            <Button
              variant={viewMode === 'week' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('week')}
            >
              <CalendarRange className="h-4 w-4 mr-2" />
              Week
            </Button>
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
                  Date: formatDate(a.scheduledDate),
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
            <Button asChild>
              <Link href="/appointments/new">
                <Plus className="h-4 w-4 mr-2" />
                New Appointment
              </Link>
            </Button>
          </div>
        </div>

        {/*
          What came in overnight.

          The public booking page tells the patient "the clinic will telephone
          you to confirm". Until now nothing in the application said which
          appointments those were — an online booking and a desk booking were
          both SCHEDULED and looked identical — so the call depended on somebody
          happening to notice. This is the list that makes the promise keepable.
        */}
        {pendingReview > 0 && !needsReview && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <p className="text-sm">
                  <span className="font-medium">
                    {pendingReview} online booking{pendingReview === 1 ? '' : 's'}
                  </span>{' '}
                  {pendingReview === 1 ? 'is' : 'are'} waiting to be called. The patient was told
                  the clinic would telephone to confirm.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setNeedsReview(true)}>
                Show them
              </Button>
            </CardContent>
          </Card>
        )}

        {needsReview && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <p className="text-sm">
                  Showing online bookings nobody has dealt with yet. Confirming, moving or
                  cancelling one takes it off this list.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setNeedsReview(false)}>
                Show all appointments
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by patient name, phone, or appointment number..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                    <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                    <SelectItem value="CHECKED_IN">Checked In</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                    <SelectItem value="NO_SHOW">No Show</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="CONSULTATION">Consultation</SelectItem>
                    <SelectItem value="PROCEDURE">Procedure</SelectItem>
                    <SelectItem value="FOLLOW_UP">Follow Up</SelectItem>
                    <SelectItem value="EMERGENCY">Emergency</SelectItem>
                    <SelectItem value="CHECK_UP">Check Up</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-[160px]"
                />
              </div>
            </div>

            <ActiveFilters
              className="mt-4"
              noun="appointments"
              onClearAll={() => {
                setSearch('')
                setStatusFilter('all')
                setTypeFilter('all')
                setDateFilter('')
              }}
              filters={[
                { label: 'Search', value: search, onClear: () => setSearch('') },
                {
                  label: 'Status',
                  value: statusFilter === 'all' ? null : humanise(statusFilter),
                  onClear: () => setStatusFilter('all'),
                },
                {
                  label: 'Type',
                  value: typeFilter === 'all' ? null : humanise(typeFilter),
                  onClear: () => setTypeFilter('all'),
                },
                { label: 'Date', value: dateFilter, onClear: () => setDateFilter('') },
              ]}
            />
          </CardContent>
        </Card>

        {viewMode === 'week' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">
                  Week of {formatDate(weekStartOf(bookDay))}
                </CardTitle>
                <CardDescription>
                  Click a day to open it in the book. An empty column is a day with room on it.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous week"
                  onClick={() => setBookDay(shiftDay(bookDay, -7))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setBookDay(todayInClinic())}>
                  This week
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next week"
                  onClick={() => setBookDay(shiftDay(bookDay, 7))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {week === null ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <WeekView
                  weekStart={weekStartOf(bookDay)}
                  today={todayInClinic()}
                  appointments={week}
                  href={(a) => trail.to(`/appointments/${a.id}`)}
                  onPickDay={(day) => setBookDay(day, 'calendar')}
                />
              )}
            </CardContent>
          </Card>
        ) : viewMode === 'calendar' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">{formatDate(bookDay)}</CardTitle>
                <CardDescription>
                  Click an empty slot to book it. Colours follow the appointment&rsquo;s status.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous day"
                  onClick={() => setBookDay(shiftDay(bookDay, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setBookDay(todayInClinic())}>
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next day"
                  onClick={() => setBookDay(shiftDay(bookDay, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
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
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <AppointmentBook
                  day={formatDate(bookDay)}
                  appointments={book.appointments}
                  doctors={bookDoctors}
                  openFrom={bookHours.open}
                  closeAt={bookHours.close}
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
                    <TableHead>Appointment</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <GridActionsHead />
                  </TableRow>
                </TableHeader>
                <GridBody
                  columns={8}
                  loading={loading}
                  empty={appointments.length === 0}
                  emptyIcon={Calendar}
                  emptyTitle="No appointments found"
                  emptyDescription="Nothing is booked under these filters. Widen the date range, or book the first one."
                  emptyActionLabel="Book New Appointment"
                  emptyActionHref="/appointments/new"
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
                              {appointment.patient?.phone ?? appointment.visitor?.phone ?? '—'}
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
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">
                              {formatDate(appointment.scheduledDate)}
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
                      <TableCell>{getStatusBadge(appointment.status)}</TableCell>
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
                            <DropdownMenuItem
                              onClick={() => router.push(`/appointments/${appointment.id}`)}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => router.push(`/appointments/${appointment.id}/edit`)}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {['SCHEDULED', 'CONFIRMED'].includes(appointment.status) && (
                              <DropdownMenuItem onClick={() => handleCheckIn(appointment.id)}>
                                <LogIn className="h-4 w-4 mr-2" />
                                Check In
                              </DropdownMenuItem>
                            )}
                            {['CHECKED_IN', 'IN_PROGRESS'].includes(appointment.status) && (
                              <DropdownMenuItem onClick={() => handleCheckOut(appointment.id)}>
                                <LogOut className="h-4 w-4 mr-2" />
                                Check Out
                              </DropdownMenuItem>
                            )}
                            {appointment.status === 'SCHEDULED' && (
                              <DropdownMenuItem
                                onClick={() => handleStatusChange(appointment.id, 'CONFIRMED')}
                              >
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
                                        onClick={() =>
                                          handleStatusChange(appointment.id, 'NO_SHOW')
                                        }
                                        className="text-amber-600 dark:text-amber-400"
                                      >
                                        <XCircle className="h-4 w-4 mr-2" />
                                        Mark No Show
                                      </DropdownMenuItem>
                                    )}
                                  <DropdownMenuItem
                                    onClick={() => handleStatusChange(appointment.id, 'CANCELLED')}
                                    className="text-red-600 dark:text-red-400"
                                  >
                                    <XCircle className="h-4 w-4 mr-2" />
                                    Cancel
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
                page={pagination.page}
                pageSize={pagination.limit}
                total={pagination.total}
                noun="appointments"
                onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
                onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  )
}
