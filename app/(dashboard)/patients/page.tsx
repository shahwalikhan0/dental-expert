'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
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
import { Plus, Search, User, MoreHorizontal, Eye, Edit, FileText, Phone, Mail } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { ActiveFilters } from '@/components/ui/active-filters'
import { ExportMenu } from '@/components/ui/export-menu'
import { bloodGroupLabel, genderLabel } from '@/lib/labels'

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
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function PatientsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Patients')
  const router = useRouter()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const sort = useSort()
  const [genderFilter, setGenderFilter] = useState('all')
  const [bloodGroupFilter, setBloodGroupFilter] = useState('all')

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
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (sort.column) {
        params.append('sort', sort.column)
        params.append('direction', sort.direction)
      }
      if (debouncedSearch) params.append('search', debouncedSearch)
      if (genderFilter && genderFilter !== 'all') params.append('gender', genderFilter)
      if (bloodGroupFilter && bloodGroupFilter !== 'all')
        params.append('bloodGroup', bloodGroupFilter)

      const response = await fetch(`/api/patients?${params}`)
      if (!response.ok) throw new Error('Failed to fetch patients')

      const data = await response.json()
      if (requestId !== latestRequest.current) return
      setPatients(data.patients)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching patients:', error)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  /**
   * Back to the first page whenever what we are filtering by changes.
   *
   * Without this, searching from page three asked the server for page three of
   * the results for that search — which for most searches is empty, so the
   * screen said "No patients found" while the patient sat in the list behind it.
   */
  useEffect(() => {
    // The cascading render this causes is the point, and it is bounded: one
    // extra pass, only when a filter changes while the list is off page one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPagination((p) => (p.page === 1 ? p : { ...p, page: 1 }))
  }, [debouncedSearch, genderFilter, bloodGroupFilter, sort.column, sort.direction])

  useEffect(() => {
    fetchPatients()
    // `pagination.limit` belongs here: without it, choosing a different page
    // size on page one changed nothing, because no dependency had changed.
  }, [
    pagination.page,
    pagination.limit,
    debouncedSearch,
    genderFilter,
    bloodGroupFilter,
    sort.column,
    sort.direction,
  ])

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
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Patients</h1>
          <p className="text-muted-foreground">Manage patient records and information</p>
        </div>
        <div className="flex gap-2">
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
          <Button asChild>
            <Link href="/patients/new">
              <Plus className="h-4 w-4 mr-2" />
              New Patient
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
                placeholder="Search by name, patient ID, phone, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={genderFilter} onValueChange={setGenderFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Genders</SelectItem>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
              <Select value={bloodGroupFilter} onValueChange={setBloodGroupFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Blood Group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Blood Groups</SelectItem>
                  <SelectItem value="A+">A+</SelectItem>
                  <SelectItem value="A-">A-</SelectItem>
                  <SelectItem value="B+">B+</SelectItem>
                  <SelectItem value="B-">B-</SelectItem>
                  <SelectItem value="O+">O+</SelectItem>
                  <SelectItem value="O-">O-</SelectItem>
                  <SelectItem value="AB+">AB+</SelectItem>
                  <SelectItem value="AB-">AB-</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ActiveFilters
            className="mt-4"
            noun="patients"
            onClearAll={() => {
              setSearch('')
              setGenderFilter('all')
              setBloodGroupFilter('all')
            }}
            filters={[
              { label: 'Search', value: search, onClear: () => setSearch('') },
              {
                label: 'Gender',
                value: genderFilter === 'all' ? null : genderLabel(genderFilter),
                onClear: () => setGenderFilter('all'),
              },
              {
                label: 'Blood group',
                value: bloodGroupFilter === 'all' ? null : bloodGroupLabel(bloodGroupFilter),
                onClear: () => setBloodGroupFilter('all'),
              },
            ]}
          />
        </CardContent>
      </Card>

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
                <TableHead>Blood Group</TableHead>
                <SortableHeader column="city" sort={sort}>
                  Location
                </SortableHeader>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              empty={patients.length === 0}
              emptyIcon={User}
              emptyTitle="No patients found"
              emptyDescription="Nobody on the register matches this search."
              emptyActionLabel="Add Patient"
              emptyActionHref="/patients/new"
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
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {patient.phone}
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
                    <DropdownMenu>
                      <IconTooltip label="More actions">
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </IconTooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => router.push(`/patients/${patient.id}`)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => router.push(`/patients/${patient.id}/edit`)}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {/* Medical history lives on the overview of the
                            patient's own record. This used to push at
                            /patients/<id>/medical-history, a page that has
                            never existed. */}
                        <DropdownMenuItem
                          onClick={() => router.push(trail.to(`/patients/${patient.id}`))}
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Medical History
                        </DropdownMenuItem>
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
            noun="patients"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
