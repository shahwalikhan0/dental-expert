'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { formatCurrency, formatDateTime } from '@/lib/billing-utils'
import {
  closedSessionTotals,
  methodsToCount,
  parseCount,
  sumTotals,
  type MethodTotal,
} from '@/lib/till'
import {
  TillCloseDialog,
  methodLabel,
  varianceClass,
  varianceText,
} from '@/components/billing/till-close-dialog'
import { cn } from '@/lib/utils'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw, Vault } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { FormSection } from '@/components/ui/form-section'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { StatTile } from '@/components/ui/stat-tile'

/**
 * Billing → Till (FR-015, bug report 12 Oct, finding 38).
 *
 * The cashier-session API had been complete for a while, but nothing on screen
 * could open or close a till, so payments were taken with none open and fell
 * outside every reconciliation. Payments are now refused with no till open,
 * which makes this the screen the day starts on: open the till with its float,
 * watch what it should hold, and at the end count it down and record the
 * variance.
 *
 * Opening is `billing:write` (reception); closing is `billing:closing`, held by
 * the manager and the accountant — the person who took the money is not the one
 * who signs off what is in the drawer.
 */

interface Person {
  id: string
  name: string
}

interface SessionCount {
  id: string
  paymentMethod: string
  expectedAmount: string | number
  countedAmount: string | number
  varianceAmount: string | number
  notes: string | null
}

interface SessionRow {
  id: string
  sessionNo: string
  status: 'OPEN' | 'CLOSED'
  openingFloat: string | number
  openedAt: string
  openingNotes: string | null
  closedAt: string | null
  closingNotes: string | null
  openedBy: Person | null
  closedBy: Person | null
  counts: SessionCount[]
  _count?: { payments: number; refunds: number }
}

interface SessionDetail extends SessionRow {
  totals: MethodTotal[]
  payments: Array<{
    id: string
    paymentNo: string
    amount: string | number
    paymentMethod: string
    paymentDate: string
    status: string
    invoice: { invoiceNo: string } | null
  }>
  refunds: Array<{
    id: string
    refundNo: string
    amount: string | number
    refundMethod: string
    refundedAt: string
  }>
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'The till could not be loaded')
  return body as T
}

/**
 * Everything the screen shows: the open tills, the one to show in detail with
 * its live totals, and the recent closings.
 *
 * The till shown is the one asked for, else the viewer's own, else the newest.
 * Normally there is only one.
 */
async function fetchTill(
  prefer: string | null,
  myId: string | null
): Promise<{ opened: SessionRow[]; closed: SessionRow[]; selected: SessionDetail | null }> {
  const [openList, closedList] = await Promise.all([
    getJson<{ data: SessionRow[] }>('/api/cashier-sessions?status=OPEN&limit=10'),
    getJson<{ data: SessionRow[] }>('/api/cashier-sessions?status=CLOSED&limit=15'),
  ])
  const opened = openList.data ?? []
  const pick =
    opened.find((s) => s.id === prefer) ??
    opened.find((s) => s.openedBy?.id === myId) ??
    opened[0] ??
    null
  const selected = pick
    ? (await getJson<{ data: SessionDetail }>(`/api/cashier-sessions/${pick.id}`)).data
    : null
  return { opened, closed: closedList.data ?? [], selected }
}

export default function TillPage() {
  const { toast } = useToast()
  const { data: authSession } = useSession()
  const myId = authSession?.user?.id ?? null
  const canOpen = useCan('billing:write')
  const canClose = useCan('billing:closing')

  const [loading, setLoading] = useState(true)
  const [openSessions, setOpenSessions] = useState<SessionRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [closed, setClosed] = useState<SessionRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  const [float, setFloat] = useState('')
  const [openingNotes, setOpeningNotes] = useState('')
  const [opening, setOpening] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)

  // Only the newest load may write to the screen; a slow answer to an earlier
  // one would otherwise put back a till that has since been closed.
  const latest = useRef(0)

  const load = useCallback(
    (prefer?: string | null) => {
      const requestId = ++latest.current
      return fetchTill(prefer ?? null, myId)
        .then((data) => {
          if (requestId !== latest.current) return
          setOpenSessions(data.opened)
          setClosed(data.closed)
          setSelectedId(data.selected?.id ?? null)
          setDetail(data.selected)
        })
        .catch((err) => {
          if (requestId !== latest.current) return
          toast({
            variant: 'destructive',
            title: 'Could not load the till',
            description: err instanceof Error ? err.message : undefined,
          })
        })
        .finally(() => {
          if (requestId === latest.current) setLoading(false)
        })
    },
    [myId, toast]
  )

  useEffect(() => {
    load()
  }, [load])

  /** The live expected figures, refetched for the closing review. */
  const refreshTotals = useCallback(async (): Promise<MethodTotal[] | null> => {
    if (!selectedId) return null
    try {
      const { data } = await getJson<{ data: SessionDetail }>(`/api/cashier-sessions/${selectedId}`)
      setDetail(data)
      return data.status === 'OPEN' ? data.totals : null
    } catch {
      return null
    }
  }, [selectedId])

  const openTill = async (event: React.FormEvent) => {
    event.preventDefault()
    const amount = float.trim() === '' ? 0 : parseCount(float)
    if (amount === null) {
      toast({
        variant: 'destructive',
        title: 'Check the float',
        description: 'The opening float is the cash put in the drawer to give change — 0 or more.',
      })
      return
    }

    setOpening(true)
    try {
      const res = await fetch('/api/cashier-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingFloat: amount, openingNotes: openingNotes.trim() || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Somebody else opened one a moment ago: show theirs.
        if (res.status === 409) await load(body?.session?.id ?? null)
        throw new Error(body.error || 'The till could not be opened')
      }
      toast({
        title: body.data?.sessionNo ? `Till ${body.data.sessionNo} open` : 'Till open',
        description: `Float ${formatCurrency(amount)}. Payments can be taken now.`,
      })
      setFloat('')
      setOpeningNotes('')
      await load(body.data?.id ?? null)
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not open the till',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setOpening(false)
    }
  }

  const totals = detail?.status === 'OPEN' ? detail.totals : []
  const shown = totals.filter((t) => methodsToCount(totals).includes(t.paymentMethod))
  const summary = sumTotals(totals)
  const others = openSessions.filter((s) => s.id !== selectedId)

  const tillOpen = detail?.status === 'OPEN'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Till"
        description="Open the drawer at the start of the day and count it down at the end. Payments can only be taken while a till is open."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true)
                load(selectedId)
              }}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            {/* Closing is the next step on an open till, for those who sign it off. */}
            {tillOpen && canClose && (
              <Button onClick={() => setCloseOpen(true)}>
                <Vault className="h-4 w-4" />
                Count and close
              </Button>
            )}
          </>
        }
      />

      {loading && !detail && openSessions.length === 0 && closed.length === 0 ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {others.length > 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600/10">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-semibold">More than one till is open</p>
                <p className="text-amber-900/80 dark:text-amber-200/80">
                  Each payment goes into the till of the person taking it. Close the extra ones so
                  the day reconciles in one place.
                </p>
                <div className="flex flex-wrap gap-2">
                  {others.map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setLoading(true)
                        load(s.id)
                      }}
                    >
                      Show {s.sessionNo}
                      {s.openedBy?.name ? ` (${s.openedBy.name})` : ''}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {detail && detail.status === 'OPEN' ? (
            <>
              {/* What the drawer should hold right now. */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Opening float" value={formatCurrency(detail.openingFloat)} />
                <StatTile label="Taken" tone="success" value={formatCurrency(summary.received)} />
                <StatTile label="Refunded" value={formatCurrency(summary.refunded)} />
                <StatTile
                  label="Should be in the till"
                  icon={Vault}
                  value={formatCurrency(summary.expected)}
                />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>By method</CardTitle>
                      <CardDescription>
                        Taken and refunded in this till, and what each method should come to
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto p-0">
                      <Table className="min-w-[460px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Method</TableHead>
                            <TableHead className="text-right">Taken</TableHead>
                            <TableHead className="text-right">Refunded</TableHead>
                            <TableHead className="text-right">Expected</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {shown.map((t) => (
                            <TableRow key={t.paymentMethod}>
                              <TableCell>
                                {methodLabel(t.paymentMethod)}
                                {t.paymentMethod === 'CASH' && Number(detail.openingFloat) > 0 && (
                                  <span className="block text-xs text-muted-foreground">
                                    includes the float
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(t.received)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(t.refunded)}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {formatCurrency(t.expected)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <LatestMovements detail={detail} />
                </div>

                <div className="space-y-6">
                  <Card>
                    <CardHeader className="pb-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{detail.sessionNo}</CardTitle>
                        <Badge variant="success">Open</Badge>
                      </div>
                      <CardDescription>The till payments are going into</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <InfoGrid className="sm:grid-cols-1">
                        <InfoItem label="Opened by">{detail.openedBy?.name ?? 'unknown'}</InfoItem>
                        <InfoItem label="Opened">{formatDateTime(detail.openedAt)}</InfoItem>
                        {detail.openingNotes && (
                          <InfoItem label="Opening notes">
                            <span className="whitespace-pre-wrap font-normal">
                              {detail.openingNotes}
                            </span>
                          </InfoItem>
                        )}
                      </InfoGrid>
                      {canClose === false && (
                        <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
                          Closing is done by a manager or the accountant, who count the drawer
                          against these figures.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          ) : (
            <FormSection
              title="No till is open"
              description="Payments, and refunds paid out in cash, are refused until a till is open, so that every rupee taken is in a closing."
            >
              {canOpen ? (
                <form onSubmit={openTill} className="max-w-md space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="float">Opening float</Label>
                    <Input
                      id="float"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={float}
                      onChange={(e) => setFloat(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Cash put in the drawer for change. It is counted back out at closing.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="opening-notes">Notes (optional)</Label>
                    <Textarea
                      id="opening-notes"
                      rows={2}
                      maxLength={500}
                      value={openingNotes}
                      onChange={(e) => setOpeningNotes(e.target.value)}
                      placeholder="e.g. float counted with the manager"
                    />
                  </div>
                  <Button type="submit" disabled={opening} className="w-full sm:w-auto">
                    {opening ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Vault className="h-4 w-4" />
                    )}
                    Open till
                  </Button>
                </form>
              ) : canOpen === false ? (
                <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                  Ask somebody at the front desk to open the till.
                </p>
              ) : null}
            </FormSection>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Recent closings</CardTitle>
              <CardDescription>
                What each till should have held, what was counted, and the difference. Select one to
                see it by method.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Till</TableHead>
                    <TableHead>Opened</TableHead>
                    <TableHead>Closed</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closed.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No till has been closed yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    closed.map((s) => {
                      const t = closedSessionTotals(s.counts)
                      const isOpen = expanded === s.id
                      return (
                        <Fragment key={s.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() => setExpanded(isOpen ? null : s.id)}
                          >
                            <TableCell>
                              <button
                                type="button"
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? 'Hide' : 'Show'} the count for ${s.sessionNo}`}
                                className="text-muted-foreground"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setExpanded(isOpen ? null : s.id)
                                }}
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell className="font-medium">{s.sessionNo}</TableCell>
                            <TableCell>
                              <div>{formatDateTime(s.openedAt)}</div>
                              <div className="text-xs text-muted-foreground">
                                {s.openedBy?.name ?? '—'}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div>{formatDateTime(s.closedAt)}</div>
                              <div className="text-xs text-muted-foreground">
                                {s.closedBy?.name ?? '—'}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(t.expected)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(t.counted)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right font-medium tabular-nums',
                                varianceClass(t.variance)
                              )}
                            >
                              {formatCurrency(t.variance)}
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell />
                              <TableCell colSpan={6}>
                                <ClosedBreakdown session={s} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {detail && detail.status === 'OPEN' && (
        <TillCloseDialog
          session={detail}
          totals={detail.totals}
          open={closeOpen}
          onOpenChange={setCloseOpen}
          refreshTotals={refreshTotals}
          onClosed={() => {
            setLoading(true)
            load()
          }}
        />
      )}
    </div>
  )
}

/** The last few payments and refunds in the open till, newest first. */
function LatestMovements({ detail }: { detail: SessionDetail }) {
  const rows = [
    ...detail.payments.map((p) => ({
      key: `p-${p.id}`,
      at: p.paymentDate,
      label: p.invoice?.invoiceNo ? `${p.paymentNo} · ${p.invoice.invoiceNo}` : p.paymentNo,
      method: p.paymentMethod,
      amount: Number(p.amount),
    })),
    ...detail.refunds.map((r) => ({
      key: `r-${r.id}`,
      at: r.refundedAt,
      label: `${r.refundNo} · refund`,
      method: r.refundMethod,
      amount: -Number(r.amount),
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 8)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest in this till</CardTitle>
        <CardDescription>
          {detail.payments.length} payment{detail.payments.length === 1 ? '' : 's'} ·{' '}
          {detail.refunds.length} refund{detail.refunds.length === 1 ? '' : 's'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
            Nothing taken yet. Payments recorded on an invoice land here.{' '}
            <Link href="/billing/invoices" className="text-primary hover:underline">
              Go to invoices
            </Link>
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {methodLabel(row.method)} · {formatDateTime(row.at)}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 font-semibold tabular-nums',
                    row.amount < 0 && 'text-red-600 dark:text-red-400'
                  )}
                >
                  {formatCurrency(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** A closed session's stamped count, method by method. */
function ClosedBreakdown({ session }: { session: SessionRow }) {
  const counts = session.counts.filter(
    (c) =>
      c.paymentMethod === 'CASH' ||
      Number(c.expectedAmount) !== 0 ||
      Number(c.countedAmount) !== 0 ||
      Number(c.varianceAmount) !== 0
  )
  const t = closedSessionTotals(session.counts)

  return (
    <div className="space-y-3 py-1">
      <div className="grid gap-1 text-sm">
        {counts.map((c) => (
          <div key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span>{methodLabel(c.paymentMethod)}</span>
            <span className="tabular-nums text-muted-foreground">
              expected {formatCurrency(c.expectedAmount)} · counted{' '}
              {formatCurrency(c.countedAmount)} ·{' '}
              <span className={varianceClass(Number(c.varianceAmount))}>
                {formatCurrency(c.varianceAmount)}
              </span>
            </span>
            {c.notes && <span className="w-full text-xs text-muted-foreground">{c.notes}</span>}
          </div>
        ))}
      </div>
      <p className={cn('text-sm font-medium', varianceClass(t.variance))}>
        {varianceText(t.variance)}
      </p>
      <p className="text-xs text-muted-foreground">
        Float {formatCurrency(session.openingFloat)}
        {session._count
          ? ` · ${session._count.payments} payments · ${session._count.refunds} refunds`
          : ''}
      </p>
      {session.openingNotes && (
        <p className="text-sm">
          <span className="text-muted-foreground">Opening notes: </span>
          {session.openingNotes}
        </p>
      )}
      {session.closingNotes && (
        <p className="text-sm">
          <span className="text-muted-foreground">Closing notes: </span>
          {session.closingNotes}
        </p>
      )}
    </div>
  )
}
