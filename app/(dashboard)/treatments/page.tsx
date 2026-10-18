'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useListParams } from '@/hooks/use-list-params'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { DateRangeFilter, dateRangeLabel } from '@/components/ui/date-range-filter'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  Plus,
  User,
  Phone,
  MoreHorizontal,
  Pencil,
  Play,
  CheckCircle,
  Stethoscope,
  Calendar,
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
  procedureCategoryConfig,
  formatToothNumbers,
  parseToothNumbers,
} from '@/lib/treatment-utils'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { statusLabel, statusOptions } from '@/lib/status'
import { readJson, toastError } from '@/lib/toast-utils'
import { ExportMenu } from '@/components/ui/export-menu'
import { CompleteTreatmentDialog } from '@/components/treatments/complete-treatment-dialog'

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

/** What the status filter offers: every treatment status, as the badge names it. */
const STATUS_OPTIONS = statusOptions('treatment')

const FOLLOW_UP_OPTIONS = [{ value: 'required', label: 'Follow-up required' }]

export default function TreatmentsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Treatments')
  const router = useRouter()
  const { toast } = useToast()
  // Recording, editing, starting and completing a treatment are all
  // `clinical:write`; the manager reads the record but does not write it
  // (bug report 16 Oct, finding 6).
  const canWrite = useCan('clinical:write') === true
  const [treatments, setTreatments] = useState<Treatment[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)
  // The row whose "Complete treatment" was chosen: the same dialog as the
  // treatment's own page, so completing from here asks for the same notes.
  const [completing, setCompleting] = useState<Treatment | null>(null)

  /**
   * Search, filters and page, kept in the address bar, so opening a treatment
   * and coming back keeps the view. The hook debounces the search and goes
   * back to page 1 on any change.
   */
  const list = useListParams({
    defaults: { status: 'all', followUp: 'all', from: '', to: '' },
  })
  const range = { from: list.filters.from, to: list.filters.to }
  // What the route is asked, as a string, so the fetch runs once per question.
  const params = list.apiParams({ rename: { from: 'dateFrom', to: 'dateTo' } })
  // The route reads the follow-up filter as a flag.
  if (params.get('followUp') === 'required') params.set('followUpRequired', 'true')
  params.delete('followUp')
  const query = params.toString()

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
      setFailed(false)
      const response = await fetch(`/api/treatments?${query}`)
      if (!response.ok) throw new Error('Failed to fetch treatments')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setTreatments(data.treatments)
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching treatments:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchTreatments()
    // The query string is the whole question; `fetchTreatments` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const handleStartTreatment = async (treatment: Treatment) => {
    try {
      await readJson(await fetch(`/api/treatments/${treatment.id}/start`, { method: 'POST' }))
      fetchTreatments()
    } catch (error) {
      toast(toastError(`start treatment ${treatment.treatmentNo}`, error))
    }
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
      <PageHeader
        title="Treatments"
        description="Manage patient treatments and clinical records"
        actions={
          <>
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
                  Date: displayDate(t.createdAt),
                }))
              }
            />
            <Button variant="outline" asChild>
              <Link href="/treatments/plans">
                <FileText className="h-4 w-4 mr-2" />
                Treatment plans
              </Link>
            </Button>
            {canWrite && (
              <Button asChild>
                <Link href="/treatments/new">
                  <Plus className="h-4 w-4 mr-2" />
                  New treatment
                </Link>
              </Button>
            )}
          </>
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search treatments"
            placeholder="Search by patient name, treatment number or diagnosis…"
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
              label="Follow-up"
              plural="treatments"
              value={list.filters.followUp}
              onValueChange={(followUp) => list.setFilter('followUp', followUp)}
              options={FOLLOW_UP_OPTIONS}
            />
          </>
        }
        date={
          <DateRangeFilter
            label="Created"
            value={range}
            onChange={(next) => list.setFilters(next)}
          />
        }
        active={{
          noun: 'treatments',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Status',
              value:
                list.filters.status === 'all'
                  ? null
                  : statusLabel('treatment', list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
            {
              label: 'Follow-up',
              value: filterValueLabel(FOLLOW_UP_OPTIONS, list.filters.followUp),
              onClear: () => list.setFilter('followUp', 'all'),
            },
            {
              label: 'Created',
              value: dateRangeLabel(range),
              onClear: () => list.setFilters({ from: '', to: '' }),
            },
          ],
        }}
      />

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
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              failed={failed}
              onRetry={fetchTreatments}
              empty={treatments.length === 0}
              emptyIcon={Stethoscope}
              emptyTitle="No treatments found"
              emptyDescription={
                list.isFiltered
                  ? 'Nothing has been carried out under these filters.'
                  : 'No treatment has been recorded yet.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'New treatment' : undefined
              }
              emptyActionHref={list.isFiltered || !canWrite ? undefined : '/treatments/new'}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {treatments.map((treatment) => (
                <ClickableRow
                  key={treatment.id}
                  href={trail.to(`/treatments/${treatment.id}`)}
                  label={`Open treatment ${treatment.treatmentNo}`}
                >
                  <TableCell>
                    <div className="font-medium">{treatment.treatmentNo}</div>
                    <div className="text-sm text-muted-foreground">
                      {displayDate(treatment.createdAt)}
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
                          {formatPhone(treatment.patient.phone)}
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
                      <span className="text-muted-foreground">{BLANK}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{formatCurrency(treatment.cost)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <StatusBadge kind="treatment" status={treatment.status} />
                      {treatment.followUpRequired && (
                        <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-3 w-3" />
                          Follow-up
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <GridActionsCell>
                    {/* A finished treatment with no appointment has nothing
                        to offer here, nor an open one to a reader who cannot
                        write it; the row opens it. */}
                    {((canWrite &&
                      (treatment.status === 'PLANNED' || treatment.status === 'IN_PROGRESS')) ||
                      treatment.appointment) && (
                      <DropdownMenu>
                        <IconTooltip label="More actions">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="More actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </IconTooltip>
                        <DropdownMenuContent align="end">
                          {/* No "View details": the row itself opens the treatment. */}
                          {canWrite &&
                            treatment.status !== 'COMPLETED' &&
                            treatment.status !== 'CANCELLED' && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => router.push(`/treatments/${treatment.id}/edit`)}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                          {canWrite && treatment.status === 'PLANNED' && (
                            <DropdownMenuItem onClick={() => handleStartTreatment(treatment)}>
                              <Play className="h-4 w-4 mr-2" />
                              Start treatment
                            </DropdownMenuItem>
                          )}
                          {canWrite && treatment.status === 'IN_PROGRESS' && (
                            <DropdownMenuItem onClick={() => setCompleting(treatment)}>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Complete treatment…
                            </DropdownMenuItem>
                          )}
                          {treatment.appointment && (
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(trail.to(`/appointments/${treatment.appointment!.id}`))
                              }
                            >
                              <Calendar className="h-4 w-4 mr-2" />
                              View appointment
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="treatments"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>

      <CompleteTreatmentDialog
        treatment={completing}
        onClose={() => setCompleting(null)}
        onCompleted={fetchTreatments}
      />
    </div>
  )
}
