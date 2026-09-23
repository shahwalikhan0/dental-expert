'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { GridPagination, usePagedRows } from '@/components/ui/data-grid'
import { useToast } from '@/hooks/use-toast'
import { PLANS } from '@/lib/plans'
import { ActiveFilters } from '@/components/ui/active-filters'

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

const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const

/** Green for paying, amber for owing, red for stopped. */
const STATUS_TONE: Record<string, string> = {
  TRIALING: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  PAST_DUE: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  CANCELLED: 'bg-gray-200 text-gray-700',
}

/** "84 of 100", or just the count when the plan does not cap it. */
function usage(count: number, limit: number): string {
  return limit < 0 ? String(count) : `${count} of ${limit}`
}

function nearLimit(count: number, limit: number): boolean {
  return limit > 0 && count >= limit * 0.8
}

const SELECT_CLASS =
  'border-input bg-background h-8 rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50'

export function TenantConsole() {
  const { toast } = useToast()
  const [tenants, setTenants] = useState<Tenant[]>([])
  // The route hands back every clinic, so the paging is done here.
  const paged = usePagedRows(tenants)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(
    async (search = '') => {
      setLoading(true)
      try {
        const res = await fetch(`/api/platform/tenants?q=${encodeURIComponent(search)}`)
        if (!res.ok) throw new Error('Could not load clinics')
        setTenants((await res.json()).tenants)
      } catch {
        toast({ variant: 'destructive', title: 'Could not load clinics' })
      } finally {
        setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    load()
  }, [load])

  async function change(tenant: Tenant, patch: Record<string, unknown>, describe: string) {
    setSaving(tenant.id)
    try {
      const res = await fetch(`/api/platform/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error()
      toast({ title: `${tenant.name}: ${describe}` })
      await load(query)
    } catch {
      toast({ variant: 'destructive', title: `Could not update ${tenant.name}` })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clinics</h1>
        <p className="text-muted-foreground text-sm">
          Every clinic on this installation. Changes here are written to that clinic&apos;s own
          audit trail.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          load(query)
        }}
      >
        <div className="relative flex-1 max-w-sm">
          <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
          <Input
            className="pl-8"
            placeholder="Name, slug or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={loading}>
          Search
        </Button>
      </form>

      <ActiveFilters
        noun="clinics"
        onClearAll={() => {
          setQuery('')
          load('')
        }}
        filters={[
          {
            label: 'Search',
            value: query,
            onClear: () => {
              setQuery('')
              load('')
            },
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? 'Loading…' : `${tenants.length} clinic${tenants.length === 1 ? '' : 's'}`}
          </CardTitle>
          <CardDescription>
            Suspending a clinic stops it writing. It keeps its records and can still read and export
            them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading clinics…
            </div>
          ) : tenants.length === 0 ? (
            <p className="text-muted-foreground py-8 text-sm">No clinics match that search.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs uppercase">
                    <th className="py-2 pr-4 font-medium">Clinic</th>
                    <th className="py-2 pr-4 font-medium">Plan</th>
                    <th className="py-2 pr-4 font-medium">Subscription</th>
                    <th className="py-2 pr-4 font-medium">Patients</th>
                    <th className="py-2 pr-4 font-medium">Staff</th>
                    <th className="py-2 font-medium">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((tenant) => (
                    <tr key={tenant.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{tenant.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {tenant.slug}
                          {tenant.city ? ` · ${tenant.city}` : ''}
                          {tenant.onboardingCompleted ? '' : ' · onboarding'}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <select
                          className={SELECT_CLASS}
                          value={tenant.plan}
                          disabled={saving === tenant.id}
                          onChange={(e) =>
                            change(tenant, { plan: e.target.value }, `moved to ${e.target.value}`)
                          }
                        >
                          {PLANS.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 pr-4">
                        <select
                          className={SELECT_CLASS}
                          value={tenant.status}
                          disabled={saving === tenant.id}
                          onChange={(e) =>
                            change(tenant, { status: e.target.value }, `set ${e.target.value}`)
                          }
                        >
                          {SUBSCRIPTION_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                        <Badge
                          className={`ml-2 ${STATUS_TONE[tenant.status] ?? ''}`}
                          variant="secondary"
                        >
                          {tenant.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td
                        className={`py-3 pr-4 ${nearLimit(tenant.patients, tenant.entitlements.patients) ? 'text-amber-600 dark:text-amber-400' : ''}`}
                      >
                        {usage(tenant.patients, tenant.entitlements.patients)}
                      </td>
                      <td
                        className={`py-3 pr-4 ${nearLimit(tenant.users, tenant.entitlements.staff) ? 'text-amber-600 dark:text-amber-400' : ''}`}
                      >
                        {usage(tenant.users, tenant.entitlements.staff)}
                      </td>
                      <td className="py-3 row-actions">
                        <Button
                          size="sm"
                          variant={tenant.isActive ? 'outline' : 'default'}
                          disabled={saving === tenant.id}
                          onClick={() =>
                            change(
                              tenant,
                              { isActive: !tenant.isActive },
                              tenant.isActive ? 'switched off' : 'switched back on'
                            )
                          }
                        >
                          {tenant.isActive ? 'Switch off' : 'Reinstate'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
    </div>
  )
}
