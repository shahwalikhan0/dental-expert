'use client'

import { useState, useEffect, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ClickableRow, GridPagination } from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import {
  Plus,
  Search,
  User,
  Phone,
  MoreHorizontal,
  Eye,
  Edit,
  Play,
  CheckCircle,
  Stethoscope,
  Calendar,
  Clock,
  FileText,
  AlertCircle,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import {
  treatmentStatusConfig,
  procedureCategoryConfig,
  formatCurrency,
  formatDate,
  formatToothNumbers,
  parseToothNumbers,
} from '@/lib/treatment-utils'
import { ExportMenu } from '@/components/ui/export-menu'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'

interface Treatment {
  id: string
  treatmentNo: string
  chiefComplaint: string | null
  diagnosis: string | null
  toothNumbers: string | null
  status: string
  cost: string | number
  followUpRequired: boolean
  followUpDate: string | null
  createdAt: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
  }
  doctor: {
    id: string
    firstName: string
    lastName: string
    specialization: string | null
  }
  procedure: {
    id: string
    code: string
    name: string
    category: string
  }
  appointment: {
    id: string
    appointmentNo: string
    scheduledDate: string
  } | null
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function TreatmentsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Treatments')
  const router = useRouter()
  const [treatments, setTreatments] = useState<Treatment[]>([])
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
  const [statusFilter, setStatusFilter] = useState('all')
  const [followUpFilter, setFollowUpFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchTreatments = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (debouncedSearch) params.append('search', debouncedSearch)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (followUpFilter === 'required') params.append('followUpRequired', 'true')
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)

      const response = await fetch(`/api/treatments?${params}`)
      if (!response.ok) throw new Error('Failed to fetch treatments')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setTreatments(data.treatments)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching treatments:', error)
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
  }, [debouncedSearch, statusFilter, followUpFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchTreatments()
  }, [
    pagination.page,
    pagination.limit,
    debouncedSearch,
    statusFilter,
    followUpFilter,
    dateFrom,
    dateTo,
  ])

  const handleStartTreatment = async (id: string) => {
    try {
      const response = await fetch(`/api/treatments/${id}/start`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to start treatment')
      fetchTreatments()
    } catch (error) {
      console.error('Error starting treatment:', error)
    }
  }

  const handleCompleteTreatment = async (id: string) => {
    try {
      const response = await fetch(`/api/treatments/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) throw new Error('Failed to complete treatment')
      fetchTreatments()
    } catch (error) {
      console.error('Error completing treatment:', error)
    }
  }

  const getStatusBadge = (status: string) => {
    const config = treatmentStatusConfig[status] || {
      label: status,
      color: 'text-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
  }

  const getCategoryBadge = (category: string) => {
    const config = procedureCategoryConfig[category] || {
      label: category,
      color: 'text-foreground',
      bgColor: 'bg-muted/50',
    }
    return (
      <Badge variant="outline" className={`${config.bgColor} ${config.color} border-0`}>
        {config.label}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Treatments</h1>
          <p className="text-muted-foreground">Manage patient treatments and clinical records</p>
        </div>
        <div className="flex gap-2">
          <ExportMenu
            filename="treatments"
            getData={() =>
              treatments.map((t) => ({
                'Treatment No': t.treatmentNo,
                Patient: `${t.patient.firstName} ${t.patient.lastName}`,
                'Patient ID': t.patient.patientId,
                'Patient Phone': t.patient.phone,
                Doctor: `Dr. ${t.doctor.firstName} ${t.doctor.lastName}`,
                Specialization: t.doctor.specialization || '',
                Procedure: t.procedure.name,
                'Procedure Code': t.procedure.code,
                Category: t.procedure.category,
                Diagnosis: t.diagnosis || '',
                'Chief Complaint': t.chiefComplaint || '',
                Teeth: t.toothNumbers || '',
                Cost: Number(t.cost),
                Status: t.status,
                'Follow-up Required': t.followUpRequired ? 'Yes' : 'No',
                'Follow-up Date': t.followUpDate || '',
                Date: formatDate(t.createdAt),
              }))
            }
          />
          <Button variant="outline" asChild>
            <Link href="/treatments/plans">
              <FileText className="h-4 w-4 mr-2" />
              Treatment Plans
            </Link>
          </Button>
          <Button asChild>
            <Link href="/treatments/new">
              <Plus className="h-4 w-4 mr-2" />
              New Treatment
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by patient name, treatment number, or diagnosis..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="PLANNED">Planned</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={followUpFilter} onValueChange={setFollowUpFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Follow-up" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Treatments</SelectItem>
                  <SelectItem value="required">Follow-up Required</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[140px]"
                placeholder="From Date"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[140px]"
                placeholder="To Date"
              />
            </div>
          </div>

          <ActiveFilters
            className="mt-4"
            noun="treatments"
            onClearAll={() => {
              setSearch('')
              setStatusFilter('all')
              setFollowUpFilter('all')
              setDateFrom('')
              setDateTo('')
            }}
            filters={[
              { label: 'Search', value: search, onClear: () => setSearch('') },
              {
                label: 'Status',
                value: statusFilter === 'all' ? null : humanise(statusFilter),
                onClear: () => setStatusFilter('all'),
              },
              {
                label: 'Follow-up',
                value: followUpFilter === 'all' ? null : 'Required',
                onClear: () => setFollowUpFilter('all'),
              },
              { label: 'From', value: dateFrom, onClear: () => setDateFrom('') },
              { label: 'To', value: dateTo, onClear: () => setDateTo('') },
            ]}
          />
        </CardContent>
      </Card>

      {/* Treatments Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Treatment</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Procedure</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Teeth</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : treatments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Stethoscope className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No treatments found</p>
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/treatments/new">
                          <Plus className="h-4 w-4 mr-2" />
                          Create New Treatment
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                treatments.map((treatment) => (
                  <ClickableRow
                    key={treatment.id}
                    href={trail.to(`/treatments/${treatment.id}`)}
                    label={`Open treatment ${treatment.treatmentNo}`}
                  >
                    <TableCell>
                      <div className="font-medium">{treatment.treatmentNo}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(treatment.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium">
                            {treatment.patient.firstName} {treatment.patient.lastName}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {treatment.patient.phone}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{treatment.procedure.name}</div>
                      <div className="mt-1">{getCategoryBadge(treatment.procedure.category)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        Dr. {treatment.doctor.firstName} {treatment.doctor.lastName}
                      </div>
                      {treatment.doctor.specialization && (
                        <div className="text-sm text-muted-foreground">
                          {treatment.doctor.specialization}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {treatment.toothNumbers ? (
                        <div className="text-sm font-medium">
                          {formatToothNumbers(parseToothNumbers(treatment.toothNumbers))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{formatCurrency(treatment.cost)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {getStatusBadge(treatment.status)}
                        {treatment.followUpRequired && (
                          <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <AlertCircle className="h-3 w-3" />
                            Follow-up
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right row-actions">
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
                            onClick={() => router.push(`/treatments/${treatment.id}`)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          {treatment.status !== 'COMPLETED' && treatment.status !== 'CANCELLED' && (
                            <DropdownMenuItem
                              onClick={() => router.push(`/treatments/${treatment.id}/edit`)}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {treatment.status === 'PLANNED' && (
                            <DropdownMenuItem onClick={() => handleStartTreatment(treatment.id)}>
                              <Play className="h-4 w-4 mr-2" />
                              Start Treatment
                            </DropdownMenuItem>
                          )}
                          {treatment.status === 'IN_PROGRESS' && (
                            <DropdownMenuItem onClick={() => handleCompleteTreatment(treatment.id)}>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Complete Treatment
                            </DropdownMenuItem>
                          )}
                          {treatment.appointment && (
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(`/appointments/${treatment.appointment!.id}`)
                              }
                            >
                              <Calendar className="h-4 w-4 mr-2" />
                              View Appointment
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </ClickableRow>
                ))
              )}
            </TableBody>
          </Table>

          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="treatments"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
