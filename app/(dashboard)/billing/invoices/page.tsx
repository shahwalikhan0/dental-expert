'use client'

import { useState, useEffect, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import {
  Plus,
  Search,
  User,
  Phone,
  MoreHorizontal,
  Eye,
  Edit,
  CreditCard,
  FileText,
  Printer,
  Mail,
  Trash2,
  AlertCircle,
  Clock,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { invoiceStatusConfig, formatCurrency, formatDate, getDueDays } from '@/lib/billing-utils'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'

interface Invoice {
  id: string
  invoiceNo: string
  createdAt: string
  dueDate: string | null
  subtotal: string | number
  discountAmount: string | number
  totalAmount: string | number
  paidAmount: string | number
  balanceAmount: string | number
  status: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
  }
  _count: {
    payments: number
    items: number
  }
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function InvoicesPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Invoices')
  const router = useRouter()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchInvoices = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (debouncedSearch) params.append('search', debouncedSearch)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (overdueOnly) params.append('overdue', 'true')

      const response = await fetch(`/api/invoices?${params}`)
      if (!response.ok) throw new Error('Failed to fetch invoices')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setInvoices(data.invoices)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching invoices:', error)
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
  }, [debouncedSearch, statusFilter, dateFrom, dateTo, overdueOnly])

  useEffect(() => {
    fetchInvoices()
  }, [
    pagination.page,
    pagination.limit,
    debouncedSearch,
    statusFilter,
    dateFrom,
    dateTo,
    overdueOnly,
  ])

  const getStatusBadge = (status: string) => {
    const config = invoiceStatusConfig[status as keyof typeof invoiceStatusConfig] || {
      label: status,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
  }

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Cancel Invoice',
      description: 'Are you sure you want to delete/cancel this invoice?',
      confirmLabel: 'Cancel Invoice',
    })
    if (!ok) return

    try {
      const response = await fetch(`/api/invoices/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete invoice')
      fetchInvoices()
    } catch (error) {
      console.error('Error deleting invoice:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="text-muted-foreground">Manage patient invoices and billing</p>
        </div>
        <Button asChild>
          <Link href="/billing/invoices/new">
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by invoice number, patient name, or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="PARTIALLY_PAID">Partially Paid</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="OVERDUE">Overdue</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="REFUNDED">Refunded</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[140px]"
                placeholder="From Date"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[140px]"
                placeholder="To Date"
              />
              <Button
                variant={overdueOnly ? 'default' : 'outline'}
                onClick={() => setOverdueOnly(!overdueOnly)}
                size="sm"
              >
                <AlertCircle className="h-4 w-4 mr-2" />
                Overdue Only
              </Button>
            </div>
          </div>

          <ActiveFilters
            className="mt-4"
            noun="invoices"
            onClearAll={() => {
              setSearch('')
              setStatusFilter('all')
              setDateFrom('')
              setDateTo('')
              setOverdueOnly(false)
            }}
            filters={[
              { label: 'Search', value: search, onClear: () => setSearch('') },
              {
                label: 'Status',
                value: statusFilter === 'all' ? null : humanise(statusFilter),
                onClear: () => setStatusFilter('all'),
              },
              { label: 'From', value: dateFrom, onClear: () => setDateFrom('') },
              { label: 'To', value: dateTo, onClear: () => setDateTo('') },
              {
                label: 'Only',
                value: overdueOnly ? 'Overdue' : null,
                onClear: () => setOverdueOnly(false),
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              empty={invoices.length === 0}
              emptyIcon={FileText}
              emptyTitle="No invoices found"
              emptyDescription="Nothing has been billed under these filters."
              emptyActionLabel="Create New Invoice"
              emptyActionHref="/billing/invoices/new"
            >
              {invoices.map((invoice) => {
                const dueDays = getDueDays(invoice.dueDate)
                return (
                  <ClickableRow
                    key={invoice.id}
                    href={trail.to(`/billing/invoices/${invoice.id}`)}
                    label={`Open invoice ${invoice.invoiceNo}`}
                  >
                    <TableCell>
                      <div className="font-medium">{invoice.invoiceNo}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(invoice.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium">
                            {invoice.patient.firstName} {invoice.patient.lastName}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {invoice.patient.phone}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(invoice.totalAmount)}
                    </TableCell>
                    <TableCell className="text-right text-green-600 dark:text-green-400">
                      {formatCurrency(invoice.paidAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          Number(invoice.balanceAmount) > 0
                            ? 'text-red-600 font-medium dark:text-red-400'
                            : ''
                        }
                      >
                        {formatCurrency(invoice.balanceAmount)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {invoice.dueDate ? (
                        <div className="flex flex-col">
                          <span className="text-sm">{formatDate(invoice.dueDate)}</span>
                          {dueDays.isOverdue && invoice.status !== 'PAID' && (
                            <span className="text-xs text-red-600 flex items-center gap-1 dark:text-red-400">
                              <Clock className="h-3 w-3" />
                              {dueDays.label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(invoice.status)}</TableCell>
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
                            onClick={() => router.push(`/billing/invoices/${invoice.id}`)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          {invoice.status === 'DRAFT' && (
                            <DropdownMenuItem
                              onClick={() => router.push(`/billing/invoices/${invoice.id}/edit`)}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) && (
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(`/billing/invoices/${invoice.id}?action=payment`)
                              }
                            >
                              <CreditCard className="h-4 w-4 mr-2" />
                              Record Payment
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => window.print()}>
                            <Printer className="h-4 w-4 mr-2" />
                            Print Invoice
                          </DropdownMenuItem>
                          {invoice.patient.email && (
                            <DropdownMenuItem>
                              <Mail className="h-4 w-4 mr-2" />
                              Send via Email
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && (
                            <DropdownMenuItem
                              onClick={() => handleDelete(invoice.id)}
                              className="text-red-600 dark:text-red-400"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Cancel Invoice
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </GridActionsCell>
                  </ClickableRow>
                )
              })}
            </GridBody>
          </Table>

          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="invoices"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  )
}
