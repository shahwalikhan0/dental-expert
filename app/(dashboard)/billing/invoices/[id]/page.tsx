'use client'

import { Fragment, useState, useEffect, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { ProfileHeader, type ProfileFact } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
import { StatTile } from '@/components/billing/stat-tile'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { SubmitButton } from '@/components/ui/submit-button'
import {
  User,
  Phone,
  Mail,
  MapPin,
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
  ShieldAlert,
  Receipt,
  Wallet,
  CheckCircle,
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
import { usePrint } from '@/hooks/use-print'
import { PrintDocument } from '@/components/print/print-document'
import { PrintButton } from '@/components/print/print-button'
import { InvoicePrint } from '@/components/print/templates/invoice-print'

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
  /** The viewer asked for this discount and is the clinic's only approver. */
  soleDiscountApprover?: boolean
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

  // Editing, issuing and taking payment are all `billing:write` on the server;
  // a dentist reads the invoice but those buttons could only come back 403
  // (bug report 16 Oct, finding 6).
  const canWrite = useCan('billing:write') === true

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

  // The invoice list's "Print invoice" arrives with `?print=1`: printed once,
  // when the invoice has loaded.
  const printing = usePrint({
    documentTitle: invoice ? `Invoice ${invoice.invoiceNo}` : 'Invoice',
    autoPrint: printOnLoad && !!invoice,
  })

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

  // A component rather than an element: the payment rows draw it in their tile.
  const paymentMethodIcon = (method: string) => {
    switch (method) {
      case 'CASH':
        return Banknote
      case 'CARD':
        return CreditCard
      case 'WALLET':
        return Smartphone
      case 'BANK_TRANSFER':
        return Building2
      default:
        return CreditCard
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
  // Nobody else can approve it, so the requester may, with a note (finding 10).
  const selfApproval = ownRequest && !!invoice.soleDiscountApprover
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

  const patientName = `${invoice.patient.firstName} ${invoice.patient.lastName}`
  const isOpen = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)
  // A cancelled invoice keeps the balance it had when it was cancelled, but
  // nobody owes it: it was shown in red as "Balance due", and a draft
  // cancelled before it was issued still said "Draft started".
  const cancelled = invoice.status === 'CANCELLED'
  const balance = cancelled ? 0 : Number(invoice.balanceAmount)
  const facts: ProfileFact[] = [
    {
      icon: Calendar,
      label: invoice.issuedAt
        ? `Issued ${displayDate(invoice.issuedAt)}`
        : cancelled
          ? `Created ${displayDate(invoice.createdAt)}`
          : `Draft started ${displayDate(invoice.createdAt)}`,
    },
    { icon: User, label: invoice.patient.patientId },
  ]
  if (invoice.dueDate)
    facts.splice(1, 0, { icon: Clock, label: `Due ${displayDate(invoice.dueDate)}` })

  return (
    <div className="space-y-6">
      {ConfirmDialogComponent}

      {/* What goes on paper: a template, not this page. */}
      <PrintDocument printing={printing}>
        <InvoicePrint invoice={invoice} />
      </PrintDocument>

      {/*
        The invoice as a record card: whose bill, its status, and the one step
        it is waiting for as the primary button — issuing a draft, taking a
        payment on an open one. Changing the notes or due date of an issued
        invoice is rarer and sits behind "More".
      */}
      <ProfileHeader
        eyebrow={invoice.invoiceNo}
        name={patientName}
        avatarIcon={Receipt}
        badges={<StatusBadge kind="invoice" status={invoice.status} />}
        facts={facts}
        menu={
          canWrite && isOpen
            ? [
                {
                  label: 'Edit notes & due date',
                  icon: Pencil,
                  onSelect: () => router.push(trail.to(`/billing/invoices/${invoice.id}/edit`)),
                },
              ]
            : []
        }
        actions={
          <>
            {/* "Send via Email" was here with no handler and no route behind
                it — there is no endpoint that emails an invoice. Removed
                rather than left as a button that silently does nothing; see
                docs/DEFERRED.md for what sending one would involve. */}
            <PrintButton printing={printing} />
            {canWrite && invoice.status === 'DRAFT' && (
              <>
                <Button variant="outline" asChild>
                  <Link href={trail.to(`/billing/invoices/${invoice.id}/edit`)}>
                    <Pencil className="h-4 w-4" />
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
            {canWrite && isOpen && (
              <Button onClick={() => setPaymentDialogOpen(true)}>
                <CreditCard className="h-4 w-4" />
                Record payment
              </Button>
            )}
          </>
        }
      />

      {invoice.status === 'DRAFT' && issueBlocked && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600/10">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 self-center">{issueBlocked}</span>
        </div>
      )}

      {/* What it comes to, what has been paid, what is still owed. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Total" icon={Receipt} value={formatCurrency(invoice.totalAmount)} />
        <StatTile
          label="Paid"
          icon={CheckCircle}
          tone="success"
          value={formatCurrency(invoice.paidAmount)}
          hint={
            invoice.payments.length > 0
              ? `${invoice.payments.length} ${invoice.payments.length === 1 ? 'payment' : 'payments'}`
              : 'Nothing paid yet'
          }
        />
        <StatTile
          label="Balance due"
          icon={Wallet}
          tone={balance > 0 ? 'danger' : 'default'}
          value={cancelled ? formatCurrency(0) : formatCurrency(invoice.balanceAmount)}
          hint={
            cancelled
              ? 'Cancelled: nothing is owed'
              : dueDays?.overdue
                ? dueDays.label
                : invoice.dueDate
                  ? `Due ${displayDate(invoice.dueDate)}`
                  : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Invoice Items */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice items</CardTitle>
              <CardDescription>
                {invoice.items.length} {invoice.items.length === 1 ? 'line' : 'lines'}
              </CardDescription>
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
                              className="hover:underline"
                            >
                              {item.inventoryItem.sku}
                            </Link>
                          </div>
                        )}
                        {item.treatment && Number(item.amount) < Number(item.treatment.cost) && (
                          <div className="text-xs text-muted-foreground">
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
                              className="hover:underline"
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
              <div className="border-t p-6">
                <div className="ml-auto w-full space-y-2 text-sm sm:w-72">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="tabular-nums">{formatCurrency(invoice.subtotal)}</span>
                  </div>
                  {Number(invoice.discountAmount) > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span>
                        Discount{discountPercent !== null ? ` (${discountPercent}%)` : ''}
                      </span>
                      <span className="tabular-nums">
                        -{formatCurrency(invoice.discountAmount)}
                      </span>
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
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Taxable value</span>
                        <span className="tabular-nums">
                          {formatCurrency(invoice.taxableAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {taxLabel} ({taxRate}%)
                        </span>
                        <span className="tabular-nums">{formatCurrency(invoice.taxAmount)}</span>
                      </div>
                    </>
                  )}
                  <Separator className="my-1" />
                  <div className="flex justify-between text-base font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(invoice.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Paid</span>
                    <span className="tabular-nums">{formatCurrency(invoice.paidAmount)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Balance due</span>
                    <span
                      className={`tabular-nums ${balance > 0 ? 'text-red-600 dark:text-red-400' : ''}`}
                    >
                      {cancelled ? 'None (cancelled)' : formatCurrency(invoice.balanceAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Amount in Words */}
              <div className="border-t bg-muted/40 px-6 py-4 text-sm">
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
                <CardDescription>Each payment opens its receipt</CardDescription>
              </CardHeader>
              <CardContent>
                <LinkList>
                  {invoice.payments.map((payment) => {
                    const method =
                      paymentMethodConfig[payment.paymentMethod as keyof typeof paymentMethodConfig]
                        ?.label || payment.paymentMethod
                    return (
                      <Fragment key={payment.id}>
                        {/* The payment opens its receipt — what the patient
                            asks for when they say "can I have something
                            showing I paid". */}
                        <LinkRow
                          href={trail.to(`/billing/payments/${payment.id}/receipt`)}
                          icon={paymentMethodIcon(payment.paymentMethod)}
                          title={payment.paymentNo}
                          subtitle={`${displayDate(payment.paymentDate)} · ${method}${
                            payment.transactionId ? ` · TXN: ${payment.transactionId}` : ''
                          }`}
                          trailing={
                            <span className="flex shrink-0 items-center gap-3">
                              <span className="text-sm font-semibold tabular-nums">
                                {formatCurrency(payment.amount)}
                              </span>
                              <StatusBadge kind="payment" status={payment.status} />
                            </span>
                          }
                        />
                        {(payment.refunds ?? []).map((refund) => (
                          <li
                            key={refund.id}
                            className="ml-14 mr-2 flex items-center justify-between gap-3 rounded-xl border border-purple-200 bg-purple-50/60 px-4 py-2.5 text-sm text-purple-700 dark:border-purple-800/60 dark:bg-purple-950/30 dark:text-purple-300"
                          >
                            <div className="min-w-0">
                              <div className="font-medium">{refund.refundNo}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                Refund of {payment.paymentNo}: {refund.reason} ·{' '}
                                {displayDate(refund.refundedAt)} ·{' '}
                                {paymentMethodConfig[
                                  refund.refundMethod as keyof typeof paymentMethodConfig
                                ]?.label || refund.refundMethod}
                              </div>
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums">
                              -{formatCurrency(refund.amount)}
                            </span>
                          </li>
                        ))}
                      </Fragment>
                    )
                  })}
                </LinkList>
                {/* Every payment, then its refunds as negative rows, so the
                    history adds up to "Paid", which is net of them (invoice
                    review 3.3). */}
                <div className="mt-4 flex justify-between border-t pt-4 text-sm">
                  <span className="font-medium">Paid, net of refunds</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(historyNet)}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes & Terms */}
          {(invoice.notes || invoice.termsAndConditions) && (
            <Card>
              <CardHeader>
                <CardTitle>Notes and terms</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid className="sm:grid-cols-1">
                  {invoice.notes && (
                    <InfoItem label="Notes">
                      <span className="whitespace-pre-wrap font-normal">{invoice.notes}</span>
                    </InfoItem>
                  )}
                  {invoice.termsAndConditions && (
                    <InfoItem label="Terms & conditions">
                      <span className="whitespace-pre-wrap font-normal">
                        {invoice.termsAndConditions}
                      </span>
                    </InfoItem>
                  )}
                </InfoGrid>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Discount and its approval (FR-013, invoice review 1.1, 6.4). First
              on this side: while it awaits a decision, it is what holds the
              invoice up. */}
          {Number(invoice.discountAmount) > 0 || approval !== 'NOT_REQUIRED' ? (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Discount</CardTitle>
                  <StatusBadge kind="discountApproval" status={approval} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <InfoGrid className="sm:grid-cols-1">
                  <InfoItem label="Amount">
                    {formatCurrency(invoice.discountAmount)}
                    {discountPercent !== null
                      ? ` (${discountPercent}%)`
                      : Number(invoice.subtotal) > 0
                        ? ` (${Math.round((Number(invoice.discountAmount) / Number(invoice.subtotal)) * 1000) / 10}% of the bill)`
                        : ''}
                  </InfoItem>
                  {invoice.discountReason && (
                    <InfoItem label="Reason">
                      <span className="whitespace-pre-wrap font-normal">
                        {invoice.discountReason}
                      </span>
                    </InfoItem>
                  )}
                  {invoice.discountRequestedBy && (
                    <InfoItem label="Requested by">{invoice.discountRequestedBy.name}</InfoItem>
                  )}
                  {invoice.discountApprovedBy && approval !== 'PENDING' && (
                    <InfoItem label={approval === 'REJECTED' ? 'Rejected by' : 'Approved by'}>
                      {invoice.discountApprovedBy.name}
                      {invoice.discountDecidedAt
                        ? `, ${displayDate(invoice.discountDecidedAt)}`
                        : ''}
                    </InfoItem>
                  )}
                  {invoice.discountDecisionNote && (
                    <InfoItem label="Note">
                      <span className="whitespace-pre-wrap font-normal">
                        {invoice.discountDecisionNote}
                      </span>
                    </InfoItem>
                  )}
                </InfoGrid>

                {/* Nothing to decide on a cancelled invoice: it will never be issued. */}
                {approval === 'PENDING' &&
                  !cancelled &&
                  (canApproveDiscounts && (!ownRequest || selfApproval) ? (
                    <div className="space-y-2 rounded-xl bg-muted/60 p-4">
                      {selfApproval && (
                        <p className="text-muted-foreground">
                          Nobody else in the clinic can approve discounts, so you may approve your
                          own. Say why in the note; it is recorded as a self-approval.
                        </p>
                      )}
                      <Label htmlFor="decisionNote">
                        {selfApproval ? 'Note (required)' : 'Note (required to reject)'}
                      </Label>
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
                        {/* Their own request is withdrawn by editing it. */}
                        {!selfApproval && (
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
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-muted/60 p-4 text-muted-foreground">
                      {ownRequest && canApproveDiscounts
                        ? 'You asked for this discount, so another manager has to approve it.'
                        : 'A manager or the administrator approves this before the invoice can be issued.'}
                    </p>
                  ))}
              </CardContent>
            </Card>
          ) : null}

          {/* Patient Info */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Bill to</CardTitle>
              {/* A dependant's bill is addressed to whoever pays for them
                  (invoice review 4.7); the patient is named as whom it is
                  for. */}
              <CardDescription>
                {payer.forPatient ? (
                  <>
                    for{' '}
                    <Link
                      href={trail.to(`/patients/${invoice.patient.id}`)}
                      className="hover:underline"
                    >
                      {patientName}
                    </Link>{' '}
                    ({invoice.patient.patientId})
                  </>
                ) : (
                  <>Patient ID: {invoice.patient.patientId}</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {`${payer.payer.firstName.charAt(0)}${payer.payer.lastName.charAt(0)}`.toUpperCase()}
                </span>
                <span className="min-w-0 truncate font-semibold">
                  {payer.payer.firstName} {payer.payer.lastName}
                </span>
              </div>
              <InfoGrid className="sm:grid-cols-1">
                {invoice.patient.guarantor ? (
                  invoice.patient.guarantor.phone && (
                    <InfoItem label="Phone" icon={Phone}>
                      {invoice.patient.guarantor.phone}
                    </InfoItem>
                  )
                ) : (
                  <InfoItem label="Phone" icon={Phone}>
                    {invoice.patient.phone}
                  </InfoItem>
                )}
                {!invoice.patient.guarantor && invoice.patient.email && (
                  <InfoItem label="Email" icon={Mail}>
                    {invoice.patient.email}
                  </InfoItem>
                )}
                {!invoice.patient.guarantor && invoice.patient.address && (
                  <InfoItem label="Address" icon={MapPin}>
                    {invoice.patient.address}
                    {invoice.patient.city && `, ${invoice.patient.city}`}
                    {invoice.patient.state && `, ${invoice.patient.state}`}
                    {invoice.patient.postalCode && ` - ${invoice.patient.postalCode}`}
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          {/* Status Card */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Status">
                  <StatusBadge kind="invoice" status={invoice.status} />
                </InfoItem>
                <InfoItem label="Invoice date" icon={Calendar}>
                  {displayDate(invoiceDate)}
                </InfoItem>
                {invoice.dueDate && (
                  <InfoItem label="Due date" icon={Clock}>
                    {displayDate(invoice.dueDate)}
                    {dueDays?.overdue && (
                      <span className="mt-0.5 block text-xs font-normal text-red-600 dark:text-red-400">
                        {dueDays?.label}
                      </span>
                    )}
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          {/* Everything this invoice links to, one row each. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Related</CardTitle>
            </CardHeader>
            <CardContent>
              <LinkList>
                <LinkRow
                  href={trail.to(`/patients/${invoice.patient.id}`)}
                  icon={User}
                  title={patientName}
                  subtitle={`Patient · ${invoice.patient.patientId}`}
                />
                {/* The visit this bill is for (invoice review 4.3). */}
                {invoice.appointment && (
                  <LinkRow
                    href={trail.to(`/appointments/${invoice.appointment.id}`)}
                    icon={Calendar}
                    title={invoice.appointment.appointmentNo}
                    subtitle={`Visit · ${displayDateTime(invoice.appointment.startsAt)}${
                      invoice.appointment.doctor
                        ? ` with Dr. ${invoice.appointment.doctor.firstName} ${invoice.appointment.doctor.lastName}`
                        : ''
                    }`}
                  />
                )}
              </LinkList>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Payment Dialog */}
      {/* `?action=payment` opens it from a link; not for those who cannot pay in. */}
      <Dialog open={canWrite && paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
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
                  {paymentSubmitting ? 'Recording…' : 'Record payment'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
