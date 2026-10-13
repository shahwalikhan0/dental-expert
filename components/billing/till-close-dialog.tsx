'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatCurrency, paymentMethodConfig } from '@/lib/billing-utils'
import {
  methodsToCount,
  parseCount,
  reconcile,
  totalVariance,
  varianceKind,
  type MethodTotal,
  type ReconciledLine,
} from '@/lib/till'
import type { PaymentMethod } from '@prisma/client'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function methodLabel(method: string): string {
  return paymentMethodConfig[method as PaymentMethod]?.label ?? method
}

/** Red for short, amber for over, green for balanced — a shortfall is the one to chase. */
export function varianceClass(variance: number): string {
  const kind = varianceKind(variance)
  if (kind === 'short') return 'text-red-600 dark:text-red-400'
  if (kind === 'over') return 'text-amber-600 dark:text-amber-400'
  return 'text-green-600 dark:text-green-400'
}

/** "Balanced", "Over by Rs 50.00", "Short by Rs 200.00". */
export function varianceText(variance: number): string {
  const kind = varianceKind(variance)
  if (kind === 'balanced') return 'Balanced'
  return `${kind === 'over' ? 'Over' : 'Short'} by ${formatCurrency(Math.abs(variance))}`
}

/**
 * Count the drawer down and close the till (FR-015).
 *
 * Two steps, so nobody closes on a typo: enter what was counted per method,
 * then see expected against counted and the variance before confirming. The
 * expected figures are fetched again on the way to the review — a payment may
 * have gone in while the cash was being counted — and the server stamps its
 * own on closing, behind a lock that stops any more arriving.
 */
export function TillCloseDialog({
  session,
  totals,
  open,
  onOpenChange,
  refreshTotals,
  onClosed,
}: {
  session: { id: string; sessionNo: string }
  totals: MethodTotal[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The live expected figures, or null if they could not be fetched. */
  refreshTotals: () => Promise<MethodTotal[] | null>
  onClosed: () => void
}) {
  const { toast } = useToast()
  const [step, setStep] = useState<'count' | 'review'>('count')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [closingNotes, setClosingNotes] = useState('')
  const [lines, setLines] = useState<ReconciledLine[]>([])
  const [busy, setBusy] = useState(false)

  const methods = methodsToCount(totals)
  const expectedBy = new Map(totals.map((t) => [t.paymentMethod, t.expected]))

  const reset = () => {
    setStep('count')
    setCounts({})
    setClosingNotes('')
    setLines([])
  }

  const handleOpenChange = (next: boolean) => {
    if (busy) return
    if (!next) reset()
    onOpenChange(next)
  }

  const review = async () => {
    const missing = methods.filter((m) => parseCount(counts[m]) === null)
    if (missing.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Enter every count',
        description: `Type what was counted for ${missing.map(methodLabel).join(', ')} — 0 if there is none.`,
      })
      return
    }

    setBusy(true)
    const latest = (await refreshTotals()) ?? totals
    setBusy(false)

    // A method that took money while the drawer was being counted, and was
    // not on the form, is counted as zero by the server — so it is shown here
    // too rather than appearing only in the stamped record.
    const toCount = methodsToCount(latest)
    const counted = toCount.map((m) => ({
      paymentMethod: m,
      countedAmount: parseCount(counts[m]) ?? 0,
    }))
    setLines(reconcile(latest, counted).filter((l) => toCount.includes(l.paymentMethod)))
    setStep('review')
  }

  const confirmClose = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/cashier-sessions/${session.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counts: lines.map((l) => ({
            paymentMethod: l.paymentMethod,
            countedAmount: l.countedAmount,
          })),
          closingNotes: closingNotes.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The till could not be closed')

      const variance = Number(data?.data?.totalVariance ?? 0)
      toast({
        title: `${session.sessionNo} closed`,
        description: `${varianceText(variance)}. The count is kept with the session.`,
      })
      reset()
      onOpenChange(false)
      onClosed()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not close the till',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  const total = totalVariance(lines)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {step === 'count' ? `Count down ${session.sessionNo}` : 'Check before closing'}
          </DialogTitle>
          <DialogDescription>
            {step === 'count'
              ? 'Enter what is actually there for each method: the cash in the drawer, and the card, wallet and transfer totals from their slips.'
              : 'This is what will be recorded. Once closed, a till cannot be reopened or recounted.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'count' ? (
          <div className="space-y-4">
            {methods.map((method) => {
              const expected = expectedBy.get(method) ?? 0
              const value = parseCount(counts[method])
              return (
                <div key={method} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor={`count-${method}`}>{methodLabel(method)}</Label>
                    <span className="text-xs text-muted-foreground">
                      Expected {formatCurrency(expected)}
                    </span>
                  </div>
                  <Input
                    id={`count-${method}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="Counted"
                    value={counts[method] ?? ''}
                    onChange={(e) => setCounts((c) => ({ ...c, [method]: e.target.value }))}
                  />
                  {value !== null && (
                    <p className={cn('text-xs', varianceClass(value - expected))}>
                      {varianceText(value - expected)}
                    </p>
                  )}
                </div>
              )
            })}

            <div className="space-y-1.5">
              <Label htmlFor="closing-notes">Closing notes</Label>
              <Textarea
                id="closing-notes"
                rows={2}
                maxLength={1000}
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder="Anything that explains a difference — a note left in the drawer, a slip missing"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[360px] text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Method</th>
                    <th className="px-3 py-2 text-right font-medium">Expected</th>
                    <th className="px-3 py-2 text-right font-medium">Counted</th>
                    <th className="px-3 py-2 text-right font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.paymentMethod} className="border-t">
                      <td className="px-3 py-2">{methodLabel(l.paymentMethod)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(l.expected)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(l.countedAmount)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          varianceClass(l.varianceAmount)
                        )}
                      >
                        {formatCurrency(l.varianceAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-sm font-medium',
                varianceClass(total)
              )}
            >
              Overall: {varianceText(total)}
            </div>
            {closingNotes.trim() && (
              <p className="text-sm text-muted-foreground">Notes: {closingNotes.trim()}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 'count' ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={review} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Review
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('count')} disabled={busy}>
                Back to counts
              </Button>
              <Button onClick={confirmClose} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Close till
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
