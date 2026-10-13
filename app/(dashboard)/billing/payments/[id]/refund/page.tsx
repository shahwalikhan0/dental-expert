'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useOpenTill } from '@/hooks/use-open-till'
import { NoTillNotice } from '@/components/billing/no-till-notice'
import { NO_OPEN_TILL, refundNeedsOpenTill } from '@/lib/till'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/billing-utils'
import { Loader2, Undo2 } from 'lucide-react'

/**
 * FR-014 — record a refund against a payment.
 *
 * The payments list has offered a "Refund" action all along; it pushed to this
 * address, and this page did not exist, so the only way to give a patient their
 * money back through the interface was a 404. The API behind it was complete.
 *
 * The method defaults to the one the money arrived by but can be changed, since
 * a card payment is often refunded in cash, and the till has to see the outflow
 * under the method it actually left by.
 */

const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'ONLINE', label: 'Online' },
]

interface Refund {
  id: string
  refundNo: string
  amount: string | number
  refundMethod: string
  reason: string
  refundedAt: string
  authorisedBy: { id: string; name: string } | null
}

interface Payment {
  id: string
  paymentNo: string
  amount: string | number
  paymentMethod: string
  paymentDate: string
  status: string
  refunds: Refund[]
  invoice: {
    id: string
    invoiceNo: string
    patient: { id: string; patientId: string; firstName: string; lastName: string } | null
  }
}

export default function RefundPaymentPage() {
  const router = useRouter()
  const params = useParams()
  const paymentId = params.id as string
  const { toast } = useToast()

  const [payment, setPayment] = useState<Payment | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('')
  const [reason, setReason] = useState('')
  const [transactionId, setTransactionId] = useState('')

  const trail = useTrail(payment?.paymentNo ?? null)

  // Cash paid back out needs an open till to come out of (finding 38); other
  // methods do not — see refundNeedsOpenTill.
  const openTill = useOpenTill()
  const blockedByTill = openTill.noTill && refundNeedsOpenTill(method)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/payments/${paymentId}`)
        if (!res.ok) throw new Error('That payment could not be loaded')
        const data = await res.json()
        setPayment(data)
        setMethod(data.paymentMethod)
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to load the payment',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [paymentId, toast])

  const paid = Number(payment?.amount ?? 0)
  const alreadyRefunded = (payment?.refunds ?? []).reduce((sum, r) => sum + Number(r.amount), 0)
  const refundable = paid - alreadyRefunded

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = Number(amount)

    // Checked here as well as in the route: the desk should be told before it
    // submits, and the route must not trust a number that reached it anyway.
    if (!Number.isFinite(value) || value <= 0) {
      toast({
        title: 'Enter an amount',
        description: 'A refund has to be greater than zero.',
        variant: 'destructive',
      })
      return
    }
    if (value > refundable) {
      toast({
        title: 'More than is refundable',
        description: `${formatCurrency(refundable)} of this payment has not been refunded yet.`,
        variant: 'destructive',
      })
      return
    }
    if (reason.trim().length < 3) {
      toast({
        title: 'A reason is required',
        description: 'Say why the money is going back — this is what the audit will show.',
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/payments/${paymentId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundAmount: value,
          refundReason: reason.trim(),
          refundMethod: method,
          transactionId: transactionId.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        // The till was closed since this page loaded; show the notice.
        if (data.code === NO_OPEN_TILL) openTill.markNoTill()
        throw new Error(data.error || 'The refund could not be recorded')
      }

      toast({ title: 'Refund recorded', description: data.message })
      router.push(`/billing/invoices/${payment?.invoice.id}`)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to record the refund',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!payment) {
    return (
      <div className="space-y-4">
        <BackLink trail={trail} fallback="/billing/payments" fallbackLabel="Payments" />
        <p className="text-sm text-muted-foreground">That payment could not be found.</p>
      </div>
    )
  }

  const patient = payment.invoice.patient

  return (
    <div className="space-y-6 max-w-2xl">
      <BackLink trail={trail} fallback="/billing/payments" fallbackLabel="Payments" />

      <div>
        <h1 className="page-title">Refund {payment.paymentNo}</h1>
        <p className="text-muted-foreground">
          {patient ? (
            <>
              <Link href={trail.to(`/patients/${patient.id}`)} className="hover:underline">
                {patient.firstName} {patient.lastName}
              </Link>
              {' · '}
            </>
          ) : null}
          <Link
            href={trail.to(`/billing/invoices/${payment.invoice.id}`)}
            className="hover:underline"
          >
            {payment.invoice.invoiceNo}
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">This payment</CardTitle>
          <CardDescription>What was taken, and what has gone back so far.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Received</p>
            <p className="font-medium">{formatCurrency(paid)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Already refunded</p>
            <p className="font-medium">{formatCurrency(alreadyRefunded)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Refundable</p>
            <p className="font-medium">{formatCurrency(refundable)}</p>
          </div>
        </CardContent>
      </Card>

      {payment.refunds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Earlier refunds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {payment.refunds.map((refund) => (
              <div key={refund.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{refund.refundNo}</span>
                  <span>{formatCurrency(Number(refund.amount))}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {refund.reason} · {refund.refundMethod.toLowerCase().replace('_', ' ')} ·{' '}
                  {refund.authorisedBy?.name ?? 'authoriser not recorded'}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {refundable <= 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            This payment has been refunded in full. There is nothing left to give back.
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Record a refund</CardTitle>
              <CardDescription>
                The reason and your name are kept against this refund permanently.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount *</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="0"
                    max={refundable}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={String(refundable)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="method">Refunded by *</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger id="method">
                      <SelectValue placeholder="Method" />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Reason *</Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this money going back?"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="transactionId">Transaction reference</Label>
                <Input
                  id="transactionId"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  placeholder="Optional — the bank or terminal reference"
                />
              </div>

              {blockedByTill && <NoTillNotice what="cash-refund" />}

              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" asChild>
                  <Link href={`/billing/invoices/${payment.invoice.id}`}>Cancel</Link>
                </Button>
                <Button type="submit" disabled={submitting || blockedByTill}>
                  {submitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Undo2 className="h-4 w-4 mr-2" />
                  )}
                  Record refund
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  )
}
