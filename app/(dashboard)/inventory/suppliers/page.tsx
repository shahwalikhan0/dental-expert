'use client'

import { useState, useEffect, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { MoreHorizontal, Pencil, Truck } from 'lucide-react'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'
import { formatCurrency } from '@/lib/utils'

interface Supplier {
  id: number
  code: string
  name: string
  contactPerson: string
  phone: string
  email: string
  city: string
  status: string
  itemsSupplied: number
  totalOrders: number
  totalBusiness: number
}

export default function SuppliersPage() {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    pages: 0,
  })

  useEffect(() => {
    fetchSuppliers()
  }, [debouncedSearch, statusFilter, pagination.page, pagination.limit])

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchSuppliers = async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
      })

      const response = await fetch(`/api/inventory/suppliers?${params}`)
      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return

      if (data.success) {
        setSuppliers(data.data)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  /**
   * Was a hand-rolled `<span>` with its own colour table, and its own currency
   * formatter hard-coded to en-PK beside it. Both exist already — `Badge`, and
   * `formatCurrency` in lib/utils.ts, which follows the clinic's locale rather
   * than assuming one.
   */
  const getStatusBadge = (status: string) => (
    <Badge variant={status === 'BLOCKED' ? 'destructive' : 'secondary'}>{humanise(status)}</Badge>
  )

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="page-title">Supplier Management</h1>
        <div className="flex gap-2">
          <Link
            href="/inventory"
            className="px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/80"
          >
            Back to Inventory
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + Add Supplier
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-background rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Search by name, code, contact person..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              // A new filter is a new list; page three of the old one means nothing.
              setPagination((p) => ({ ...p, page: 1 }))
            }}
            className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              // A new filter is a new list; page three of the old one means nothing.
              setPagination((p) => ({ ...p, page: 1 }))
            }}
            className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="BLOCKED">Blocked</option>
          </select>
        </div>

        <ActiveFilters
          className="mt-4"
          noun="suppliers"
          onClearAll={() => {
            setSearch('')
            setStatusFilter('all')
            setPagination((p) => ({ ...p, page: 1 }))
          }}
          filters={[
            {
              label: 'Search',
              value: search,
              onClear: () => {
                setSearch('')
                setPagination((p) => ({ ...p, page: 1 }))
              },
            },
            {
              label: 'Status',
              value: statusFilter === 'all' ? null : humanise(statusFilter),
              onClear: () => {
                setStatusFilter('all')
                setPagination((p) => ({ ...p, page: 1 }))
              },
            },
          ]}
        />
      </div>

      {/* Suppliers Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total Business</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={9}
              loading={loading}
              empty={suppliers.length === 0}
              emptyIcon={Truck}
              emptyTitle="No suppliers found"
              emptyDescription="Suppliers are who stock is ordered from. Add one to raise a purchase order against it."
            >
              {suppliers.map((supplier) => (
                <ClickableRow
                  key={supplier.id}
                  href={`/inventory/suppliers/${supplier.id}`}
                  label={`Open ${supplier.name}`}
                >
                  <TableCell className="font-medium">{supplier.code}</TableCell>
                  <TableCell>{supplier.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {supplier.contactPerson || '—'}
                  </TableCell>
                  <TableCell>{supplier.phone}</TableCell>
                  <TableCell className="text-muted-foreground">{supplier.email || '—'}</TableCell>
                  <TableCell>{getStatusBadge(supplier.status)}</TableCell>
                  <TableCell>{supplier.itemsSupplied}</TableCell>
                  <TableCell>{formatCurrency(supplier.totalBusiness)}</TableCell>
                  <GridActionsCell>
                    {/* View has gone: the row itself is the link now, which is
                        what every other grid in the application does. */}
                    <DropdownMenu>
                      <IconTooltip label="More actions">
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </IconTooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/inventory/suppliers/${supplier.id}/edit`}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </Link>
                        </DropdownMenuItem>
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
            noun="suppliers"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>

      {/* Add Supplier Modal - Placeholder */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">Add New Supplier</h2>
            <p className="text-muted-foreground mb-4">
              Supplier form will be implemented here. For now, please use the API directly or create
              a dedicated page.
            </p>
            <button
              onClick={() => setShowAddModal(false)}
              className="px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/80"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
