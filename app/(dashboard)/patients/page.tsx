'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useListParams } from '@/hooks/use-list-params'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
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
  type SortControl,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { Plus, User, MoreHorizontal, Pencil, Phone, Mail } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { ExportMenu } from '@/components/ui/export-menu'
import { BLOOD_GROUP_OPTIONS, bloodGroupLabel, genderLabel } from '@/lib/labels'
import { useSession } from 'next-auth/react'
import { holderCan } from '@/lib/rbac'
import { formatPhone } from '@/lib/utils'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  email: string
  gender: string
  age: number
  bloodGroup: string
  city: string
  isActive: boolean
}

/**
 * Which part of the register is listed. Active is the default and the one the
 * desk works from; Inactive is how a deactivated patient is found again to be
 * reactivated (bug report 12 Oct, finding 22).
 */
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const GENDER_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
]

export default function PatientsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Patients')
  const router = useRouter()
  // Registering and editing are `patients:write`; the dental assistant, the
  // accountant and the lab technician read the register without it.
  const { data: session } = useSession()
  const canWrite = holderCan(
    { role: session?.user?.role, clinicalRole: session?.user?.clinicalRole },
    'patients:write'
  )
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  /**
   * Search, filters and page in the address bar, so opening a patient and
   * coming back keeps the list as it was. Status defaults to active — the
   * register the desk works from; "All statuses" is active and inactive.
   */
  const list = useListParams({
    defaults: { gender: 'all', bloodGroup: 'all', status: 'active' },
  })
  const baseSort = useSort()
  // A new order is a new question: back to page 1.
  const sort: SortControl = {
    ...baseSort,
    toggle: (column) => {
      baseSort.toggle(column)
      list.setPage(1)
    },
  }
  const query = (() => {
    const params = list.apiParams()
    if (baseSort.column) {
      params.set('sort', baseSort.column)
      params.set('direction', baseSort.direction)
    }
    return params.toString()
  })()

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchPatients = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/patients?${query}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to fetch patients')

      if (requestId !== latestRequest.current) return
      setPatients(data.patients)
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      if (requestId !== latestRequest.current) return
      console.error('Error fetching patients:', error)
      setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchPatients()
    // The query string is the whole question; `fetchPatients` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const getGenderBadge = (gender: string) => {
    const colors = {
      MALE: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
      FEMALE: 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300',
      OTHER: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
    }
    return (
      <Badge
        className={`${colors[gender as keyof typeof colors] || 'bg-muted text-muted-foreground'} border-0`}
      >
        {genderLabel(gender)}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patients"
        description="Manage patient records and information"
        actions={
          <>
            <ExportMenu
              filename="patients"
              getData={() =>
                patients.map((p) => ({
                  'Patient ID': p.patientId,
                  'First Name': p.firstName,
                  'Last Name': p.lastName,
                  Phone: p.phone,
                  Email: p.email || '',
                  Gender: p.gender,
                  Age: p.age,
                  'Blood Group': p.bloodGroup || '',
                  City: p.city || '',
                }))
              }
            />
            {canWrite && (
              <Button asChild>
                <Link href="/patients/new">
                  <Plus className="h-4 w-4 mr-2" />
                  New patient
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
            aria-label="Search patients"
            placeholder="Search by name, patient ID, phone or email…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Gender"
              plural="genders"
              value={list.filters.gender}
              onValueChange={(gender) => list.setFilter('gender', gender)}
              options={GENDER_OPTIONS}
              className="w-full sm:w-[150px]"
            />
            {/* The stored values (A_POSITIVE), not their labels: the route
                filters on the column, and "A+" matched nothing. */}
            <FilterSelect
              label="Blood group"
              plural="blood groups"
              value={list.filters.bloodGroup}
              onValueChange={(bloodGroup) => list.setFilter('bloodGroup', bloodGroup)}
              options={BLOOD_GROUP_OPTIONS}
              className="w-full sm:w-[170px]"
            />
            <FilterSelect
              label="Status"
              plural="statuses"
              value={list.filters.status}
              onValueChange={(status) => list.setFilter('status', status)}
              options={STATUS_OPTIONS}
              className="w-full sm:w-[150px]"
            />
          </>
        }
        active={{
          noun: 'patients',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Gender',
              value: list.filters.gender === 'all' ? null : genderLabel(list.filters.gender),
              onClear: () => list.setFilter('gender', 'all'),
            },
            {
              label: 'Blood group',
              value:
                list.filters.bloodGroup === 'all' ? null : bloodGroupLabel(list.filters.bloodGroup),
              onClear: () => list.setFilter('bloodGroup', 'all'),
            },
            {
              // Active is the default, so only another choice is a filter.
              label: 'Status',
              value:
                list.filters.status === 'active'
                  ? null
                  : list.filters.status === 'all'
                    ? 'Active and inactive'
                    : filterValueLabel(STATUS_OPTIONS, list.filters.status),
              onClear: () => list.setFilter('status', 'active'),
            },
          ],
        }}
      />

      {/* Patients Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <SortableHeader column="patientId" sort={sort}>
                  Patient ID
                </SortableHeader>
                <SortableHeader column="name" sort={sort}>
                  Name
                </SortableHeader>
                <SortableHeader column="phone" sort={sort}>
                  Contact
                </SortableHeader>
                <TableHead>Gender</TableHead>
                {/* Age is derived from the date of birth, so it sorts on that —
                    and inverted, because the oldest patient has the earliest
                    date. */}
                <SortableHeader column="dateOfBirth" sort={sort}>
                  Age
                </SortableHeader>
                <TableHead>Blood group</TableHead>
                <SortableHeader column="city" sort={sort}>
                  Location
                </SortableHeader>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              failed={failed}
              onRetry={fetchPatients}
              empty={patients.length === 0}
              emptyIcon={User}
              emptyTitle="No patients found"
              emptyDescription={
                list.isFiltered
                  ? 'Nobody on the register matches these filters.'
                  : 'No patient has been registered yet.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'New patient' : undefined
              }
              emptyActionHref={!list.isFiltered && canWrite ? '/patients/new' : undefined}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {patients.map((patient) => (
                <ClickableRow
                  key={patient.id}
                  href={trail.to(`/patients/${patient.id}`)}
                  label={`Open ${patient.firstName} ${patient.lastName}`}
                >
                  <TableCell>
                    <div className="font-medium">{patient.patientId}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div className="font-medium">
                        {patient.firstName} {patient.lastName}
                      </div>
                      {!patient.isActive && <StatusBadge kind="patient" status={false} />}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {formatPhone(patient.phone)}
                      </div>
                      {patient.email && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {patient.email}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{getGenderBadge(patient.gender)}</TableCell>
                  <TableCell>
                    <div className="text-sm">{patient.age} years</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{bloodGroupLabel(patient.bloodGroup)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground">{patient.city || '—'}</div>
                  </TableCell>
                  <GridActionsCell>
                    {/* No "View details" or "Medical history": the row itself
                        opens the record, whose overview holds the history. */}
                    {canWrite && (
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
                            onClick={() => router.push(trail.to(`/patients/${patient.id}/edit`))}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
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
            noun="patients"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  )
}
