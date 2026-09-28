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
import { Progress } from '@/components/ui/progress'
import {
  Plus,
  Search,
  User,
  MoreHorizontal,
  Eye,
  Edit,
  FileText,
  CheckCircle,
  ArrowLeft,
} from 'lucide-react'
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
  treatmentPlanStatusConfig,
  formatCurrency,
  formatDate,
  calculatePlanProgress,
} from '@/lib/treatment-utils'

interface TreatmentPlanItem {
  id: string
  priority: number
  estimatedCost: string | number
  status: string
  procedure: {
    id: string
    code: string
    name: string
    category: string
  }
}

interface TreatmentPlan {
  id: string
  planNumber: string
  title: string
  status: string
  estimatedCost: string | number
  estimatedDuration: number | null
  startDate: string | null
  expectedEndDate: string | null
  completedDate: string | null
  consentGiven: boolean
  createdAt: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
  }
  items: TreatmentPlanItem[]
  _count: {
    items: number
  }
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function TreatmentPlansPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Treatment Plans')
  const router = useRouter()
  const [plans, setPlans] = useState<TreatmentPlan[]>([])
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
  const [consentFilter, setConsentFilter] = useState('all')

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchPlans = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (debouncedSearch) params.append('search', debouncedSearch)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (consentFilter && consentFilter !== 'all') params.append('consentGiven', consentFilter)

      const response = await fetch(`/api/treatment-plans?${params}`)
      if (!response.ok) throw new Error('Failed to fetch treatment plans')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setPlans(data.treatmentPlans)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching treatment plans:', error)
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
  }, [debouncedSearch, statusFilter, consentFilter])

  useEffect(() => {
    fetchPlans()
  }, [pagination.page, pagination.limit, debouncedSearch, statusFilter, consentFilter])

  const getStatusBadge = (status: string) => {
    const config = treatmentPlanStatusConfig[status] || {
      label: status,
      color: 'text-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" aria-label="Go back" asChild>
            <Link href="/treatments">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="page-title">Treatment Plans</h1>
            <p className="text-muted-foreground">Create and manage comprehensive treatment plans</p>
          </div>
        </div>
        <Button asChild>
          <Link href="/treatments/plans/new">
            <Plus className="h-4 w-4 mr-2" />
            New Treatment Plan
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by patient name, plan number, or title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="PROPOSED">Proposed</SelectItem>
                  <SelectItem value="ACCEPTED">Accepted</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={consentFilter} onValueChange={setConsentFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Consent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Plans</SelectItem>
                  <SelectItem value="true">Consent Given</SelectItem>
                  <SelectItem value="false">Pending Consent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ActiveFilters
            className="mt-4"
            noun="treatment plans"
            onClearAll={() => {
              setSearch('')
              setStatusFilter('all')
              setConsentFilter('all')
            }}
            filters={[
              { label: 'Search', value: search, onClear: () => setSearch('') },
              {
                label: 'Status',
                value: statusFilter === 'all' ? null : humanise(statusFilter),
                onClear: () => setStatusFilter('all'),
              },
              {
                label: 'Consent',
                value:
                  consentFilter === 'all'
                    ? null
                    : consentFilter === 'true'
                      ? 'Consent given'
                      : 'Pending consent',
                onClear: () => setConsentFilter('all'),
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* Treatment Plans Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Procedures</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Estimated Cost</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              empty={plans.length === 0}
              emptyIcon={FileText}
              emptyTitle="No treatment plans found"
              emptyDescription="No plan matches these filters."
              emptyActionLabel="Create Treatment Plan"
              emptyActionHref="/treatments/plans/new"
            >
              {plans.map((plan) => {
                const progress = calculatePlanProgress(plan.items)
                return (
                  <ClickableRow
                    key={plan.id}
                    href={trail.to(`/treatments/plans/${plan.id}`)}
                    label={`Open plan ${plan.planNumber}`}
                  >
                    <TableCell>
                      <div className="font-medium">{plan.planNumber}</div>
                      <div className="text-sm text-muted-foreground">{plan.title}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium">
                            {plan.patient.firstName} {plan.patient.lastName}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {plan.patient.patientId}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {plan._count.items} procedure{plan._count.items !== 1 ? 's' : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="w-24 space-y-1">
                        <Progress value={progress} className="h-2" />
                        <div className="text-xs text-muted-foreground">{progress}% complete</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{formatCurrency(plan.estimatedCost)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {getStatusBadge(plan.status)}
                        {plan.consentGiven && (
                          <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle className="h-3 w-3" />
                            Consent
                          </div>
                        )}
                      </div>
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
                          <DropdownMenuItem
                            onClick={() => router.push(`/treatments/plans/${plan.id}`)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          {plan.status !== 'COMPLETED' && plan.status !== 'CANCELLED' && (
                            <DropdownMenuItem
                              onClick={() => router.push(`/treatments/plans/${plan.id}/edit`)}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </GridActionsCell>
                  </ClickableRow>
                )
              })}
            </GridBody>
          </Table>

          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="treatment plans"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
