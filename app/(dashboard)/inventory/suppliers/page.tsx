'use client'

import { useState, useEffect, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GridPagination } from '@/components/ui/data-grid'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'

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

  const getStatusBadge = (status: string) => {
    const badges = {
      ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
      INACTIVE: 'bg-muted text-foreground',
      BLOCKED: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
    }

    return (
      <span
        className={`px-2 py-1 text-xs font-semibold rounded-full ${badges[status as keyof typeof badges]}`}
      >
        {status.charAt(0) + status.slice(1).toLowerCase()}
      </span>
    )
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Supplier Management</h1>
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
      <div className="bg-background rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">Loading...</div>
        ) : suppliers.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No suppliers found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Contact Person
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Items
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total Business
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-background divide-y divide-border">
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id} className="hover:bg-muted/50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                        {supplier.code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {supplier.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {supplier.contactPerson || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {supplier.phone}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {supplier.email || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(supplier.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {supplier.itemsSupplied}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {formatCurrency(supplier.totalBusiness)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium row-actions">
                        <Link
                          href={`/inventory/suppliers/${supplier.id}`}
                          className="text-blue-600 hover:text-blue-900 mr-3 dark:text-blue-400"
                        >
                          View
                        </Link>
                        <Link
                          href={`/inventory/suppliers/${supplier.id}/edit`}
                          className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <GridPagination
              page={pagination.page}
              pageSize={pagination.limit}
              total={pagination.total}
              noun="suppliers"
              onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
              onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
            />
          </>
        )}
      </div>

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
