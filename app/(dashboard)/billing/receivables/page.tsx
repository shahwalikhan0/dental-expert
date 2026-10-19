'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableHead, TableHeader, TableRow, TableCell } from '@/components/ui/table'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  usePagedRows,
} from '@/components/ui/data-grid'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { AgeingStrip } from '@/components/billing/patient-ledger'
import { useListParams } from '@/hooks/use-list-params'
import { useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/billing-utils'
import { BLANK, displayDate } from '@/lib/dates'
import { cn, formatPhone } from '@/lib/utils'
import { AGEING_BUCKETS, type Ageing } from '@/lib/ageing'
import type { ReceivableRow } from '@/lib/ledger'
import { AlertCircle, Phone, Printer, Users, Wallet } from 'lucide-react'
import { StatTile } from '@/components/ui/stat-tile'

/**
 * Who owes the clinic money, and for how long.
 *
 * `/billing/reports` could say what came in over a period. Nothing could say
 * what has not come in — which is the question a practice answers on a Monday
 * morning by deciding who to telephone.
 *
 * Sorted oldest first rather than largest first, deliberately. A big bill
 * raised last week is not a problem; a small one outstanding since March is,
 * and a list sorted by amount buries it.
 */

interface Receivables {
  rows: ReceivableRow[]
  totals: Ageing
  patientsOwing: number
}

export default function ReceivablesPage() {
  const trail = useTrail('Receivables')
  // The search lives in the address bar, so opening a patient and coming back
  // keeps it. The hook debounces it; `list.query` is the settled term.
  const list = useListParams({ defaults: {} })
  const query = list.query
  const [data, setData] = useState<Receivables | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams()
      if (query) params.set('search', query)
      const res = await fetch(`/api/billing/receivables?${params}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // Fetching on mount and on change is what this effect is for; the state it
    // sets is the answer arriving.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const rows = data?.rows ?? []
  const totals = data?.totals
  // The route returns everyone in arrears at once; paged here rather than
  // drawing a thousand rows. Oldest debt first is the route's order.
  const paged = usePagedRows(rows)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receivables"
        description={
          data
            ? data.patientsOwing === 0
              ? 'Nobody owes the clinic anything.'
              : `${formatCurrency(totals?.total ?? 0)} outstanding across ${data.patientsOwing} ${
                  data.patientsOwing === 1 ? 'patient' : 'patients'
                }`
            : 'What has been billed and not paid'
        }
      />

      {/* The headline: how much, owed by how many, and how much of it is old.
          The route counts these over the patients the search matched. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Outstanding"
          icon={Wallet}
          tone={totals && totals.total > 0 ? 'danger' : 'default'}
          loading={!data && !failed}
          value={formatCurrency(totals?.total ?? 0)}
        />
        <StatTile
          label="Patients owing"
          icon={Users}
          loading={!data && !failed}
          value={data?.patientsOwing ?? 0}
        />
        <StatTile
          label="Over 90 days"
          icon={AlertCircle}
          tone={totals && totals.over90 > 0 ? 'danger' : 'default'}
          loading={!data && !failed}
          value={formatCurrency(totals?.over90 ?? 0)}
          hint="Past due for more than ninety days"
        />
      </div>

      {totals && totals.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>How old the debt is</CardTitle>
            <CardDescription>
              Days past each invoice&apos;s due date. Anything past ninety needs a telephone call
              rather than another statement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AgeingStrip ageing={totals} />
          </CardContent>
        </Card>
      )}

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search receivables"
            placeholder="Search by name, patient number or phone…"
          />
        }
        active={{
          noun: 'patients',
          onClearAll: list.clear,
          filters: [{ label: 'Search', value: query, onClear: () => list.setSearch('') }],
        }}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Billed to</TableHead>
                <TableHead>Oldest</TableHead>
                {AGEING_BUCKETS.map((bucket) => (
                  <TableHead key={bucket.key} className="text-right" title={bucket.hint}>
                    {bucket.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={10}
              loading={loading}
              failed={failed}
              onRetry={load}
              empty={rows.length === 0}
              emptyIcon={Wallet}
              emptyTitle={query ? 'No matches' : 'Nothing outstanding'}
              emptyDescription={
                query
                  ? 'Nobody in arrears matches that search.'
                  : 'Every invoice the clinic has raised has been settled.'
              }
              emptyActionLabel={query ? 'Clear the filters' : undefined}
              onEmptyAction={query ? list.clear : undefined}
            >
              {paged.rows.map((row) => (
                <ClickableRow
                  key={row.patientId}
                  href={trail.to(`/patients/${row.patientId}?tab=billing`)}
                  label={`Open ${row.name}`}
                >
                  <TableCell>
                    <Link
                      href={trail.to(`/patients/${row.patientId}?tab=billing`)}
                      className="font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{row.patientNo}</span>
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {formatPhone(row.phone)}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="text-sm">
                    {row.guarantorName ? (
                      <Link
                        href={trail.to(`/patients/${row.guarantorId}?tab=billing`)}
                        className="hover:underline"
                      >
                        {row.guarantorName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Themselves</span>
                    )}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {displayDate(row.oldestAt)}
                    <div className="text-xs">
                      {row.invoiceCount} {row.invoiceCount === 1 ? 'invoice' : 'invoices'}
                    </div>
                  </TableCell>

                  {AGEING_BUCKETS.map((bucket, index) => (
                    <TableCell
                      key={bucket.key}
                      className={cn(
                        'text-right tabular-nums',
                        row.ageing[bucket.key] === 0 && 'text-muted-foreground',
                        // Only the two oldest buckets are coloured. Tinting
                        // every column makes the row a rainbow and the one
                        // number that matters no easier to find.
                        index === 3 &&
                          row.ageing[bucket.key] > 0 &&
                          'text-orange-700 dark:text-orange-300',
                        index === 4 &&
                          row.ageing[bucket.key] > 0 &&
                          'text-red-700 dark:text-red-300'
                      )}
                    >
                      {row.ageing[bucket.key] > 0 ? formatCurrency(row.ageing[bucket.key]) : BLANK}
                    </TableCell>
                  ))}

                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(row.ageing.total)}
                  </TableCell>

                  <GridActionsCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        href={trail.to(
                          `/patients/${row.guarantorId ?? row.patientId}/statement${
                            row.guarantorId ? '?family=true' : ''
                          }`
                        )}
                      >
                        <Printer className="h-4 w-4" />
                        Statement
                      </Link>
                    </Button>
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="patients"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Oldest debt first. A recent large bill is not the problem; a small one outstanding since
          the spring is.
        </p>
      )}
    </div>
  )
}
