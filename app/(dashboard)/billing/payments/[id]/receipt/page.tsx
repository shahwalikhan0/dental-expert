'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/billing-utils'
import { Loader2, Printer } from 'lucide-react'

/**
 * A receipt for one payment — UAT-07, "receive partial payment and issue
 * receipt".
 *
 * The printed invoice lists payments, but an invoice is a demand and a receipt
 * is an acknowledgement; a patient who has paid half a bill in cash is owed
 * something that says so, with the balance still due stated on it so there is
 * no argument later about what was settled.
 *
 * Refunds against the payment are shown when there are any. A receipt for five
 * thousand, two of which went back the same afternoon, would otherwise be a
 * true document that misleads.
 */

interface Refund {
  id: string
  refundNo: string
  amount: string | number
  refundMethod: string
  reason: string
  refundedAt: string
}

interface Payment {
  id: string
  paymentNo: string
  amount: string | number
  paymentMethod: string
  paymentDate: string
  transactionId: string | null
  status: string
  notes: string | null
  refunds: Refund[]
  clinic: {
    name: string
    address: string | null
    city: string | null
    phone: string | null
    email: string | null
  } | null
  invoice: {
    id: string
    invoiceNo: string
    totalAmount: string | number
    paidAmount: string | number
    balanceAmount: string | number
    patient: {
      id: string
      patientId: string
      firstName: string
      lastName: string
      phone: string | null
    } | null
  }
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  WALLET: 'Wallet',
  ONLINE: 'Online',
}

const longDate = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

export default function PaymentReceiptPage() {
  const params = useParams()
  const paymentId = params.id as string

  const [payment, setPayment] = useState<Payment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const trail = useTrail(payment?.paymentNo ?? null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/payments/${paymentId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'That payment could not be loaded')
        setPayment(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the payment')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [paymentId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !payment) {
    return (
      <div className="space-y-4">
        <BackLink trail={trail} fallback="/billing/payments" fallbackLabel="Payments" />
        <p className="text-sm text-muted-foreground">{error ?? 'Payment not found.'}</p>
      </div>
    )
  }

  const patient = payment.invoice.patient
  const refunded = payment.refunds.reduce((sum, r) => sum + Number(r.amount), 0)

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="no-print space-y-4">
        <BackLink trail={trail} fallback="/billing/payments" fallbackLabel="Payments" />
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            Print receipt
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-background p-8 print:border-0 print:p-0">
        <div className="text-center border-b pb-4">
          <h1 className="text-xl font-bold">{payment.clinic?.name ?? 'Receipt'}</h1>
          {payment.clinic && (
            <p className="text-sm text-muted-foreground">
              {[payment.clinic.address, payment.clinic.city].filter(Boolean).join(', ')}
              {payment.clinic.phone ? ` · ${payment.clinic.phone}` : ''}
            </p>
          )}
          <p className="mt-3 text-sm font-semibold tracking-wide uppercase">Payment receipt</p>
        </div>

        <div className="grid grid-cols-2 gap-4 py-5 text-sm border-b">
          <div>
            <p className="text-muted-foreground">Receipt no.</p>
            <p className="font-medium">{payment.paymentNo}</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">Date</p>
            <p className="font-medium">{longDate(payment.paymentDate)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Received from</p>
            <p className="font-medium">
              {patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'}
            </p>
            {patient && (
              <p className="text-xs text-muted-foreground">
                {patient.patientId}
                {patient.phone ? ` · ${patient.phone}` : ''}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">Against invoice</p>
            <p className="font-medium">
              <Link
                href={trail.to(`/billing/invoices/${payment.invoice.id}`)}
                className="hover:underline print:no-underline"
              >
                {payment.invoice.invoiceNo}
              </Link>
            </p>
          </div>
        </div>

        <div className="py-5 space-y-2 text-sm border-b">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount received</span>
            <span className="text-lg font-bold">{formatCurrency(Number(payment.amount))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid by</span>
            <span>{METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod}</span>
          </div>
          {payment.transactionId && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reference</span>
              <span className="font-mono text-xs">{payment.transactionId}</span>
            </div>
          )}
        </div>

        {refunded > 0 && (
          <div className="py-5 space-y-2 text-sm border-b">
            <p className="font-medium">Refunded against this payment</p>
            {payment.refunds.map((refund) => (
              <div key={refund.id} className="flex justify-between">
                <span className="text-muted-foreground">
                  {refund.refundNo} · {longDate(refund.refundedAt)} · {refund.reason}
                </span>
                <span>−{formatCurrency(Number(refund.amount))}</span>
              </div>
            ))}
            <div className="flex justify-between font-medium pt-1">
              <span>Net retained</span>
              <span>{formatCurrency(Number(payment.amount) - refunded)}</span>
            </div>
          </div>
        )}

        <div className="py-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice total</span>
            <span>{formatCurrency(Number(payment.invoice.totalAmount))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid to date</span>
            <span>{formatCurrency(Number(payment.invoice.paidAmount))}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Balance due</span>
            <span>{formatCurrency(Number(payment.invoice.balanceAmount))}</span>
          </div>
        </div>

        {payment.notes && (
          <p className="text-xs text-muted-foreground border-t pt-3">{payment.notes}</p>
        )}

        <p className="text-xs text-center text-muted-foreground border-t pt-4 mt-4">
          This receipt acknowledges the amount shown above. Any balance stated remains payable.
        </p>
      </div>
    </div>
  )
}
