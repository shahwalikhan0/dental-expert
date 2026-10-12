'use client'

import { useState, useEffect, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useToast } from '@/hooks/use-toast'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import {
  Search,
  User,
  CreditCard,
  Banknote,
  Smartphone,
  Building2,
  FileText,
  MoreHorizontal,
  Eye,
  ReceiptText,
  RotateCcw,
  IndianRupee,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import {
  paymentMethodConfig,
  paymentStatusConfig,
  formatCurrency,
  formatDate,
} from '@/lib/billing-utils'
import { ExportMenu } from '@/components/ui/export-menu'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'

/** Statuses that mean money was actually taken — see lib/cashier.ts. */
const SETTLED = new Set(['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'])

interface Payment {
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
  invoice: {
    id: string
    invoiceNo: string
    totalAmount: string | number
    patient: {
      id: string
      patientId: string
      firstName: string
      lastName: string
      phone: string
    }
  }
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface Summary {
  totalReceived: number
  totalRefunded: number
}

export default function PaymentsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Payments')
  const { toast } = useToast()
  const router = useRouter()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<Summary>({ totalReceived: 0, totalRefunded: 0 })
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [statusFilter, setStatusFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('all')
  const [dateTo, setDateTo] = useState('all')

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchPayments = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (debouncedSearch) params.append('search', debouncedSearch)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (methodFilter && methodFilter !== 'all') params.append('paymentMethod', methodFilter)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)

      const response = await fetch(`/api/payments?${params}`)
      if (!response.ok) throw new Error('Failed to fetch payments')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setPayments(data.payments)
      setSummary(data.summary)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching payments:', error)
      if (requestId === latestRequest.current) {
        toast({
          variant: 'destructive',
          title: 'Could not load the payments',
          description: error instanceof Error ? error.message : undefined,
        })
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  /**
   * Back to the first page whenever what we are filtering by changes.
   *
   * Without this, searching from page three asked the server for page three of
   * the results for that search — which is usually empty, so the screen said
   * there was nothing to find while the row sat in the list behind it.
   */
  useEffect(() => {
    // The cascading render this causes is the point, and it is bounded: one
    // extra pass, only when a filter changes while the list is off page one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPagination((p) => (p.page === 1 ? p : { ...p, page: 1 }))
  }, [debouncedSearch, statusFilter, methodFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchPayments()
  }, [
    pagination.page,
    pagination.limit,
    debouncedSearch,
    statusFilter,
    methodFilter,
    dateFrom,
    dateTo,
  ])

  const getStatusBadge = (status: string) => {
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="text-muted-foreground">View and manage all payment transactions</p>
        </div>
        <ExportMenu
          filename="payments"
          getData={() =>
            payments.map((p) => ({
              'Payment No': p.paymentNo,
              Patient: `${p.invoice.patient.firstName} ${p.invoice.patient.lastName}`,
              'Patient ID': p.invoice.patient.patientId,
              'Invoice No': p.invoice.invoiceNo,
              'Payment Date': formatDate(p.paymentDate),
              Method: p.paymentMethod,
              Amount: Number(p.amount),
              Status: p.status,
              'Transaction ID': p.transactionId || '',
              'Refund Amount': p.refundAmount ? Number(p.refundAmount) : '',
              Notes: p.notes || '',
            }))
          }
        />
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Received</CardTitle>
            <IndianRupee className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {formatCurrency(summary.totalReceived)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Refunded</CardTitle>
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {formatCurrency(summary.totalRefunded)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Collection</CardTitle>
            <IndianRupee className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold">
                {formatCurrency(summary.totalReceived - summary.totalRefunded)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by payment number, invoice, or patient..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="REFUNDED">Refunded</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Methods</SelectItem>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="CARD">Card</SelectItem>
                  <SelectItem value="WALLET">Mobile Wallet</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                  <SelectItem value="CHEQUE">Cheque</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[140px]"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[140px]"
              />
            </div>
          </div>

          <ActiveFilters
            className="mt-4"
            noun="payments"
            onClearAll={() => {
              setSearch('')
              setStatusFilter('all')
              setMethodFilter('all')
              setDateFrom('all')
              setDateTo('all')
            }}
            filters={[
              { label: 'Search', value: search, onClear: () => setSearch('') },
              {
                label: 'Status',
                value: statusFilter === 'all' ? null : humanise(statusFilter),
                onClear: () => setStatusFilter('all'),
              },
              {
                label: 'Method',
                value: methodFilter === 'all' ? null : humanise(methodFilter),
                onClear: () => setMethodFilter('all'),
              },
              {
                label: 'From',
                value: dateFrom === 'all' ? null : dateFrom,
                onClear: () => setDateFrom('all'),
              },
              {
                label: 'To',
                value: dateTo === 'all' ? null : dateTo,
                onClear: () => setDateTo('all'),
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* Payments Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Payment</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              empty={payments.length === 0}
              emptyIcon={CreditCard}
              emptyTitle="No payments found"
              emptyDescription="Nothing has been received under these filters. Payments appear here as they are recorded against an invoice."
            >
              {payments.map((payment) => (
                <ClickableRow
                  key={payment.id}
                  href={trail.to(`/billing/invoices/${payment.invoice.id}`)}
                  label={`Open the invoice for payment ${payment.paymentNo}`}
                >
                  <TableCell>
                    <div className="font-medium">{payment.paymentNo}</div>
                    {payment.transactionId && (
                      <div className="text-sm text-muted-foreground">
                        TXN: {payment.transactionId}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">
                          {payment.invoice.patient.firstName} {payment.invoice.patient.lastName}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {payment.invoice.patient.patientId}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/billing/invoices/${payment.invoice.id}`}
                      className="text-primary hover:underline"
                    >
                      {payment.invoice.invoiceNo}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getPaymentMethodIcon(payment.paymentMethod)}
                      <span>
                        {paymentMethodConfig[
                          payment.paymentMethod as keyof typeof paymentMethodConfig
                        ]?.label || payment.paymentMethod}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="font-medium">{formatCurrency(payment.amount)}</div>
                    {payment.refundAmount && Number(payment.refundAmount) > 0 && (
                      <div className="text-sm text-red-600 dark:text-red-400">
                        Refund: {formatCurrency(payment.refundAmount)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(payment.status)}</TableCell>
                  <GridActionsCell>
                    <DropdownMenu>
                      <IconTooltip label="More actions">
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </IconTooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            router.push(trail.to(`/billing/invoices/${payment.invoice.id}`))
                          }
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Invoice
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            router.push(trail.to(`/billing/payments/${payment.id}/receipt`))
                          }
                        >
                          <ReceiptText className="h-4 w-4 mr-2" />
                          Receipt
                        </DropdownMenuItem>
                        {/* A payment refunded in part can be refunded again —
                            gating on COMPLETED alone hid the action on
                            exactly the payment most likely to need it. */}
                        {SETTLED.has(payment.status) && payment.status !== 'REFUNDED' && (
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(trail.to(`/billing/payments/${payment.id}/refund`))
                            }
                          >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Process Refund
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="payments"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
