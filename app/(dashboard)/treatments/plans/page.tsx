'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useListParams } from '@/hooks/use-list-params'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { BackLink, useTrail } from '@/components/ui/trail'
import { Progress } from '@/components/ui/progress'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
import { Plus, User, MoreHorizontal, Pencil, FileText, CheckCircle } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { TONE_TEXT_CLASS, statusLabel, statusOptions } from '@/lib/status'
import { formatCurrency } from '@/lib/i18n/format'
import { calculatePlanProgress } from '@/lib/treatment-utils'

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

/** What the status filter offers: every plan status, as the badge names it. */
const STATUS_OPTIONS = statusOptions('treatmentPlan')

/** The consent filter; the values are what the route reads as `consentGiven`. */
const CONSENT_OPTIONS = [
  { value: 'true', label: 'Consent given' },
  { value: 'false', label: 'Consent pending' },
]

export default function TreatmentPlansPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Treatment plans')
  const router = useRouter()
  const [plans, setPlans] = useState<TreatmentPlan[]>([])
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  /**
   * Search, filters and page, kept in the address bar, so opening a plan and
   * coming back — or refreshing, or sharing the link — keeps the view. The hook
   * debounces the search and goes back to page 1 on any change.
   */
  const list = useListParams({ defaults: { status: 'all', consent: 'all' } })
  // What the route is asked, as a string, so the fetch runs once per question.
  const query = list.apiParams({ rename: { consent: 'consentGiven' } }).toString()

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
      setFailed(false)
      const response = await fetch(`/api/treatment-plans?${query}`)
      if (!response.ok) throw new Error('Failed to fetch treatment plans')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setPlans(data.treatmentPlans ?? [])
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching treatment plans:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    // Loading is the effect's job: it fetches and stores what comes back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPlans()
    // The query string is the whole question; `fetchPlans` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Treatment plans"
        description="Create and manage comprehensive treatment plans"
        back={<BackLink trail={trail} fallback="/treatments" fallbackLabel="Treatments" />}
        actions={
          <Button asChild>
            <Link href="/treatments/plans/new">
              <Plus className="h-4 w-4 mr-2" />
              New treatment plan
            </Link>
          </Button>
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search treatment plans"
            placeholder="Search by plan number, patient or title…"
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
              label="Consent"
              plural="plans"
              value={list.filters.consent}
              onValueChange={(consent) => list.setFilter('consent', consent)}
              options={CONSENT_OPTIONS}
            />
          </>
        }
        active={{
          noun: 'treatment plans',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Status',
              value:
                list.filters.status === 'all'
                  ? null
                  : statusLabel('treatmentPlan', list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
            {
              label: 'Consent',
              value: filterValueLabel(CONSENT_OPTIONS, list.filters.consent),
              onClear: () => list.setFilter('consent', 'all'),
            },
          ],
        }}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Procedures</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Estimated cost</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              failed={failed}
              onRetry={fetchPlans}
              empty={plans.length === 0}
              emptyIcon={FileText}
              emptyTitle="No treatment plans found"
              emptyDescription={
                list.isFiltered
                  ? 'No plan matches these filters.'
                  : 'No treatment plan has been drawn up yet.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : 'New treatment plan'}
              emptyActionHref={list.isFiltered ? undefined : '/treatments/plans/new'}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
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
                      <div className="font-medium tabular-nums">
                        {formatCurrency(plan.estimatedCost)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge kind="treatmentPlan" status={plan.status} />
                        {plan.consentGiven && (
                          <div
                            className={`flex items-center gap-1 text-xs ${TONE_TEXT_CLASS.success}`}
                          >
                            <CheckCircle className="h-3 w-3" />
                            Consent
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <GridActionsCell>
                      {/* `row-actions` comes with GridActionsCell. No "View
                          details": the row itself opens the plan. A finished or
                          cancelled plan has nothing left to edit. */}
                      {plan.status !== 'COMPLETED' && plan.status !== 'CANCELLED' && (
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
                              onClick={() =>
                                router.push(trail.to(`/treatments/plans/${plan.id}/edit`))
                              }
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </GridActionsCell>
                  </ClickableRow>
                )
              })}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="treatment plans"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  )
}
