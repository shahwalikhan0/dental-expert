'use client'

import { useState, useEffect, useRef, use } from 'react'
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
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  MapPin,
  Printer,
  CreditCard,
  FileText,
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  IndianRupee,
  Banknote,
  Smartphone,
  Building2,
  Pencil,
  Send,
} from 'lucide-react'
import {
  invoiceStatusConfig,
  paymentMethodConfig,
  paymentStatusConfig,
  formatCurrency,
  formatDate,
  formatDateTime,
  getDueDays,
  numberToWords,
} from '@/lib/billing-utils'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { isoDay } from '@/lib/dates'

interface Invoice {
  id: string
  invoiceNo: string
  // The Invoice model has no `invoiceDate`. Three screens read one anyway, so
  // every invoice in the system rendered undated — including the printed copy.
  createdAt: string
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
  }
  items: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: string | number
    amount: string | number
    taxable: boolean
    treatment: {
      id: string
      treatmentNo: string
      toothNumbers: string | null
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
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(invoice?.invoiceNo ?? null)
  const [error, setError] = useState('')

  // Payment dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(showPaymentDialog)
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentDate, setPaymentDate] = useState(isoDay(new Date()))
  const [transactionId, setTransactionId] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  // Shown inside the dialog. The page's own error banner sits behind the
  // modal, so a refused payment used to look like a button that did nothing.
  const [paymentError, setPaymentError] = useState('')

  const [issuing, setIssuing] = useState(false)
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const fetchInvoice = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/invoices/${id}`)
      if (!response.ok) throw new Error('Failed to fetch invoice')
      const data = await response.json()
      setInvoice(data)
      // Set default payment amount to balance
      setPaymentAmount(String(Number(data.balanceAmount)))
    } catch (error) {
      console.error('Error fetching invoice:', error)
      setError('Failed to load invoice')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInvoice()
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

  const openPaymentDialog = (open: boolean) => {
    if (open) setPaymentError('')
    setPaymentDialogOpen(open)
  }

  const handleRecordPayment = async () => {
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      setPaymentError('Please enter a valid payment amount')
      return
    }
    if (!paymentMethod) {
      setPaymentError('Please select a payment method')
      return
    }

    try {
      setPaymentSubmitting(true)
      setPaymentError('')

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
        const data = await response.json()
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
      setPaymentError(error.message)
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
      title: 'Issue invoice',
      description: `${invoice.invoiceNo} will be issued for ${formatCurrency(invoice.totalAmount)}. Its lines cannot be edited once a payment is recorded against it.`,
      confirmLabel: 'Issue invoice',
      variant: 'default',
    })
    if (!ok) return
    try {
      setIssuing(true)
      setError('')
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
    } catch (error: any) {
      setError(error.message)
    } finally {
      setIssuing(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const config = invoiceStatusConfig[status as keyof typeof invoiceStatusConfig] || {
      label: status,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
  }

  const getPaymentStatusBadge = (status: string) => {
    const config = paymentStatusConfig[status as keyof typeof paymentStatusConfig] || {
      label: status,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64" />
            <Skeleton className="h-96" />
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg text-muted-foreground">Invoice not found</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/billing/invoices">Back to Invoices</Link>
        </Button>
      </div>
    )
  }

  const dueDays = getDueDays(invoice.dueDate)

  return (
    <div className="space-y-6">
      {ConfirmDialogComponent}
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <BackLink trail={trail} fallback="/billing/invoices" fallbackLabel="Invoices" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="page-title">{invoice.invoiceNo}</h1>
              {getStatusBadge(invoice.status)}
            </div>
            <p className="text-muted-foreground">Created on {formatDate(invoice.createdAt)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
              <Button onClick={handleIssue} disabled={issuing}>
                <Send className="h-4 w-4 mr-2" />
                {issuing ? 'Issuing…' : 'Issue invoice'}
              </Button>
            </>
          )}
          {['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) && (
            <Button onClick={() => openPaymentDialog(true)}>
              <CreditCard className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2 dark:bg-red-950/30 dark:border-red-800/60 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Patient Info */}
          <Card>
            <CardHeader>
              <CardTitle>Bill To</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-lg">
                    {invoice.patient.firstName} {invoice.patient.lastName}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Patient ID: {invoice.patient.patientId}
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      {invoice.patient.phone}
                    </div>
                    {invoice.patient.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {invoice.patient.email}
                      </div>
                    )}
                    {invoice.patient.address && (
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

          {/* Invoice Items */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50%]">Description</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.description}</div>
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
                        <span>Discount</span>
                        <span>-{formatCurrency(invoice.discountAmount)}</span>
                      </div>
                    )}
                    {/* Reads the rate stamped on this invoice, not the clinic's
                        current one, so a reprint shows what was actually
                        charged. No line at all when there was no tax. */}
                    {Number(invoice.taxRate) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Tax ({invoice.taxRate}%)</span>
                        <span>{formatCurrency(invoice.taxAmount)}</span>
                      </div>
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
                      <span>Balance Due</span>
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
                <CardTitle>Payment History</CardTitle>
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
                    {invoice.payments.map((payment) => (
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
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
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
                        <TableCell>{getPaymentStatusBadge(payment.status)}</TableCell>
                      </TableRow>
                    ))}
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
                      Terms & Conditions
                    </div>
                    <p className="text-sm whitespace-pre-line">{invoice.termsAndConditions}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status Card */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                {getStatusBadge(invoice.status)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Invoice Date</span>
                <span>{formatDate(invoice.createdAt)}</span>
              </div>
              {invoice.dueDate && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Due Date</span>
                  <div className="text-right">
                    <div>{formatDate(invoice.dueDate)}</div>
                    {dueDays.isOverdue && invoice.status !== 'PAID' && (
                      <div className="text-xs text-red-600 flex items-center justify-end gap-1 dark:text-red-400">
                        <Clock className="h-3 w-3" />
                        {dueDays.label}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Amount</span>
                <span className="font-semibold">{formatCurrency(invoice.totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount Paid</span>
                <span className="text-green-600 font-semibold dark:text-green-400">
                  {formatCurrency(invoice.paidAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Balance Due</span>
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
                Print Invoice
              </Button>
              {/* "Send via Email" was here with no handler and no route behind
                  it — there is no endpoint that emails an invoice. Removed
                  rather than left as a button that silently does nothing; see
                  docs/DEFERRED.md for what sending one would involve. */}
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href={trail.to(`/patients/${invoice.patient.id}`)} className="block">
                  <User className="h-4 w-4 mr-2" />
                  View Patient
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={openPaymentDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Record a payment for invoice {invoice.invoiceNo}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {paymentError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {paymentError}
              </div>
            )}
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
            <Button variant="outline" onClick={() => openPaymentDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleRecordPayment} disabled={paymentSubmitting}>
              {paymentSubmitting ? 'Recording...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
