'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/billing-utils'
import { Calendar, CreditCard, FileText, Loader2, ReceiptText, User } from 'lucide-react'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
import { StatusBadge } from '@/components/ui/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { displayDate } from '@/lib/dates'
import { useToast } from '@/hooks/use-toast'
import { usePrint } from '@/hooks/use-print'
import { PrintDocument } from '@/components/print/print-document'
import { PrintButton } from '@/components/print/print-button'
import { ReceiptPrint } from '@/components/print/templates/receipt-print'

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

export default function PaymentReceiptPage() {
  const params = useParams()
  const paymentId = params.id as string

  const [payment, setPayment] = useState<Payment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const trail = useTrail(payment?.paymentNo ?? null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/payments/${paymentId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'That payment could not be loaded')
        setPayment(data)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load the payment'
        // The page still says so in place of the receipt; the toast makes sure
        // the failure is noticed rather than read as an empty page.
        setError(message)
        toast({ variant: 'destructive', title: 'Could not load the receipt', description: message })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [paymentId, toast])

  const printing = usePrint({
    documentTitle: payment ? `Receipt ${payment.paymentNo}` : 'Receipt',
  })

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

  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'
  const method = METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod

  return (
    <div className="space-y-6">
      {/* What goes on paper: a template, not this page. */}
      <PrintDocument printing={printing}>
        <ReceiptPrint payment={payment} />
      </PrintDocument>

      {/* The payment as a record: who paid, when, how much; printing the
          receipt is the one thing done from here. */}
      <ProfileHeader
        eyebrow={`Receipt · ${payment.paymentNo}`}
        name={patientName}
        avatarIcon={ReceiptText}
        badges={<StatusBadge kind="payment" status={payment.status} />}
        facts={[
          { icon: Calendar, label: displayDate(payment.paymentDate) },
          { icon: CreditCard, label: method },
          { icon: FileText, label: payment.invoice.invoiceNo },
        ]}
        actions={<PrintButton printing={printing} label="Print receipt" />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* The receipt as the patient reads it, on screen. */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <div className="border-b pb-5 text-center">
              <h2 className="text-xl font-bold tracking-tight">
                {payment.clinic?.name ?? 'Receipt'}
              </h2>
              {payment.clinic && (
                <p className="text-sm text-muted-foreground">
                  {[payment.clinic.address, payment.clinic.city].filter(Boolean).join(', ')}
                  {payment.clinic.phone ? ` · ${payment.clinic.phone}` : ''}
                </p>
              )}
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Payment receipt
              </p>
            </div>

            <InfoGrid className="border-b py-6">
              <InfoItem label="Receipt no.">{payment.paymentNo}</InfoItem>
              <InfoItem label="Date">{displayDate(payment.paymentDate)}</InfoItem>
              <InfoItem label="Received from">
                {patientName}
                {patient && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {patient.patientId}
                    {patient.phone ? ` · ${patient.phone}` : ''}
                  </span>
                )}
              </InfoItem>
              <InfoItem label="Against invoice">{payment.invoice.invoiceNo}</InfoItem>
            </InfoGrid>

            <div className="space-y-3 border-b py-6 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3">
                <span className="text-muted-foreground">Amount received</span>
                <span className="text-2xl font-bold tracking-tight tabular-nums">
                  {formatCurrency(Number(payment.amount))}
                </span>
              </div>
              <InfoGrid>
                <InfoItem label="Paid by">{method}</InfoItem>
                {payment.transactionId && (
                  <InfoItem label="Reference">
                    <span className="font-mono text-xs">{payment.transactionId}</span>
                  </InfoItem>
                )}
              </InfoGrid>
            </div>

            {refunded > 0 && (
              <div className="space-y-2 border-b py-6 text-sm">
                <p className="font-semibold">Refunded against this payment</p>
                {payment.refunds.map((refund) => (
                  <div
                    key={refund.id}
                    className="flex justify-between gap-3 rounded-xl border px-4 py-3"
                  >
                    <span className="text-muted-foreground">
                      {refund.refundNo} · {displayDate(refund.refundedAt)} · {refund.reason}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      −{formatCurrency(Number(refund.amount))}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-1 font-semibold">
                  <span>Net retained</span>
                  <span className="tabular-nums">
                    {formatCurrency(Number(payment.amount) - refunded)}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2 py-6 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice total</span>
                <span className="tabular-nums">
                  {formatCurrency(Number(payment.invoice.totalAmount))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid to date</span>
                <span className="tabular-nums">
                  {formatCurrency(Number(payment.invoice.paidAmount))}
                </span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Balance due</span>
                <span className="tabular-nums">
                  {formatCurrency(Number(payment.invoice.balanceAmount))}
                </span>
              </div>
            </div>

            {payment.notes && (
              <p className="border-t pt-3 text-xs text-muted-foreground">{payment.notes}</p>
            )}

            <p className="mt-4 border-t pt-4 text-center text-xs text-muted-foreground">
              This receipt acknowledges the amount shown above. Any balance stated remains payable.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Where this payment came from, one row each. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Related</CardTitle>
            </CardHeader>
            <CardContent>
              <LinkList>
                <LinkRow
                  href={trail.to(`/billing/invoices/${payment.invoice.id}`)}
                  icon={FileText}
                  title={payment.invoice.invoiceNo}
                  subtitle={`Invoice · balance ${formatCurrency(Number(payment.invoice.balanceAmount))}`}
                />
                {patient && (
                  <LinkRow
                    href={trail.to(`/patients/${patient.id}`)}
                    icon={User}
                    title={patientName}
                    subtitle={`Patient · ${patient.patientId}`}
                  />
                )}
              </LinkList>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
