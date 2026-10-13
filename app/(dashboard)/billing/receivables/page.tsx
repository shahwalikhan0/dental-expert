'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHead, TableHeader, TableRow, TableCell } from '@/components/ui/table'
import { GridActionsCell, GridActionsHead, GridBody } from '@/components/ui/data-grid'
import { AgeingStrip } from '@/components/billing/patient-ledger'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/billing-utils'
import { displayDate } from '@/lib/dates'
import { AGEING_BUCKETS, type Ageing } from '@/lib/ageing'
import type { ReceivableRow } from '@/lib/ledger'
import { Phone, Printer, Search, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [data, setData] = useState<Receivables | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
      const res = await fetch(`/api/billing/receivables?${params}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch])

  useEffect(() => {
    load()
  }, [load])

  const rows = data?.rows ?? []
  const totals = data?.totals

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Wallet className="h-6 w-6" />
            Receivables
          </h1>
          <p className="text-muted-foreground">
            {data
              ? data.patientsOwing === 0
                ? 'Nobody owes the clinic anything.'
                : `${formatCurrency(totals?.total ?? 0)} outstanding across ${data.patientsOwing} ${
                    data.patientsOwing === 1 ? 'patient' : 'patients'
                  }`
              : 'What has been billed and not paid'}
          </p>
        </div>
      </div>

      {totals && totals.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How old the debt is</CardTitle>
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

      <Card>
        <CardContent className="pt-6">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, patient number or phone"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

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
              emptyTitle={debouncedSearch.trim() ? 'No matches' : 'Nothing outstanding'}
              emptyDescription={
                debouncedSearch.trim()
                  ? 'Nobody in arrears matches that search.'
                  : 'Every invoice the clinic has raised has been settled.'
              }
            >
              {rows.map((row) => (
                <TableRow key={row.patientId}>
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
                        {row.phone}
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
                      {row.ageing[bucket.key] > 0 ? formatCurrency(row.ageing[bucket.key]) : '—'}
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
                        <Printer className="mr-2 h-4 w-4" />
                        Statement
                      </Link>
                    </Button>
                  </GridActionsCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>
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
