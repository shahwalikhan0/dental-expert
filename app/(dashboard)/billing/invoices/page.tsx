'use client'

import { useState, useEffect, useRef } from 'react'
import { useListParams } from '@/hooks/use-list-params'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect } from '@/components/ui/filter-select'
import { DateRangeFilter, dateRangeLabel } from '@/components/ui/date-range-filter'
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
  Phone,
  MoreHorizontal,
  Pencil,
  CreditCard,
  FileText,
  Printer,
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
import { formatCurrency, formatDate } from '@/lib/billing-utils'
import { statusLabel, statusOptions } from '@/lib/status'
import { toastError } from '@/lib/toast-utils'
import { DEFAULT_TIMEZONE, localDay } from '@/lib/appointment-time'
import { invoiceDueState } from '@/lib/invoice-figures'
import { useCan } from '@/hooks/use-can'

interface Invoice {
  id: string
  invoiceNo: string
  createdAt: string
  issuedAt: string | null
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

/** What the status filter offers: every invoice status, as the badge names it. */
const STATUS_OPTIONS = statusOptions('invoice')

export default function InvoicesPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Invoices')
  const router = useRouter()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const { toast } = useToast()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  // The clinic's day and zone, from the server that filtered the list, so the
  // "x days overdue" line and the "Overdue only" filter agree.
  const [calendar, setCalendar] = useState<{ today: string; timezone: string } | null>(null)
  // Cancelling is `billing:void` on the server (DELETE); offering it to a role
  // without it was a menu item that could only come back 403.
  const canVoid = useCan('billing:void') === true
  // Raising, editing and taking payment on an invoice are `billing:write`; a
  // dentist reads the bills but does not make them (bug report 16 Oct, 6).
  const canWrite = useCan('billing:write') === true
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)

  /**
   * Search, filters and page, kept in the address bar, so opening an invoice
   * and coming back — or refreshing, or sharing the link — keeps the view. The
   * hook debounces the search and goes back to page 1 on any change.
   */
  const list = useListParams({
    defaults: { status: 'all', from: '', to: '', overdue: false },
  })
  const range = { from: list.filters.from, to: list.filters.to }
  // What the route is asked, as a string, so the fetch runs once per question.
  const query = list.apiParams({ rename: { from: 'dateFrom', to: 'dateTo' } }).toString()

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
      setFailed(false)
      const response = await fetch(`/api/invoices?${query}`)
      if (!response.ok) throw new Error('Failed to fetch invoices')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setInvoices(data.invoices)
      if (data.today && data.timezone) setCalendar({ today: data.today, timezone: data.timezone })
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching invoices:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchInvoices()
    // The query string is the whole question; `fetchInvoices` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Cancelling keeps the invoice, its number and its lines; its treatments
  // become billable again. One with money on it is refused by the server until
  // the payments are refunded, and is not offered here.
  const handleCancel = async (invoice: Invoice) => {
    const ok = await confirm({
      title: `Cancel invoice ${invoice.invoiceNo}?`,
      description:
        'It will be marked cancelled. It keeps its number and lines, and its treatments can be billed on a new invoice.',
      confirmLabel: 'Cancel invoice',
      cancelLabel: 'Keep invoice',
    })
    if (!ok) return

    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to cancel invoice')
      }
      fetchInvoices()
    } catch (error) {
      console.error('Error cancelling invoice:', error)
      toast(toastError(`cancel invoice ${invoice.invoiceNo}`, error))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Manage patient invoices and billing"
        actions={
          canWrite && (
            <Button asChild>
              <Link href="/billing/invoices/new">
                <Plus className="h-4 w-4" />
                New invoice
              </Link>
            </Button>
          )
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search invoices"
            placeholder="Search by invoice number, patient name or phone…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Status"
              plural="statuses"
              value={list.filters.status}
              onValueChange={(status) => list.setFilter('status', status)}
              options={STATUS_OPTIONS}
            />
            <Button
              variant={list.filters.overdue ? 'default' : 'outline'}
              onClick={() => list.setFilter('overdue', !list.filters.overdue)}
              aria-pressed={list.filters.overdue}
            >
              <AlertCircle className="h-4 w-4" />
              Overdue only
            </Button>
          </>
        }
        date={
          <DateRangeFilter
            label="Issued"
            value={range}
            today={calendar?.today}
            onChange={(next) => list.setFilters(next)}
          />
        }
        active={{
          noun: 'invoices',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Status',
              value:
                list.filters.status === 'all' ? null : statusLabel('invoice', list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
            {
              label: 'Issued',
              value: dateRangeLabel(range, calendar?.today),
              onClear: () => list.setFilters({ from: '', to: '' }),
            },
            {
              label: 'Only',
              value: list.filters.overdue ? 'Overdue' : null,
              onClear: () => list.setFilter('overdue', false),
            },
          ],
        }}
      />

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
              failed={failed}
              onRetry={fetchInvoices}
              empty={invoices.length === 0}
              emptyIcon={FileText}
              emptyTitle="No invoices found"
              emptyDescription={
                list.isFiltered
                  ? 'Nothing has been billed under these filters.'
                  : 'No invoice has been raised yet.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'New invoice' : undefined
              }
              emptyActionHref={list.isFiltered || !canWrite ? undefined : '/billing/invoices/new'}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {invoices.map((invoice) => {
                // The shared rule: only an invoice still owed can be late, so a
                // paid, cancelled, refunded or draft one never reads "overdue".
                const timezone = calendar?.timezone ?? DEFAULT_TIMEZONE
                const dueState = invoiceDueState(
                  invoice,
                  calendar?.today ?? localDay(new Date(), timezone),
                  timezone
                )
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
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {`${invoice.patient.firstName.charAt(0)}${invoice.patient.lastName.charAt(0)}`.toUpperCase()}
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
                          {dueState?.overdue && (
                            <span className="text-xs text-red-600 flex items-center gap-1 dark:text-red-400">
                              <Clock className="h-3 w-3" />
                              {dueState.label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind="invoice" status={invoice.status} />
                    </TableCell>
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
                          {/* No "View details": the row itself opens the invoice. */}
                          {canWrite && invoice.status === 'DRAFT' && (
                            <>
                              <DropdownMenuItem
                                onClick={() => router.push(`/billing/invoices/${invoice.id}/edit`)}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          {canWrite &&
                            ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) && (
                              <DropdownMenuItem
                                onClick={() =>
                                  router.push(`/billing/invoices/${invoice.id}?action=payment`)
                                }
                              >
                                <CreditCard className="h-4 w-4 mr-2" />
                                Record payment
                              </DropdownMenuItem>
                            )}
                          {/* Opens the invoice to print it. `window.print()` here
                              printed this list, not the invoice. "Send via
                              Email" sat below it with no handler; there is no
                              route that emails an invoice (docs/DEFERRED.md). */}
                          <DropdownMenuItem
                            onClick={() => router.push(`/billing/invoices/${invoice.id}?print=1`)}
                          >
                            <Printer className="h-4 w-4 mr-2" />
                            Print invoice
                          </DropdownMenuItem>
                          {canVoid &&
                            invoice.status !== 'CANCELLED' &&
                            Number(invoice.paidAmount) <= 0 && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleCancel(invoice)}
                                  className="text-red-600 dark:text-red-400"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Cancel invoice
                                </DropdownMenuItem>
                              </>
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
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="invoices"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  )
}
