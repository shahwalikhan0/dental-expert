'use client'

import { useState, useEffect, useRef, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { SubmitButton } from '@/components/ui/submit-button'
import {
  User,
  Phone,
  Mail,
  MapPin,
  Printer,
  CreditCard,
  Calendar,
  Clock,
  AlertCircle,
  IndianRupee,
  Banknote,
  Smartphone,
  Building2,
  Pencil,
  Send,
  Package,
  ShieldCheck,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { paymentMethodConfig, formatCurrency, numberToWords } from '@/lib/billing-utils'
import { invoiceDueState } from '@/lib/invoice-figures'
import { localDay } from '@/lib/appointment-time'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useSession } from 'next-auth/react'
import { useCan } from '@/hooks/use-can'
import { billTo } from '@/lib/invoice-links'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { displayDate, displayDateTime, isoDay } from '@/lib/dates'
import { toastError, toastSuccess } from '@/lib/toast-utils'
import { useToast } from '@/hooks/use-toast'
import { useOpenTill } from '@/hooks/use-open-till'
import { ToastAction } from '@/components/ui/toast'
import { NoTillNotice } from '@/components/billing/no-till-notice'
import { NO_OPEN_TILL, TILL_PATH } from '@/lib/till'

interface Invoice {
  id: string
  invoiceNo: string
  // The Invoice model has no `invoiceDate`. Three screens read one anyway, so
  // every invoice in the system rendered undated — including the printed copy.
  createdAt: string
  /** When it left DRAFT; null for a draft. The invoice date once issued. */
  issuedAt: string | null
  dueDate: string | null
  subtotal: string | number
  discountType: string
  discountValue: string | number
  discountAmount: string | number
  taxableAmount: string | number
  taxRate: string | number
  taxAmount: string | number
  totalAmount: string | number
  paidAmount: string | number
  balanceAmount: string | number
  status: string
  notes: string | null
  termsAndConditions: string | null
  discountReason: string | null
  discountApprovalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED'
  discountDecidedAt: string | null
  discountDecisionNote: string | null
  discountRequestedBy: { id: string; name: string } | null
  discountApprovedBy: { id: string; name: string } | null
  appointment: {
    id: string
    appointmentNo: string
    startsAt: string
    doctor: { firstName: string; lastName: string } | null
  } | null
  clinic: {
    name: string
    address: string | null
    city: string | null
    phone: string | null
    email: string | null
    taxRegistrationNo: string | null
    nationalTaxNo: string | null
    taxLabel: string | null
    timezone: string | null
  } | null
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    address: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    /** Who pays, for a dependant (a child's bill goes to the parent). */
    guarantor: {
      id: string
      patientId: string
      firstName: string
      lastName: string
      phone: string | null
    } | null
  }
  items: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: string | number
    amount: string | number
    taxable: boolean
    inventoryItem: { id: string; name: string; sku: string; unit: string } | null
    treatment: {
      id: string
      treatmentNo: string
      toothNumbers: string | null
      cost: string | number
      procedure: {
        id: string
        name: string
        code: string
        category: string
      }
      doctor: {
        id: string
        firstName: string
        lastName: string
      }
    } | null
  }>
  payments: Array<{
    id: string
    paymentNo: string
    amount: string | number
    paymentMethod: string
    paymentDate: string
    status: string
    transactionId: string | null
    notes: string | null
    refundAmount: string | number | null
    refundDate: string | null
    refunds: Array<{
      id: string
      refundNo: string
      amount: string | number
      refundMethod: string
      refundedAt: string
      reason: string
    }>
  }>
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const showPaymentDialog = searchParams.get('action') === 'payment'
  // The invoice list's "Print Invoice" opens this page with `?print=1`.
  const printOnLoad = searchParams.get('print') === '1'

  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  // A dropped connection is not the same as an invoice that does not exist:
  // the first offers a retry, the second a way back.
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'missing'>('ok')
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(invoice?.invoiceNo ?? null)
  const { toast } = useToast()

  // Payment dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(showPaymentDialog)
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentDate, setPaymentDate] = useState(isoDay(new Date()))
  const [transactionId, setTransactionId] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')

  // Asked each time the dialog opens: a payment needs an open till (finding
  // 38), and the till may have been opened or closed since this page loaded.
  const openTill = useOpenTill(paymentDialogOpen)

  const [issuing, setIssuing] = useState(false)
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  // FR-013: who may decide a discount, and who is looking. The requester may
  // not approve their own, so the buttons are not offered to them.
  const canApproveDiscounts = useCan('billing:discount') === true
  const { data: session } = useSession()
  const [decisionNote, setDecisionNote] = useState('')
  const [deciding, setDeciding] = useState<'APPROVE' | 'REJECT' | null>(null)

  const fetchInvoice = async () => {
    try {
      setLoading(true)
      setLoadState('ok')
      const response = await fetch(`/api/invoices/${id}`)
      if (response.status === 404) {
        setInvoice(null)
        setLoadState('missing')
        return
      }
      if (!response.ok) throw new Error('Failed to fetch invoice')
      const data = await response.json()
      setInvoice(data)
      // Set default payment amount to balance
      setPaymentAmount(String(Number(data.balanceAmount)))
    } catch (error) {
      console.error('Error fetching invoice:', error)
      setLoadState('failed')
      // Already on screen (a reload after an issue or a payment): the page
      // stays, and says the figures may be out of date.
      if (invoice) toast(toastError('reload the invoice', error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetching on mount and on change is what this effect is for; the state it
    // sets is the answer arriving.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchInvoice()
    // Once per invoice; `fetchInvoice` reads the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Once, after the invoice has rendered — printing on arrival would print the
  // loading skeleton.
  const printed = useRef(false)
  useEffect(() => {
    if (!printOnLoad || !invoice || printed.current) return
    printed.current = true
    const frame = requestAnimationFrame(() => window.print())
    return () => cancelAnimationFrame(frame)
  }, [printOnLoad, invoice])

  const handleRecordPayment = async () => {
    // A toast sits above the dialog, so a refused payment is seen while the
    // dialog is still open rather than looking like a button that did nothing.
    const paymentFailed = (description: string) =>
      toast({ variant: 'destructive', title: 'Could not record the payment', description })

    if (!paymentAmount || Number(paymentAmount) <= 0) {
      paymentFailed('Please enter a valid payment amount')
      return
    }
    if (!paymentMethod) {
      paymentFailed('Please select a payment method')
      return
    }

    try {
      setPaymentSubmitting(true)

      const response = await fetch(`/api/invoices/${id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(paymentAmount),
          paymentMethod,
          paymentDate,
          transactionId: transactionId || undefined,
          notes: paymentNotes || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        // The till was closed (or never opened) while the dialog was up. The
        // dialog swaps to the notice, and the toast offers the way there.
        if (data.code === NO_OPEN_TILL) {
          openTill.markNoTill()
          toast({
            variant: 'destructive',
            title: 'No till is open',
            description: data.error,
            action: (
              <ToastAction altText="Go to the till" onClick={() => router.push(TILL_PATH)}>
                Open till
              </ToastAction>
            ),
          })
          return
        }
        throw new Error(data.error || 'Failed to record payment')
      }

      setPaymentDialogOpen(false)
      fetchInvoice()

      // Reset form
      setPaymentAmount('')
      setPaymentMethod('')
      setTransactionId('')
      setPaymentNotes('')
    } catch (error: any) {
      paymentFailed(error.message)
    } finally {
      setPaymentSubmitting(false)
    }
  }

  /**
   * A draft becomes an invoice the patient owes.
   *
   * Nothing is sent anywhere — there is no route that emails or messages an
   * invoice — so this is the whole of "issuing": the status moves to Pending,
   * and from then on it can be paid, and it counts in receivables.
   */
  const handleIssue = async () => {
    if (!invoice) return
    const ok = await confirm({
      title: `Issue invoice ${invoice.invoiceNo}?`,
      description: `${invoice.invoiceNo} will be issued for ${formatCurrency(invoice.totalAmount)}. Its lines cannot be edited once a payment is recorded against it.`,
      confirmLabel: 'Issue invoice',
      tone: 'default',
    })
    if (!ok) return
    try {
      setIssuing(true)
      const response = await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PENDING' }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to issue the invoice')
      }
      await fetchInvoice()
    } catch (error) {
      toast(toastError(`issue invoice ${invoice.invoiceNo}`, error))
    } finally {
      setIssuing(false)
    }
  }

  /**
   * Approve or reject the discount (FR-013). There was no screen for this:
   * a discount over the threshold left the invoice stuck in draft, and no
   * manager could approve it from the app (invoice review 1.1).
   */
  const handleDecision = async (decision: 'APPROVE' | 'REJECT') => {
    if (!invoice) return
    if (decision === 'REJECT' && !decisionNote.trim()) {
      toast({
        variant: 'destructive',
        title: 'Say why it is rejected',
        description:
          'A note is required when rejecting a discount, so the desk knows what to change.',
      })
      return
    }
    try {
      setDeciding(decision)
      const response = await fetch(`/api/invoices/${id}/discount-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          note: decisionNote.trim() || null,
          // Refused if the discount changed since this page loaded.
          expectedDiscountAmount: Number(invoice.discountAmount),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to record the decision')
      toast(
        toastSuccess(
          decision === 'APPROVE' ? 'Discount approved' : 'Discount rejected',
          data.message
        )
      )
      setDecisionNote('')
      await fetchInvoice()
    } catch (error) {
      toast(toastError('record the discount decision', error))
    } finally {
      setDeciding(null)
    }
  }

  const getPaymentMethodIcon = (method: string) => {
    switch (method) {
      case 'CASH':
        return <Banknote className="h-4 w-4" />
      case 'CARD':
        return <CreditCard className="h-4 w-4" />
      case 'WALLET':
        return <Smartphone className="h-4 w-4" />
      case 'BANK_TRANSFER':
        return <Building2 className="h-4 w-4" />
      default:
        return <CreditCard className="h-4 w-4" />
    }
  }

  if (loading && !invoice) return <PageSkeleton variant="detail" />

  if (loadState === 'failed' && !invoice) {
    return <LoadFailed what="this invoice" onRetry={fetchInvoice} />
  }

  if (!invoice) {
    return (
      <div className="space-y-6">
        <BackLink trail={trail} fallback="/billing/invoices" fallbackLabel="Invoices" />
        <EmptyState
          icon={AlertCircle}
          title="Invoice not found"
          description="It may have been removed, or the link is wrong."
          actionLabel="Back to invoices"
          actionHref={trail.back('/billing/invoices')}
        />
      </div>
    )
  }

  // The shared overdue rule (lib/invoice-figures.ts): only an invoice still
  // owed can be late, so a paid, cancelled, refunded or draft one never says
  // "overdue". Counted on the clinic's calendar; the browser's zone is only a
  // fallback for a clinic with none set.
  const clinicZone = invoice.clinic?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const dueDays = invoiceDueState(invoice, localDay(new Date(), clinicZone), clinicZone)

  const payer = billTo(invoice.patient)
  const taxRate = Number(invoice.taxRate)
  const taxLabel = invoice.clinic?.taxLabel || 'Tax'
  const discountPercent =
    invoice.discountType === 'PERCENTAGE' ? Number(invoice.discountValue) : null
  const approval = invoice.discountApprovalStatus
  // Why "Issue" will be refused, said before it is pressed.
  const issueBlocked =
    approval === 'PENDING'
      ? 'The discount is awaiting a manager’s approval, so this invoice cannot be issued yet.'
      : approval === 'REJECTED'
        ? 'The discount was rejected. Change it on the Edit page, then issue the invoice.'
        : null
  const ownRequest =
    !!invoice.discountRequestedBy && invoice.discountRequestedBy.id === session?.user?.id
  // The date the invoice bears: the day it was issued, or the draft's date.
  const invoiceDate = invoice.issuedAt ?? invoice.createdAt
  // Every payment, then its refunds as negative rows, so the history adds up
  // to "Paid", which is net of them (invoice review 3.3).
  const historyNet = invoice.payments.reduce(
    (sum, p) =>
      ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)
        ? sum + Number(p.amount) - (p.refunds ?? []).reduce((r, x) => r + Number(x.amount), 0)
        : sum,
    0
  )

  return (
    <div className="space-y-6">
      {ConfirmDialogComponent}

      {/* Letterhead, printed only. The screen version is the app around it;
          on paper the invoice has to say who issued it (invoice review 6.3).
          The registration numbers are printed when tax is charged. */}
      <div className="hidden print:block border-b pb-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-xl font-bold">{invoice.clinic?.name ?? 'Invoice'}</h1>
            {invoice.clinic && (
              <p className="text-sm">
                {[invoice.clinic.address, invoice.clinic.city].filter(Boolean).join(', ')}
                {invoice.clinic.phone ? ` · ${invoice.clinic.phone}` : ''}
                {invoice.clinic.email ? ` · ${invoice.clinic.email}` : ''}
              </p>
            )}
            {taxRate > 0 && invoice.clinic?.taxRegistrationNo && (
              <p className="text-sm">STRN: {invoice.clinic.taxRegistrationNo}</p>
            )}
            {taxRate > 0 && invoice.clinic?.nationalTaxNo && (
              <p className="text-sm">NTN: {invoice.clinic.nationalTaxNo}</p>
            )}
          </div>
          <div className="text-right text-sm">
            <p className="text-lg font-semibold uppercase tracking-wide">
              {taxRate > 0 ? 'Tax invoice' : 'Invoice'}
            </p>
            <p>
              <span className="font-medium">{invoice.invoiceNo}</span>
              {invoice.status === 'DRAFT' ? ' (draft)' : ''}
              {invoice.status === 'CANCELLED' ? ' (cancelled)' : ''}
            </p>
            <p>Date: {displayDate(invoiceDate)}</p>
            {invoice.dueDate && <p>Due: {displayDate(invoice.dueDate)}</p>}
          </div>
        </div>
      </div>

      {/* Header */}
      <PageHeader
        className="print:hidden"
        back={<BackLink trail={trail} fallback="/billing/invoices" fallbackLabel="Invoices" />}
        title={invoice.invoiceNo}
        badges={<StatusBadge kind="invoice" status={invoice.status} />}
        description={
          invoice.issuedAt
            ? `Issued on ${displayDate(invoice.issuedAt)}`
            : `Draft started on ${displayDate(invoice.createdAt)}`
        }
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
            {invoice.status === 'DRAFT' && (
              <>
                <Button variant="outline" asChild>
                  <Link href={trail.to(`/billing/invoices/${invoice.id}/edit`)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Link>
                </Button>
                <SubmitButton
                  type="button"
                  onClick={handleIssue}
                  busy={issuing}
                  busyLabel="Issuing…"
                  icon={Send}
                  disabled={!!issueBlocked}
                  title={issueBlocked ?? undefined}
                >
                  Issue invoice
                </SubmitButton>
              </>
            )}
            {['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) && (
              <Button variant="outline" asChild>
                <Link href={trail.to(`/billing/invoices/${invoice.id}/edit`)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Notes &amp; due date
                </Link>
              </Button>
            )}
            {['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) && (
              <Button onClick={() => setPaymentDialogOpen(true)}>
                <CreditCard className="h-4 w-4 mr-2" />
                Record Payment
              </Button>
            )}
          </>
        }
      />

      {invoice.status === 'DRAFT' && issueBlocked && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{issueBlocked}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3 print:block">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6 print:space-y-4">
          {/* Patient Info */}
          <Card>
            <CardHeader>
              <CardTitle>Bill to</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  {/* A dependant's bill is addressed to whoever pays for them
                      (invoice review 4.7); the patient is named as whom it is
                      for. */}
                  <div className="font-semibold text-lg">
                    {payer.payer.firstName} {payer.payer.lastName}
                  </div>
                  {payer.forPatient ? (
                    <div className="text-sm text-muted-foreground">
                      for{' '}
                      <Link
                        href={trail.to(`/patients/${invoice.patient.id}`)}
                        className="hover:underline print:no-underline"
                      >
                        {invoice.patient.firstName} {invoice.patient.lastName}
                      </Link>{' '}
                      ({invoice.patient.patientId})
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Patient ID: {invoice.patient.patientId}
                    </div>
                  )}
                  <div className="mt-2 space-y-1 text-sm">
                    {invoice.patient.guarantor ? (
                      invoice.patient.guarantor.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          {invoice.patient.guarantor.phone}
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        {invoice.patient.phone}
                      </div>
                    )}
                    {!invoice.patient.guarantor && invoice.patient.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {invoice.patient.email}
                      </div>
                    )}
                    {!invoice.patient.guarantor && invoice.patient.address && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {invoice.patient.address}
                        {invoice.patient.city && `, ${invoice.patient.city}`}
                        {invoice.patient.state && `, ${invoice.patient.state}`}
                        {invoice.patient.postalCode && ` - ${invoice.patient.postalCode}`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* The visit this bill is for (invoice review 4.3). */}
          {invoice.appointment && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              For the visit on {displayDateTime(invoice.appointment.startsAt)}
              {invoice.appointment.doctor
                ? ` with Dr. ${invoice.appointment.doctor.firstName} ${invoice.appointment.doctor.lastName}`
                : ''}{' '}
              (
              <Link
                href={trail.to(`/appointments/${invoice.appointment.id}`)}
                className="hover:underline print:no-underline"
              >
                {invoice.appointment.appointmentNo}
              </Link>
              )
            </p>
          )}

          {/* Invoice Items */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice items</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50%]">Description</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">
                          {item.description}
                          {/* Which lines tax was charged on (review 6.4). */}
                          {taxRate > 0 && item.taxable && (
                            <span
                              className="ml-2 text-xs font-normal text-muted-foreground"
                              title={`${taxLabel} is charged on this line`}
                            >
                              (taxable)
                            </span>
                          )}
                        </div>
                        {item.inventoryItem && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Package className="h-3 w-3" />
                            <Link
                              href={trail.to(`/inventory/${item.inventoryItem.id}`)}
                              className="hover:underline print:no-underline"
                            >
                              {item.inventoryItem.sku}
                            </Link>
                          </div>
                        )}
                        {item.treatment && Number(item.amount) < Number(item.treatment.cost) && (
                          <div className="text-xs text-muted-foreground print:hidden">
                            Charged below the treatment&rsquo;s price of{' '}
                            {formatCurrency(item.treatment.cost)}
                          </div>
                        )}
                        {item.treatment && (
                          <div className="text-sm text-muted-foreground">
                            {/* The clinical record behind the charge. Disputing
                                a line means reading the note that produced it,
                                and the number was printed here unlinked. */}
                            <Link
                              href={trail.to(`/treatments/${item.treatment.id}`)}
                              className="hover:underline print:no-underline"
                            >
                              {item.treatment.treatmentNo}
                            </Link>
                            {item.treatment.doctor && (
                              <>
                                {' '}
                                • Dr. {item.treatment.doctor.firstName}{' '}
                                {item.treatment.doctor.lastName}
                              </>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Totals */}
              <div className="border-t p-4">
                <div className="flex justify-end">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(invoice.subtotal)}</span>
                    </div>
                    {Number(invoice.discountAmount) > 0 && (
                      <div className="flex justify-between text-green-600 dark:text-green-400">
                        <span>
                          Discount{discountPercent !== null ? ` (${discountPercent}%)` : ''}
                        </span>
                        <span>-{formatCurrency(invoice.discountAmount)}</span>
                      </div>
                    )}
                    {/* Reads the rate stamped on this invoice, not the clinic's
                        current one, so a reprint shows what was actually
                        charged. No line at all when there was no tax. */}
                    {taxRate > 0 && (
                      <>
                        {/* What the tax was charged on, so the tax line can
                            be checked: the taxable lines less their share of
                            the discount (review 1.4). */}
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Taxable value</span>
                          <span>{formatCurrency(invoice.taxableAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {taxLabel} ({taxRate}%)
                          </span>
                          <span>{formatCurrency(invoice.taxAmount)}</span>
                        </div>
                      </>
                    )}
                    <Separator />
                    <div className="flex justify-between font-bold text-lg">
                      <span>Total</span>
                      <span>{formatCurrency(invoice.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span>Paid</span>
                      <span>{formatCurrency(invoice.paidAmount)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Balance due</span>
                      <span
                        className={
                          Number(invoice.balanceAmount) > 0 ? 'text-red-600 dark:text-red-400' : ''
                        }
                      >
                        {formatCurrency(invoice.balanceAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Amount in Words */}
          <Card>
            <CardContent className="py-4">
              <div className="text-sm">
                <span className="text-muted-foreground">Amount in words: </span>
                <span className="font-medium">{numberToWords(Number(invoice.totalAmount))}</span>
              </div>
            </CardContent>
          </Card>

          {/* Payment History */}
          {invoice.payments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Payment history</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.payments.flatMap((payment) => [
                      <TableRow key={payment.id}>
                        <TableCell>
                          {/* The payment number opens its receipt — what the
                              patient asks for when they say "can I have
                              something showing I paid". */}
                          <Link
                            href={trail.to(`/billing/payments/${payment.id}/receipt`)}
                            className="font-medium hover:underline print:no-underline"
                          >
                            {payment.paymentNo}
                          </Link>
                          {payment.transactionId && (
                            <div className="text-sm text-muted-foreground">
                              TXN: {payment.transactionId}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{displayDate(payment.paymentDate)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getPaymentMethodIcon(payment.paymentMethod)}
                            {paymentMethodConfig[
                              payment.paymentMethod as keyof typeof paymentMethodConfig
                            ]?.label || payment.paymentMethod}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge kind="payment" status={payment.status} />
                        </TableCell>
                      </TableRow>,
                      ...(payment.refunds ?? []).map((refund) => (
                        <TableRow key={refund.id} className="text-purple-700 dark:text-purple-300">
                          <TableCell className="pl-8">
                            <div className="font-medium">{refund.refundNo}</div>
                            <div className="text-xs text-muted-foreground">
                              Refund of {payment.paymentNo}: {refund.reason}
                            </div>
                          </TableCell>
                          <TableCell>{displayDate(refund.refundedAt)}</TableCell>
                          <TableCell>
                            {paymentMethodConfig[
                              refund.refundMethod as keyof typeof paymentMethodConfig
                            ]?.label || refund.refundMethod}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            -{formatCurrency(refund.amount)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      )),
                    ])}
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Paid, net of refunds
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(historyNet)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Notes & Terms */}
          {(invoice.notes || invoice.termsAndConditions) && (
            <Card>
              <CardContent className="py-4 space-y-4">
                {invoice.notes && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Notes</div>
                    <p className="text-sm">{invoice.notes}</p>
                  </div>
                )}
                {invoice.termsAndConditions && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      Terms &amp; conditions
                    </div>
                    <p className="text-sm whitespace-pre-line">{invoice.termsAndConditions}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6 print:hidden">
          {/* Discount and its approval (FR-013, invoice review 1.1, 6.4) */}
          {Number(invoice.discountAmount) > 0 || approval !== 'NOT_REQUIRED' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {approval === 'APPROVED' ? (
                    <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : approval === 'REJECTED' ? (
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-muted-foreground" />
                  )}
                  Discount
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span>
                    {formatCurrency(invoice.discountAmount)}
                    {discountPercent !== null
                      ? ` (${discountPercent}%)`
                      : Number(invoice.subtotal) > 0
                        ? ` (${Math.round((Number(invoice.discountAmount) / Number(invoice.subtotal)) * 1000) / 10}% of the bill)`
                        : ''}
                  </span>
                </div>
                {invoice.discountReason && (
                  <div>
                    <div className="text-muted-foreground">Reason</div>
                    <p>{invoice.discountReason}</p>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Approval</span>
                  <StatusBadge kind="discountApproval" status={approval} />
                </div>
                {invoice.discountRequestedBy && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Requested by</span>
                    <span>{invoice.discountRequestedBy.name}</span>
                  </div>
                )}
                {invoice.discountApprovedBy && approval !== 'PENDING' && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {approval === 'REJECTED' ? 'Rejected by' : 'Approved by'}
                    </span>
                    <span>
                      {invoice.discountApprovedBy.name}
                      {invoice.discountDecidedAt
                        ? `, ${displayDate(invoice.discountDecidedAt)}`
                        : ''}
                    </span>
                  </div>
                )}
                {invoice.discountDecisionNote && (
                  <div>
                    <div className="text-muted-foreground">Note</div>
                    <p>{invoice.discountDecisionNote}</p>
                  </div>
                )}

                {approval === 'PENDING' &&
                  (canApproveDiscounts && !ownRequest ? (
                    <div className="space-y-2 border-t pt-3">
                      <Label htmlFor="decisionNote">Note (required to reject)</Label>
                      <Textarea
                        id="decisionNote"
                        rows={2}
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <SubmitButton
                          type="button"
                          size="sm"
                          onClick={() => handleDecision('APPROVE')}
                          busy={deciding === 'APPROVE'}
                          busyLabel="Approving…"
                          disabled={deciding !== null}
                        >
                          Approve
                        </SubmitButton>
                        <SubmitButton
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleDecision('REJECT')}
                          busy={deciding === 'REJECT'}
                          busyLabel="Rejecting…"
                          disabled={deciding !== null}
                        >
                          Reject
                        </SubmitButton>
                      </div>
                    </div>
                  ) : (
                    <p className="border-t pt-3 text-muted-foreground">
                      {ownRequest && canApproveDiscounts
                        ? 'You asked for this discount, so another manager has to approve it.'
                        : 'A manager or the administrator approves this before the invoice can be issued.'}
                    </p>
                  ))}
              </CardContent>
            </Card>
          ) : null}

          {/* Status Card */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge kind="invoice" status={invoice.status} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Invoice date</span>
                <span>{displayDate(invoiceDate)}</span>
              </div>
              {invoice.dueDate && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Due date</span>
                  <div className="text-right">
                    <div>{displayDate(invoice.dueDate)}</div>
                    {dueDays?.overdue && (
                      <div className="text-xs text-red-600 flex items-center justify-end gap-1 dark:text-red-400">
                        <Clock className="h-3 w-3" />
                        {dueDays?.label}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total amount</span>
                <span className="font-semibold">{formatCurrency(invoice.totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount paid</span>
                <span className="text-green-600 font-semibold dark:text-green-400">
                  {formatCurrency(invoice.paidAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Balance due</span>
                <span
                  className={`font-semibold ${Number(invoice.balanceAmount) > 0 ? 'text-red-600 dark:text-red-400' : ''}`}
                >
                  {formatCurrency(invoice.balanceAmount)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4 mr-2" />
                Print invoice
              </Button>
              {/* "Send via Email" was here with no handler and no route behind
                  it — there is no endpoint that emails an invoice. Removed
                  rather than left as a button that silently does nothing; see
                  docs/DEFERRED.md for what sending one would involve. */}
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href={trail.to(`/patients/${invoice.patient.id}`)} className="block">
                  <User className="h-4 w-4 mr-2" />
                  View patient
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Record a payment for invoice {invoice.invoiceNo}</DialogDescription>
          </DialogHeader>
          {openTill.noTill ? (
            <>
              <NoTillNotice className="my-2" />
              <DialogFooter>
                <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              {openTill.till && (
                <p className="text-sm text-muted-foreground">
                  {openTill.till.openedBy?.name
                    ? `Going into till ${openTill.till.sessionNo}, opened by ${openTill.till.openedBy.name}.`
                    : `Going into till ${openTill.till.sessionNo}.`}
                </p>
              )}
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="pl-9"
                      max={Number(invoice.balanceAmount)}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Balance due: {formatCurrency(invoice.balanceAmount)}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">Cash</SelectItem>
                      <SelectItem value="CARD">Card</SelectItem>
                      <SelectItem value="WALLET">Mobile Wallet</SelectItem>
                      <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                      <SelectItem value="CHEQUE">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payment Date</Label>
                  <Input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Transaction ID (Optional)</Label>
                  <Input
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    placeholder="Transaction reference number"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes (Optional)</Label>
                  <Textarea
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Any additional notes..."
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleRecordPayment} disabled={paymentSubmitting}>
                  {paymentSubmitting ? 'Recording...' : 'Record Payment'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
