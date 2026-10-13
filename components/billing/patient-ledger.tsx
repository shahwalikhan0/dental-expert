'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { AlertCircle, CreditCard, Printer, Users } from 'lucide-react'
import { formatCurrency } from '@/lib/billing-utils'
import { formatDate } from '@/lib/i18n/format'
import { AGEING_BUCKETS, type Ageing } from '@/lib/ageing'
import type { Ledger } from '@/lib/ledger'
import { cn } from '@/lib/utils'

/**
 * The patient's account, as a running balance.
 *
 * What was here before was a list of invoices with their individual balances —
 * the same facts with the arithmetic left to whoever is standing at the desk
 * being asked "so what do I owe you?". A ledger answers that question in one
 * number and then shows its working.
 *
 * The family switch is off by default and is not merely cosmetic: two people
 * sharing a payer do not thereby consent to seeing each other's treatment
 * costs, so widening the view is something somebody chooses to do.
 */
export function PatientLedger({ patientId, className }: { patientId: string; className?: string }) {
  const [ledger, setLedger] = useState<
    (Ledger & { family?: { isShared: boolean; members: { id: string }[] } | null }) | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [family, setFamily] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/patients/${patientId}/ledger?family=${family}`)
      if (!res.ok) throw new Error()
      setLedger(await res.json())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [patientId, family])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !ledger) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (failed || !ledger) {
    return (
      <Card className={className}>
        <CardContent className="p-0">
          <EmptyState
            icon={AlertCircle}
            title="The account could not be loaded"
            description="Nothing has been changed. Try again in a moment."
            actionLabel="Try again"
            onAction={load}
          />
        </CardContent>
      </Card>
    )
  }

  const { summary, entries, ageing } = ledger
  const owing = summary.balance > 0
  const shared = ledger.family?.isShared ?? false

  return (
    <div className={cn('space-y-6', className)}>
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              {owing
                ? `${formatCurrency(summary.balance)} outstanding${
                    summary.overdue > 0
                      ? `, of which ${formatCurrency(summary.overdue)} is overdue`
                      : ''
                  }`
                : summary.balance < 0
                  ? `${formatCurrency(Math.abs(summary.balance))} in credit`
                  : 'Nothing outstanding'}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {shared && (
              <div className="flex items-center gap-2">
                <Switch
                  id="family-ledger"
                  checked={family}
                  onCheckedChange={setFamily}
                  aria-label="Show the whole account"
                />
                <Label htmlFor="family-ledger" className="flex items-center gap-1.5 text-sm">
                  <Users className="h-3.5 w-3.5" />
                  Whole account
                </Label>
              </div>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/patients/${patientId}/statement${family ? '?family=true' : ''}`}>
                <Printer className="mr-2 h-4 w-4" />
                Statement
              </Link>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <dl
            className={cn(
              'grid grid-cols-2 gap-4',
              summary.reversed > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
            )}
          >
            <Figure label="Charged" value={summary.charged} />
            <Figure label="Paid" value={summary.paid} />
            <Figure label="Refunded" value={summary.refunded} />
            {/* Only when there is one, so the figures on screen still add up
                to the balance: a refunded-in-full invoice is charged, paid,
                refunded and then reversed, and owes nothing. */}
            {summary.reversed > 0 && <Figure label="Reversed" value={-summary.reversed} />}
            <Figure
              label="Balance"
              value={summary.balance}
              tone={owing ? (summary.overdue > 0 ? 'bad' : 'warn') : 'good'}
            />
          </dl>

          {ageing.total > 0 && <AgeingStrip ageing={ageing} />}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="text-right">Charge</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={CreditCard}
                      title="Nothing on this account yet"
                      description="Charges and payments appear here as invoices are raised and settled."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={`${entry.kind}-${entry.id}`}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(entry.date)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {entry.href ? (
                        <Link href={entry.href} className="hover:underline">
                          {entry.reference}
                        </Link>
                      ) : (
                        entry.reference
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="flex items-center gap-2">
                        {entry.kind === 'REFUND' && (
                          <Badge variant="outline" className="shrink-0">
                            Refund
                          </Badge>
                        )}
                        {entry.kind === 'REVERSAL' && (
                          <Badge variant="outline" className="shrink-0">
                            Reversed
                          </Badge>
                        )}
                        {entry.description}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.debit > 0
                        ? formatCurrency(entry.debit)
                        : entry.debit < 0
                          ? `−${formatCurrency(-entry.debit)}`
                          : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        entry.balance > 0 && 'text-amber-700 dark:text-amber-300'
                      )}
                    >
                      {formatCurrency(entry.balance)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function Figure({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: number
  tone?: 'plain' | 'good' | 'warn' | 'bad'
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'good' && 'text-green-700 dark:text-green-300',
          tone === 'warn' && 'text-amber-700 dark:text-amber-300',
          tone === 'bad' && 'text-red-700 dark:text-red-300'
        )}
      >
        {formatCurrency(value)}
      </dd>
    </div>
  )
}

/**
 * The five buckets, as a bar the width of the debt.
 *
 * A table of five numbers makes you read all five to see where the trouble is.
 * A proportional bar makes a large 90+ segment the thing you see first, which
 * is the point of ageing a debt at all.
 */
export function AgeingStrip({ ageing }: { ageing: Ageing }) {
  const tones = [
    'bg-primary/60',
    'bg-amber-500/70',
    'bg-orange-500/70',
    'bg-red-500/75',
    'bg-red-700/80',
  ]

  return (
    <div className="space-y-3">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {AGEING_BUCKETS.map((bucket, index) => {
          const amount = ageing[bucket.key]
          if (amount <= 0) return null
          return (
            <div
              key={bucket.key}
              className={tones[index]}
              style={{ width: `${(amount / ageing.total) * 100}%` }}
              title={`${bucket.label}: ${formatCurrency(amount)}`}
            />
          )
        })}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {AGEING_BUCKETS.map((bucket, index) => (
          <div key={bucket.key} className="flex items-baseline gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', tones[index])} aria-hidden />
            <div>
              <dt className="text-xs text-muted-foreground" title={bucket.hint}>
                {bucket.label}
              </dt>
              <dd className="text-sm font-medium tabular-nums">
                {formatCurrency(ageing[bucket.key])}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  )
}
