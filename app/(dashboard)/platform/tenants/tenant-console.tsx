'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  usePagedRows,
} from '@/components/ui/data-grid'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { StatusBadge } from '@/components/ui/status-badge'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { useListParams } from '@/hooks/use-list-params'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { statusLabel, statusOptions } from '@/lib/status'
import { PLANS } from '@/lib/plans'

interface Tenant {
  id: string
  name: string
  slug: string
  email: string
  city: string | null
  isActive: boolean
  onboardingCompleted: boolean
  createdAt: string
  plan: string
  planName: string
  status: string
  currentPeriodEnd: string | null
  entitlements: { patients: number; staff: number; storageMb: number }
  patients: number
  users: number
}

/** TRIALING, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED — named and coloured as the badge is. */
const SUBSCRIPTION_STATUSES = statusOptions('tenant')

/** "84 of 100", or just the count when the plan does not cap it. */
function usage(count: number, limit: number): string {
  return limit < 0 ? String(count) : `${count} of ${limit}`
}

function nearLimit(count: number, limit: number): boolean {
  return limit > 0 && count >= limit * 0.8
}

export function TenantConsole() {
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [tenants, setTenants] = useState<Tenant[]>([])
  // The route hands back every clinic, so the paging is done here.
  const paged = usePagedRows(tenants)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  /** The search, kept in the address bar as the route's own `q`. */
  const list = useListParams({ defaults: {}, searchKey: 'q' })
  const search = list.query
  const { setPage } = paged

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const body = await readJson<{ tenants: Tenant[] }>(
        await fetch(`/api/platform/tenants?q=${encodeURIComponent(search)}`)
      )
      setTenants(body.tenants)
    } catch (err) {
      setFailed(true)
      toast(toastError('load the clinics', err))
    } finally {
      setLoading(false)
    }
  }, [search, toast])

  useEffect(() => {
    load()
  }, [load])

  // A new search starts from its first page.
  useEffect(() => {
    setPage(1)
  }, [search, setPage])

  async function change(tenant: Tenant, patch: Record<string, unknown>, describe: string) {
    setSaving(tenant.id)
    try {
      await readJson(
        await fetch(`/api/platform/tenants/${tenant.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      )
      toast(toastSuccess(`${tenant.name} ${describe}`))
      await load()
    } catch (err) {
      toast(toastError(`update ${tenant.name}`, err))
    } finally {
      setSaving(null)
    }
  }

  /**
   * Suspending or cancelling stops a clinic, so it asks first. Any other
   * status — trialing, active, past due — goes straight through.
   */
  async function changeStatus(tenant: Tenant, status: string) {
    if (status === tenant.status) return
    if (status === 'SUSPENDED') {
      const ok = await confirm({
        title: `Suspend clinic “${tenant.name}”?`,
        description:
          'It stops writing: nobody there can add or change records until it is moved to another status. It keeps its records and can still read and export them.',
        confirmLabel: 'Suspend clinic',
      })
      if (!ok) return
    } else if (status === 'CANCELLED') {
      const ok = await confirm({
        title: `Cancel the subscription for “${tenant.name}”?`,
        description:
          'The subscription is marked cancelled. The clinic keeps its records, and moving it to another status reinstates it.',
        confirmLabel: 'Cancel subscription',
        cancelLabel: 'Keep subscription',
      })
      if (!ok) return
    }
    await change(tenant, { status }, `set to ${statusLabel('tenant', status).toLowerCase()}`)
  }

  async function toggleActive(tenant: Tenant) {
    if (tenant.isActive) {
      const ok = await confirm({
        title: `Switch off clinic “${tenant.name}”?`,
        description:
          'Nobody at the clinic can sign in or write until it is reinstated. Its records are kept.',
        confirmLabel: 'Switch off clinic',
      })
      if (!ok) return
    }
    await change(
      tenant,
      { isActive: !tenant.isActive },
      tenant.isActive ? 'switched off' : 'switched back on'
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinics"
        description="Every clinic on this installation. Changes here are written to that clinic’s own audit trail."
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search clinics"
            placeholder="Search by name, slug or email…"
          />
        }
        active={{
          noun: 'clinics',
          onClearAll: list.clear,
          filters: [{ label: 'Search', value: list.query, onClear: () => list.setSearch('') }],
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading && tenants.length === 0
              ? 'Clinics'
              : `${tenants.length} clinic${tenants.length === 1 ? '' : 's'}`}
          </CardTitle>
          <CardDescription>
            Suspending a clinic stops it writing. It keeps its records and can still read and export
            them.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Clinic</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Patients</TableHead>
                <TableHead>Staff</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={6}
              loading={loading}
              failed={failed}
              onRetry={load}
              empty={paged.rows.length === 0}
              emptyIcon={Building2}
              emptyTitle={list.isFiltered ? 'No clinics match that search' : 'No clinics yet'}
              emptyDescription={
                list.isFiltered
                  ? 'Every clinic on the platform is listed here. Clear the search to see all of them.'
                  : 'A clinic appears here once it has signed up.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : undefined}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {paged.rows.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <div className="font-medium">{tenant.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {tenant.slug}
                      {tenant.city ? ` · ${tenant.city}` : ''}
                      {tenant.onboardingCompleted ? '' : ' · onboarding'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={tenant.plan}
                      disabled={saving === tenant.id}
                      onValueChange={(plan) =>
                        change(
                          tenant,
                          { plan },
                          `moved to ${PLANS.find((p) => p.id === plan)?.name ?? plan}`
                        )
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-[130px] text-xs"
                        aria-label={`Plan for ${tenant.name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLANS.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {/* The status is the control: each option is its badge. */}
                    <Select
                      value={tenant.status}
                      disabled={saving === tenant.id}
                      onValueChange={(status) => changeStatus(tenant, status)}
                    >
                      <SelectTrigger
                        className="h-8 w-[150px] text-xs"
                        aria-label={`Subscription status for ${tenant.name}`}
                      >
                        <SelectValue>
                          <StatusBadge kind="tenant" status={tenant.status} />
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SUBSCRIPTION_STATUSES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <StatusBadge kind="tenant" status={option.value} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell
                    className={
                      nearLimit(tenant.patients, tenant.entitlements.patients)
                        ? 'text-amber-600 dark:text-amber-400'
                        : ''
                    }
                  >
                    {usage(tenant.patients, tenant.entitlements.patients)}
                  </TableCell>
                  <TableCell
                    className={
                      nearLimit(tenant.users, tenant.entitlements.staff)
                        ? 'text-amber-600 dark:text-amber-400'
                        : ''
                    }
                  >
                    {usage(tenant.users, tenant.entitlements.staff)}
                  </TableCell>
                  {/* GridActionsCell carries `row-actions`, which fades the button
                      back until the row is hovered or focused. */}
                  <GridActionsCell>
                    <Button
                      size="sm"
                      variant={tenant.isActive ? 'outline' : 'default'}
                      disabled={saving === tenant.id}
                      onClick={() => toggleActive(tenant)}
                    >
                      {tenant.isActive ? 'Switch off' : 'Reinstate'}
                    </Button>
                  </GridActionsCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="clinics"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </CardContent>
      </Card>

      {ConfirmDialogComponent}
    </div>
  )
}
